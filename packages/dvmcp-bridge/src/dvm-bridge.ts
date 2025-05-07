import { NostrAnnouncer } from './announcer';
import { MCPPool } from './mcp-pool';
import type { DvmcpBridgeConfig } from './config-schema.js';
import { loadDvmcpConfig } from './config-loader';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_METHOD,
  TAG_SERVER_IDENTIFIER,
  TAG_PUBKEY,
  TAG_EVENT_ID,
  TAG_STATUS,
  TAG_AMOUNT,
} from '@dvmcp/commons/constants';
import { loggerBridge } from '@dvmcp/commons/logger';
import { generateZapRequest, verifyZapPayment } from './payment-handler';
import type { NostrEvent } from 'nostr-tools';
import type {
  CallToolRequest,
  GetPromptRequest,
  ReadResourceRequest,
} from '@modelcontextprotocol/sdk/types.js';

export class DVMBridge {
  private mcpPool: MCPPool;
  private nostrAnnouncer: NostrAnnouncer;
  private relayHandler: RelayHandler;
  private isRunning: boolean = false;

  constructor(
    private config: DvmcpBridgeConfig,
    relayHandler: RelayHandler
  ) {
    this.relayHandler = relayHandler;
    loggerBridge('Initializing DVM Bridge...');
    this.mcpPool = new MCPPool(config);
    this.nostrAnnouncer = new NostrAnnouncer(
      this.mcpPool,
      config,
      relayHandler
    );
    loggerBridge(
      'public key:',
      this.nostrAnnouncer['keyManager'].getPublicKey()
    );
  }

  private isWhitelisted(pubkey: string): boolean {
    const allowedPubkeys = this.config.whitelist?.allowedPubkeys;
    if (!allowedPubkeys || allowedPubkeys.length === 0) return true;
    return allowedPubkeys.includes(pubkey);
  }

