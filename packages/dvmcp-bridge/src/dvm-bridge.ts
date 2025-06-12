import { NostrAnnouncer } from './announcer';
import { MCPPool } from './mcp-pool';
import type { DvmcpBridgeConfig } from './config-schema.js';
import { RelayHandler } from '@dvmcp/commons/nostr';
import { createKeyManager } from '@dvmcp/commons/nostr';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  GIFT_WRAP_KIND,
  TAG_METHOD,
  TAG_PUBKEY,
  TAG_EVENT_ID,
  TAG_STATUS,
  TAG_SERVER_IDENTIFIER,
} from '@dvmcp/commons/core';
import { loggerBridge } from '@dvmcp/commons/core';
import type { NostrEvent, EventTemplate } from 'nostr-tools';
import { getServerId } from './utils';
import { EncryptionManager } from './encryption';

import { handleToolsList, handleToolsCall } from './handlers/tool-handlers';
import {
  handleResourcesList,
  handleResourcesRead,
  handleResourceTemplatesList,
} from './handlers/resource-handlers';
import {
  handlePromptsList,
  handlePromptsGet,
  handleNotificationsCancel,
  handleCompletionComplete,
  handlePing,
} from './handlers';

// TODO: Clean up encryption implementation, we have some redundant and unnecesary code. We also have a publish event function in each handler which can be simplified
// TODO: notifications are unencrypted
export interface ResponseContext {
  originalRequestId: string;
  recipientPubkey: string;
  shouldEncrypt: boolean;
  encryptionManager?: EncryptionManager | null;
  keyManager: ReturnType<typeof createKeyManager>;
  relayHandler: RelayHandler;
}

export class DVMBridge {
  private mcpPool: MCPPool;
  private nostrAnnouncer: NostrAnnouncer;
  private relayHandler: RelayHandler;
  private encryptionManager: EncryptionManager | null = null;
  private isRunning: boolean = false;
  public readonly serverId: string;
  public readonly keyManager: ReturnType<typeof createKeyManager>;

