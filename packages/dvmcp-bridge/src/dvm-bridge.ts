import { keyManager, NostrAnnouncer } from './announcer';
import type { Event } from 'nostr-tools/pure';
import { CONFIG } from './config';
import { MCPPool } from './mcp-pool';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { relayHandler } from './relay';
import {
  DVM_NOTICE_KIND,
  TOOL_REQUEST_KIND,
  TOOL_RESPONSE_KIND,
} from '@dvmcp/commons/constants';
import { loggerBridge } from '@dvmcp/commons/logger';
import { generateZapRequest, verifyZapPayment } from './payment-handler';

export class DVMBridge {
  private mcpPool: MCPPool;
  private nostrAnnouncer: NostrAnnouncer;
  private relayHandler: RelayHandler;
  private isRunning: boolean = false;

  constructor() {
    loggerBridge('Initializing DVM Bridge...');
    loggerBridge('public key:', keyManager.getPublicKey());
    this.mcpPool = new MCPPool(CONFIG.mcp.servers);
    this.relayHandler = relayHandler;
    this.nostrAnnouncer = new NostrAnnouncer(this.mcpPool);
  }

  private isWhitelisted(pubkey: string): boolean {
    if (
      !CONFIG.whitelist.allowedPubkeys ||
      CONFIG.whitelist.allowedPubkeys.size == 0
    ) {
      return true;
    }
    return CONFIG.whitelist.allowedPubkeys.has(pubkey);
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

      loggerBridge('Announcing service to Nostr network...');
      await this.nostrAnnouncer.updateAnnouncement();

      loggerBridge('Setting up request handlers...');
      const publicKey = keyManager.getPublicKey();
      this.relayHandler.subscribeToRequests(this.handleRequest.bind(this), {
        kinds: [TOOL_REQUEST_KIND],
        '#p': [publicKey],
        since: Math.floor(Date.now() / 1000),
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

  private async handleRequest(event: Event) {
    try {
      if (this.isWhitelisted(event.pubkey)) {
        if (event.kind === TOOL_REQUEST_KIND) {
          const command = event.tags.find((tag) => tag[0] === 'c')?.[1];

          if (command === 'list-tools') {
            const tools = await this.mcpPool.listTools();
            const response = keyManager.signEvent({
              ...keyManager.createEventTemplate(TOOL_RESPONSE_KIND),
              content: JSON.stringify({
                tools,
              }),
              tags: [
                ['c', 'list-tools-response'],
                ['e', event.id],
                ['p', event.pubkey],
              ],
            });

            await this.relayHandler.publishEvent(response);
          } else if (command === 'execute-tool') {
            const jobRequest = JSON.parse(event.content);
            const processingStatus = keyManager.signEvent({
              ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
              tags: [
                ['status', 'processing'],
                ['e', event.id],
                ['p', event.pubkey],
              ],
            });
            await this.relayHandler.publishEvent(processingStatus);

            try {
              // Check if the tool has pricing information
              const pricing = this.mcpPool.getToolPricing(jobRequest.name);

              if (pricing?.price) {
                loggerBridge(
                  `Tool ${jobRequest.name} requires payment: ${pricing.price} ${pricing.unit || 'sats'}`
                );

                // Generate zap request for payment
                const zapRequest = await generateZapRequest(
                  pricing.price,
                  jobRequest.name,
                  event.id,
                  event.pubkey
                );

                if (zapRequest) {
                  // Send payment required status with zap invoice
                  const paymentRequiredStatus = keyManager.signEvent({
                    ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
                    tags: [
                      ['status', 'payment-required'],
                      ['amount', pricing.price, pricing.unit || 'sats'],
                      ['invoice', zapRequest.paymentRequest],
                      ['e', event.id],
                      ['p', event.pubkey],
                    ],
                  });
                  await this.relayHandler.publishEvent(paymentRequiredStatus);

                  loggerBridge(
                    `Waiting for zap receipt for request ID: ${zapRequest.zapRequestId}`
                  );

                  const paymentVerified = await verifyZapPayment(
                    zapRequest.relays,
                    zapRequest.paymentRequest
                  );

                  if (!paymentVerified) {
                    const paymentFailedStatus = keyManager.signEvent({
                      ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
                      tags: [
                        [
                          'status',
                          'error',
                          'Payment verification failed or timed out',
                        ],
                        ['e', event.id],
                        ['p', event.pubkey],
                      ],
                    });
                    await this.relayHandler.publishEvent(paymentFailedStatus);
                    return;
                  }

                  // Payment verified via zap receipt, continue with tool execution
                  const paymentAcceptedStatus = keyManager.signEvent({
                    ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
                    tags: [
                      ['status', 'payment-accepted'],
                      ['e', event.id],
                      ['p', event.pubkey],
                    ],
                  });
                  await this.relayHandler.publishEvent(paymentAcceptedStatus);
                }
              }

              // Execute the tool
              const result = await this.mcpPool.callTool(
                jobRequest.name,
                jobRequest.parameters
              );

              if (result?.content) {
                const successStatus = keyManager.signEvent({
                  ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
                  tags: [
                    ['status', 'success'],
                    ['e', event.id],
                    ['p', event.pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(successStatus);
                const response = keyManager.signEvent({
                  ...keyManager.createEventTemplate(TOOL_RESPONSE_KIND),
                  content: JSON.stringify(result),
                  tags: [
                    ['c', 'execute-tool-response'],
                    ['e', event.id],
                    ['p', event.pubkey],
                  ],
                });
                await this.relayHandler.publishEvent(response);
              }
            } catch (error) {
              const errorStatus = keyManager.signEvent({
                ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
                tags: [
                  [
                    'status',
                    'error',
                    error instanceof Error ? error.message : 'Unknown error',
                  ],
                  ['e', event.id],
                  ['p', event.pubkey],
                ],
              });
              await this.relayHandler.publishEvent(errorStatus);
            }
          }
        }
      } else {
        const errorStatus = keyManager.signEvent({
          ...keyManager.createEventTemplate(DVM_NOTICE_KIND),
          content: 'Unauthorized: Pubkey not in whitelist',
          tags: [
            ['status', 'error'],
            ['e', event.id],
            ['p', event.pubkey],
          ],
        });
        await this.relayHandler.publishEvent(errorStatus);
        return;
      }
    } catch (error) {
      console.error('Error handling request:', error);
    }
  }
}