  async start() {
    if (this.isRunning) {
      loggerBridge('Bridge is already running');
      return;
    }

    try {
      loggerBridge('Connecting to MCP servers...');
      await this.mcpPool.connect();

      const tools = await this.mcpPool.listTools();
      loggerBridge(`Available MCP tools across all servers: ${tools.length}`);

      // Announce to Nostr network, but continue if it fails
      loggerBridge('Announcing service to Nostr network...');
      try {
        await this.nostrAnnouncer.updateAnnouncement();
      } catch (error) {
        console.warn('Failed to announce service to Nostr network:', error);
        loggerBridge(
          '⚠️ Warning: Failed to announce service to Nostr network. The bridge will still function, but will not be discoverable via Nostr.'
        );
      }

      loggerBridge('Setting up request handlers...');
      const publicKey = this.nostrAnnouncer.keyManager.getPublicKey();
      const subscribe = () => {
        this.relayHandler.subscribeToRequests(this.handleRequest.bind(this), {
          kinds: [REQUEST_KIND, NOTIFICATION_KIND],
          '#p': [publicKey],
          since: Math.floor(Date.now() / 1000),
        });
      };

      // Subscribe to requests
      try {
        subscribe();
      } catch (error) {
        loggerBridge(
          '⚠️ Warning: Failed to subscribe to Nostr requests. Will retry on relay reconnection.'
        );
      }

      this.relayHandler.onRelayReconnected((url) => {
        loggerBridge(`Relay reconnected: ${url}, re-subscribing to requests`);
        subscribe();
      });

      this.isRunning = true;
      loggerBridge('DVM Bridge is now running and ready to handle requests');
    } catch (error) {
      console.error('Failed to start DVM Bridge:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    loggerBridge('Stopping DVM Bridge...');
    try {
      await this.mcpPool.disconnect();
      this.relayHandler.cleanup();
      this.isRunning = false;
      loggerBridge('DVM Bridge stopped successfully');
    } catch (error) {
      console.error('Error stopping DVM Bridge:', error);
      throw error;
    }
  }

  /**
   * Deletes the service announcement from relays
   * @param reason Optional reason for deletion
   * @returns The deletion event that was published
   */
  async deleteAnnouncement(reason?: string) {
    loggerBridge('Deleting service announcement from relays...');
    try {
      const deletionEvent =
        await this.nostrAnnouncer.deleteAnnouncement(reason);
      loggerBridge('Service announcement deleted successfully');
      return deletionEvent;
    } catch (error) {
      console.error('Error deleting service announcement:', error);
      throw error;
    }
  }

  private async handleRequest(event: NostrEvent): Promise<void> {
    try {
      // --- DVMCP V2 Routing: unified handler for all request/notification kinds ---
      // Extract required fields using spec tag names.

      const tags = event.tags;
      const kind = event.kind;
      const pubkey = event.pubkey;
      const id = event.id;
      const method = tags.find((tag) => tag[0] === TAG_METHOD)?.[1] || '';

      if (!this.isWhitelisted(pubkey)) {
        const errorStatus = this.nostrAnnouncer.keyManager.signEvent({
          ...this.nostrAnnouncer.keyManager.createEventTemplate(
            NOTIFICATION_KIND
          ),
          content: 'Unauthorized: Pubkey not in whitelist',
          tags: [
            [TAG_STATUS, 'error'],
            [TAG_EVENT_ID, id],
            [TAG_PUBKEY, pubkey],
          ],
        });
        await this.relayHandler.publishEvent(errorStatus);
        return;
      }

      // Route by kind/method per DVMCP spec
      if (kind === REQUEST_KIND) {
        switch (method) {
          case 'initialize':
            // TODO: Implement initialization for private servers
            break;
          case 'tools/list':
            {
              const tools = await this.mcpPool.listTools();
              const response = this.nostrAnnouncer.keyManager.signEvent({
                ...this.nostrAnnouncer.keyManager.createEventTemplate(
                  RESPONSE_KIND
                ),
                content: JSON.stringify({
                  result: { tools },
                }),
                tags: [
                  [TAG_EVENT_ID, id],
                  [TAG_PUBKEY, pubkey],
                ],
              });
              await this.relayHandler.publishEvent(response);
            }
            break;
          case 'tools/call':
            {
              let jobRequest: CallToolRequest;
              try {
                jobRequest = JSON.parse(event.content);
              } catch (err) {
                const errorResp = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    error: {
                      code: -32600,
                      message: 'Invalid request content/json',
                      data: err instanceof Error ? err.message : String(err),
                    },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorResp);
                break;
              }

              // Send processing notification
              const processingStatus = this.nostrAnnouncer.keyManager.signEvent(
                {
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    NOTIFICATION_KIND
                  ),
                  content: JSON.stringify({
                    method: 'notifications/progress',
                    params: { message: 'processing' },
                  }),
                  tags: [
                    [TAG_PUBKEY, pubkey],
                    [TAG_EVENT_ID, id],
                    [TAG_METHOD, 'notifications/progress'],
                  ],
                }
              );
              await this.relayHandler.publishEvent(processingStatus);

              try {
                // Pricing/payment logic
                const pricing = this.mcpPool.getToolPricing(
                  jobRequest.params.name
                );

                if (pricing?.price) {
                  const zapRequest = await generateZapRequest(
                    pricing.price,
                    jobRequest.params.name,
                    id,
                    pubkey,
                    this.config
                  );
                  if (zapRequest) {
                    // Send payment required notification
                    const paymentRequiredStatus =
                      this.nostrAnnouncer.keyManager.signEvent({
                        ...this.nostrAnnouncer.keyManager.createEventTemplate(
                          NOTIFICATION_KIND
                        ),
                        tags: [
                          [TAG_STATUS, 'payment-required'],
                          [TAG_AMOUNT, pricing.price, pricing.unit || 'sats'],
                          ['invoice', zapRequest.paymentRequest],
                          [TAG_EVENT_ID, id],
                          [TAG_PUBKEY, pubkey],
                        ],
                      });
                    await this.relayHandler.publishEvent(paymentRequiredStatus);

                    // Wait for payment verification
                    const paymentVerified = await verifyZapPayment(
                      zapRequest.relays,
                      zapRequest.paymentRequest,
                      this.config
                    );
                    if (!paymentVerified) {
                      const paymentFailedStatus =
                        this.nostrAnnouncer.keyManager.signEvent({
                          ...this.nostrAnnouncer.keyManager.createEventTemplate(
                            NOTIFICATION_KIND
                          ),
                          tags: [
                            [TAG_STATUS, 'error'],
                            [TAG_EVENT_ID, id],
                            [TAG_PUBKEY, pubkey],
                          ],
                        });
                      await this.relayHandler.publishEvent(paymentFailedStatus);
                      break;
                    }
                    // Inform payment accepted
                    const paymentAcceptedStatus =
                      this.nostrAnnouncer.keyManager.signEvent({
                        ...this.nostrAnnouncer.keyManager.createEventTemplate(
                          NOTIFICATION_KIND
                        ),
                        tags: [
                          [TAG_STATUS, 'payment-accepted'],
                          [TAG_EVENT_ID, id],
                          [TAG_PUBKEY, pubkey],
                        ],
                      });
                    await this.relayHandler.publishEvent(paymentAcceptedStatus);
                  }
                }

                // Call the tool
                const result = await this.mcpPool.callTool(
                  jobRequest.params.name,
                  jobRequest.params.arguments!
                );

                // Send success notification
                const successStatus = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    NOTIFICATION_KIND
                  ),
                  tags: [
                    [TAG_STATUS, 'success'],
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(successStatus);

                // Response (Kind 26910) with result
                const response = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    result,
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(response);
              } catch (error) {
                const errorStatus = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    NOTIFICATION_KIND
                  ),
                  tags: [
                    [TAG_STATUS, 'error'],
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorStatus);

                const errorResp = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    error: {
                      code: -32000,
                      message:
                        error instanceof Error
                          ? error.message
                          : 'Execution error',
                    },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorResp);
              }
            }
            break;
          case 'resources/list':
            {
              try {
                const resources = await this.mcpPool.listResources();
                const response = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    result: { resources },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(response);
              } catch (err) {
                const errorResp = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    error: {
                      code: -32000,
                      message: 'Failed to list resources',
                      data: err instanceof Error ? err.message : String(err),
                    },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorResp);
              }
            }
            break;
          case 'resources/read':
            {
              try {
                // Parse the content to get resource URI
                const readParams: ReadResourceRequest = JSON.parse(
                  event.content
                );
                if (!readParams.params.uri) {
                  throw new Error('Resource URI is required');
                }

                const resourceUri = readParams.params.uri;
                const resource = await this.mcpPool.readResource(resourceUri);

                if (!resource) {
                  throw new Error(`Resource not found: ${resourceUri}`);
                }

                const response = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    result: { resource },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(response);
              } catch (err) {
                const errorResp = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    error: {
                      code: -32000,
                      message: 'Failed to read resource',
                      data: err instanceof Error ? err.message : String(err),
                    },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorResp);
              }
            }
            break;
          case 'prompts/list':
            {
              try {
                const prompts = await this.mcpPool.listPrompts();
                const response = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    result: { prompts },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(response);
              } catch (err) {
                const errorResp = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    error: {
                      code: -32000,
                      message: 'Failed to list prompts',
                      data: err instanceof Error ? err.message : String(err),
                    },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorResp);
              }
            }
            break;
          case 'prompts/get':
            {
              try {
                // Parse the content to get prompt name
                const getParams: GetPromptRequest = JSON.parse(event.content);
                if (!getParams.params.name) {
                  throw new Error('Prompt name is required');
                }

                const promptName = getParams.params.name;
                const prompt = await this.mcpPool.getPrompt(promptName);

                if (!prompt) {
                  throw new Error(`Prompt not found: ${promptName}`);
                }

                const response = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    result: { prompt },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(response);
              } catch (err) {
                const errorResp = this.nostrAnnouncer.keyManager.signEvent({
                  ...this.nostrAnnouncer.keyManager.createEventTemplate(
                    RESPONSE_KIND
                  ),
                  content: JSON.stringify({
                    error: {
                      code: -32000,
                      message: 'Failed to get prompt',
                      data: err instanceof Error ? err.message : String(err),
                    },
                  }),
                  tags: [
                    [TAG_EVENT_ID, id],
                    [TAG_PUBKEY, pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(errorResp);
              }
            }
            break;
          default:
            // Unknown/unimplemented method
            const notImpl = this.nostrAnnouncer.keyManager.signEvent({
              ...this.nostrAnnouncer.keyManager.createEventTemplate(
                RESPONSE_KIND
              ),
              content: JSON.stringify({
                error: {
                  code: -32601,
                  message: 'Method not implemented',
                  data: method,
                },
              }),
              tags: [
                [TAG_EVENT_ID, id],
                [TAG_PUBKEY, pubkey],
              ],
            });
            await this.relayHandler.publishEvent(notImpl);
        }
      } else if (kind === NOTIFICATION_KIND) {
        // Notification (could be progress/cancel/payment etc.)
        if (method === 'notifications/cancel') {
          // Handle cancel notification by finding the associated job and canceling it
          const eventIdToCancel = tags.find(
            (tag) => tag[0] === TAG_EVENT_ID
          )?.[1];
          if (eventIdToCancel) {
            loggerBridge(`Received cancel request for job: ${eventIdToCancel}`);

            // Send cancellation acknowledgment
            const cancelAckStatus = this.nostrAnnouncer.keyManager.signEvent({
              ...this.nostrAnnouncer.keyManager.createEventTemplate(
                NOTIFICATION_KIND
              ),
              content: JSON.stringify({
                method: 'notifications/progress',
                params: { message: 'cancellation-acknowledged' },
              }),
              tags: [
                [TAG_STATUS, 'cancelled'],
                [TAG_EVENT_ID, eventIdToCancel],
                [TAG_PUBKEY, pubkey],
              ],
            });
            await this.relayHandler.publishEvent(cancelAckStatus);

            // TODO: Actual cancellation would require tracking active jobs and their IDs
            // This would be implemented in a more complete job management system
          }
        } else if (method === 'notifications/progress') {
          // Handle progress notifications
          loggerBridge(`Received progress notification: ${event.content}`);
          // Forward or process progress notifications as needed
        } else {
          // Handle any other notification types
          loggerBridge(`Received unhandled notification type: ${method}`);
        }
      } else {
        // Unknown event kind
        // Optionally log or reply with protocol error here
        loggerBridge(`Received unhandled event kind: ${kind}`);
      }
    } catch (error) {
      console.error('Error handling request:', error);
    }
  }
}