  constructor(
    private config: DvmcpBridgeConfig,
    relayHandler?: RelayHandler
  ) {
    this.relayHandler =
      relayHandler ?? new RelayHandler(config.nostr.relayUrls);
    loggerBridge('Initializing DVM Bridge...');
    this.mcpPool = new MCPPool(config);

    this.keyManager = createKeyManager(config.nostr.privateKey);
    const publicKey = this.keyManager.getPublicKey();

    this.serverId = getServerId(
      this.config.mcp.name,
      publicKey,
      this.config.mcp.serverId
    );

    if (this.config.mcp.serverId) {
      loggerBridge(`Using custom server ID from config: ${this.serverId}`);
    }

    // Initialize encryption manager if encryption is configured
    if (this.config.encryption?.supportEncryption) {
      this.encryptionManager = new EncryptionManager(this.config.encryption);
      loggerBridge('Encryption support enabled (NIP-17/NIP-59)');
    } else {
      loggerBridge('Encryption support disabled');
    }

    this.nostrAnnouncer = new NostrAnnouncer(
      this.mcpPool,
      config,
      this.relayHandler,
      this.serverId,
      this.keyManager
    );

    loggerBridge('public key:', publicKey);
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
      const publicKey = this.keyManager.getPublicKey();
      const subscribe = () => {
        // Subscribe to both regular and encrypted events
        const kinds = [REQUEST_KIND, NOTIFICATION_KIND];
        if (this.encryptionManager?.isEncryptionEnabled()) {
          kinds.push(GIFT_WRAP_KIND);
        }

        this.relayHandler.subscribeToRequests(this.handleRequest.bind(this), {
          kinds,
          '#p': [publicKey],
          since: Math.floor(Date.now() / 1000),
        });
      };

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

  /**
   * Decrypt an encrypted event and extract the real sender's public key
   * This manually performs NIP-17/NIP-59 decryption to access the sealed message layer
   */
  private async decryptEventAndExtractSender(
    giftWrapEvent: NostrEvent
  ): Promise<{
    eventTemplate: EventTemplate;
    realSenderPubkey: string;
  } | null> {
    try {
      if (!this.encryptionManager || giftWrapEvent.kind !== GIFT_WRAP_KIND) {
        return null;
      }

      const recipientSecretKey = Buffer.from(
        this.config.nostr.privateKey,
        'hex'
      );

      // Step 1: Unwrap the gift wrap to get the sealed message
      // This uses the ephemeral key from the gift wrap but we need the real sender from the sealed message
      const { decrypt } = await import('nostr-tools/nip04');

      let sealedMessage: NostrEvent;
      try {
        const decryptedSealContent = decrypt(
          recipientSecretKey,
          giftWrapEvent.pubkey,
          giftWrapEvent.content
        );
        sealedMessage = JSON.parse(decryptedSealContent) as NostrEvent;
      } catch (error) {
        loggerBridge('Failed to unwrap gift wrap:', error);
        return null;
      }

      // Step 2: Extract the real sender's public key from the sealed message
      const realSenderPubkey = sealedMessage.pubkey;
      loggerBridge(
        'Extracted real sender pubkey from sealed message:',
        realSenderPubkey
      );

      // Step 3: Unseal the message to get the original DVMCP content
      let originalMessageContent: string;
      try {
        originalMessageContent = decrypt(
          recipientSecretKey,
          realSenderPubkey,
          sealedMessage.content
        );
      } catch (error) {
        loggerBridge('Failed to unseal message:', error);
        return null;
      }

      // Step 4: Parse the original message (kind 14 private direct message)
      const privateDirectMessage = JSON.parse(originalMessageContent);

      // Step 5: Extract the DVMCP message from the private direct message content
      const dvmcpMessage = JSON.parse(privateDirectMessage.content);

      const eventTemplate: EventTemplate = {
        kind: dvmcpMessage.kind,
        content: dvmcpMessage.content,
        tags: dvmcpMessage.tags,
        created_at: dvmcpMessage.created_at,
      };

      return {
        eventTemplate,
        realSenderPubkey,
      };
    } catch (error) {
      loggerBridge('Error in decryptEventAndExtractSender:', error);
      return null;
    }
  }

  private async handleRequest(event: NostrEvent): Promise<void> {
    try {
      // Check if this is an encrypted event
      if (
        event.kind === GIFT_WRAP_KIND &&
        this.encryptionManager?.isEncryptionEnabled()
      ) {
        loggerBridge('Received encrypted event, attempting to decrypt...');

        // Try to decrypt the event and extract the real sender's pubkey
        const decryptionResult = await this.decryptEventAndExtractSender(event);

        if (!decryptionResult) {
          loggerBridge(
            'Failed to decrypt event - may not be intended for this server'
          );
          return;
        }

        // Process the decrypted event with the real sender's pubkey
        loggerBridge('Successfully decrypted event, processing...');
        // Construct a NostrEvent from the decrypted template and real sender pubkey
        // The ID should be computed from the inner event content, not the gift wrap
        const { getEventHash } = await import('nostr-tools');
        const innerEventId = getEventHash({
          ...decryptionResult.eventTemplate,
          pubkey: decryptionResult.realSenderPubkey,
        });

        const reconstructedEvent: NostrEvent = {
          ...decryptionResult.eventTemplate,
          id: innerEventId, // Use computed ID of the inner event - this is what discovery client expects
          pubkey: decryptionResult.realSenderPubkey,
          sig: event.sig, // Use original signature (though it's from the ephemeral key)
        };

        await this.processDecryptedRequest(
          reconstructedEvent,
          decryptionResult.realSenderPubkey
        );
        return;
      }

      // Handle regular unencrypted events
      await this.processRegularRequest(event);
    } catch (error) {
      console.error('Error handling request:', error);
    }
  }

  private async processRegularRequest(event: NostrEvent): Promise<void> {
    const tags = event.tags;
    const kind = event.kind;
    const pubkey = event.pubkey;
    const id = event.id;
    const method = tags.find((tag) => tag[0] === TAG_METHOD)?.[1] || '';
    const serverIdentifier =
      tags.find((tag) => tag[0] === TAG_SERVER_IDENTIFIER)?.[1] || '';

    await this.processRequest(
      event,
      kind,
      pubkey,
      id,
      method,
      serverIdentifier
    );
  }

  private async processDecryptedRequest(
    decryptedEvent: NostrEvent,
    realSenderPubkey: string
  ): Promise<void> {
    // The decryptedEvent now contains the reconstructed DVMCP message
    // and realSenderPubkey contains the actual sender's public key

    const tags = decryptedEvent.tags;
    const kind = decryptedEvent.kind;
    const pubkey = realSenderPubkey; // Use the real sender's pubkey
    const id = decryptedEvent.id;
    const method = tags.find((tag) => tag[0] === TAG_METHOD)?.[1] || '';
    const serverIdentifier =
      tags.find((tag) => tag[0] === TAG_SERVER_IDENTIFIER)?.[1] || '';

    loggerBridge(
      `Processing encrypted request from real sender: ${realSenderPubkey}`
    );
    await this.processRequest(
      decryptedEvent,
      kind,
      pubkey,
      id,
      method,
      serverIdentifier,
      true
    );
  }

  private async processRequest(
    event: NostrEvent,
    kind: number,
    pubkey: string,
    id: string,
    method: string,
    serverIdentifier: string,
    isEncrypted: boolean = false
  ): Promise<void> {
    try {
      // For ping requests, if no server ID is specified, we should still respond
      // For all other methods, server ID must match
      if (
        method !== 'ping' &&
        serverIdentifier &&
        serverIdentifier !== this.serverId
      ) {
        return;
      }

      // If server ID is specified for ping, it must match ours
      if (
        method === 'ping' &&
        serverIdentifier &&
        serverIdentifier !== this.serverId
      ) {
        return;
      }

      if (!this.isWhitelisted(pubkey)) {
        const errorStatus = this.keyManager.signEvent({
          ...this.keyManager.createEventTemplate(NOTIFICATION_KIND),
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

      if (kind === REQUEST_KIND) {
        // Create response context for encryption awareness
        const responseContext = {
          originalRequestId: id,
          recipientPubkey: pubkey,
          shouldEncrypt: isEncrypted,
          encryptionManager: this.encryptionManager,
          keyManager: this.keyManager,
          relayHandler: this.relayHandler,
        };

        switch (method) {
          case 'initialize':
            break;
          case 'ping':
            await handlePing(
              event,
              this.keyManager,
              this.relayHandler,
              responseContext
            );
            break;
          case 'tools/list':
            await handleToolsList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              responseContext
            );
            break;
          case 'tools/call':
            await handleToolsCall(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              this.config,
              responseContext
            );
            break;
          case 'resources/list':
            await handleResourcesList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              responseContext
            );
            break;
          case 'resources/read':
            await handleResourcesRead(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              this.config,
              responseContext
            );
            break;
          case 'resources/templates/list':
            await handleResourceTemplatesList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              responseContext
            );
            break;
          case 'prompts/list':
            await handlePromptsList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              responseContext
            );
            break;
          case 'prompts/get':
            await handlePromptsGet(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              responseContext
            );
            break;
          case 'completion/complete':
            const completionResponse = await handleCompletionComplete(
              event,
              this.mcpPool,
              this.keyManager,
              responseContext
            );
            if (completionResponse) {
              await this.publishResponse(completionResponse, responseContext);
            }
            break;
          default:
            const notImpl = this.keyManager.signEvent({
              ...this.keyManager.createEventTemplate(RESPONSE_KIND),
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
            await this.publishResponse(notImpl, responseContext);
        }
      } else if (kind === NOTIFICATION_KIND) {
        if (method === 'notifications/cancel') {
          await handleNotificationsCancel(
            event,
            this.keyManager,
            this.relayHandler
          );
        } else {
          loggerBridge(`Received unhandled notification type: ${method}`);
        }
      } else {
        loggerBridge(`Received unhandled event kind: ${kind}`);
      }
    } catch (error) {
      console.error('Error processing request:', error);
    }
  }

  /**
   * Publishes a response, handling encryption based on the response context
   */
  private async publishResponse(
    event: NostrEvent,
    responseContext: ResponseContext
  ): Promise<void> {
    if (
      responseContext.shouldEncrypt &&
      responseContext.encryptionManager?.isEncryptionEnabled()
    ) {
      // Encrypt the response for the original requester
      try {
        // Convert signed event back to EventTemplate for encryption
        const eventTemplate = {
          kind: event.kind,
          content: event.content,
          tags: event.tags,
          created_at: event.created_at,
        };

        const encryptedEvent =
          await responseContext.encryptionManager.encryptMessage(
            this.config.nostr.privateKey,
            responseContext.recipientPubkey,
            eventTemplate
          );

        if (encryptedEvent) {
          loggerBridge('Publishing encrypted response');
          await responseContext.relayHandler.publishEvent(encryptedEvent);
        } else {
          loggerBridge(
            'Failed to encrypt response, falling back to unencrypted'
          );
          await responseContext.relayHandler.publishEvent(event);
        }
      } catch (error) {
        loggerBridge(
          'Error encrypting response, falling back to unencrypted:',
          error
        );
        await responseContext.relayHandler.publishEvent(event);
      }
    } else {
      // Publish unencrypted response
      loggerBridge('Publishing unencrypted response');
      await responseContext.relayHandler.publishEvent(event);
    }
  }
}
