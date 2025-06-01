import { NostrAnnouncer } from './announcer';
import { MCPPool } from './mcp-pool';
import type { DvmcpBridgeConfig } from './config-schema.js';
import { RelayHandler } from '@dvmcp/commons/nostr';
import { createKeyManager } from '@dvmcp/commons/nostr';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_METHOD,
  TAG_PUBKEY,
  TAG_EVENT_ID,
  TAG_STATUS,
  TAG_SERVER_IDENTIFIER,
} from '@dvmcp/commons/core';
import { loggerBridge } from '@dvmcp/commons/core';
import type { NostrEvent } from 'nostr-tools';
import { getServerId } from './utils';

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
} from './handlers';

// TODO: add ping utility handler
export class DVMBridge {
  private mcpPool: MCPPool;
  private nostrAnnouncer: NostrAnnouncer;
  private relayHandler: RelayHandler;
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
        this.relayHandler.subscribeToRequests(this.handleRequest.bind(this), {
          kinds: [REQUEST_KIND, NOTIFICATION_KIND],
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

  private async handleRequest(event: NostrEvent): Promise<void> {
    try {
      const tags = event.tags;
      const kind = event.kind;
      const pubkey = event.pubkey;
      const id = event.id;
      const method = tags.find((tag) => tag[0] === TAG_METHOD)?.[1] || '';
      const serverIdentifier =
        tags.find((tag) => tag[0] === TAG_SERVER_IDENTIFIER)?.[1] || '';

      if (serverIdentifier != this.serverId) {
        const errorStatus = this.keyManager.signEvent({
          ...this.keyManager.createEventTemplate(NOTIFICATION_KIND),
          content: 'Unauthorized: Server identifier does not match',
          tags: [
            [TAG_STATUS, 'error'],
            [TAG_EVENT_ID, id],
            [TAG_PUBKEY, pubkey],
          ],
        });
        await this.relayHandler.publishEvent(errorStatus);
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
        switch (method) {
          case 'initialize':
            break;
          case 'tools/list':
            await handleToolsList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler
            );
            break;
          case 'tools/call':
            await handleToolsCall(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              this.config
            );
            break;
          case 'resources/list':
            await handleResourcesList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler
            );
            break;
          case 'resources/read':
            await handleResourcesRead(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              this.config
            );
            break;
          case 'resources/templates/list':
            await handleResourceTemplatesList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler
            );
            break;
          case 'prompts/list':
            await handlePromptsList(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler
            );
            break;
          case 'prompts/get':
            await handlePromptsGet(
              event,
              this.mcpPool,
              this.keyManager,
              this.relayHandler,
              this.config
            );
            break;
          case 'completion/complete':
            const completionResponse = await handleCompletionComplete(
              event,
              this.mcpPool,
              this.keyManager
            );
            if (!completionResponse) break;
            await this.relayHandler.publishEvent(completionResponse);
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
            await this.relayHandler.publishEvent(notImpl);
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
      console.error('Error handling request:', error);
    }
  }
}
