import {
  MCPMETHODS,
  REQUEST_KIND,
  RESPONSE_KIND,
  TAG_EVENT_ID,
  TAG_METHOD,
  TAG_PUBKEY,
  TAG_SERVER_IDENTIFIER,
  GIFT_WRAP_KIND,
  loggerDiscovery,
  TAG_UNIQUE_IDENTIFIER,
  TAG_SUPPORT_ENCRYPTION,
} from '@dvmcp/commons/core';
import { RelayHandler } from '@dvmcp/commons/nostr';
import type { Event } from 'nostr-tools/pure';
import { createKeyManager } from '@dvmcp/commons/nostr';
import {
  LATEST_PROTOCOL_VERSION,
  type InitializeResult,
  type Prompt,
  type Resource,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { UnsignedEvent } from 'nostr-tools/pure';
import type { PrivateServerConfig } from './config-schema';
import type { DiscoveryServer } from './discovery-server';
import { EventPublisher } from '@dvmcp/commons/nostr';
import { EncryptionManager, EncryptionMode } from '@dvmcp/commons/encryption';
import { UnifiedRegistration } from './unified-registration';

const WAIT_TIMEOUT: number = 2000;

export class PrivateDiscovery {
  private eventPublisher: EventPublisher;
  constructor(
    private readonly relayHandler: RelayHandler,
    private readonly keyManager: ReturnType<typeof createKeyManager>,
    private readonly discoveryServer: DiscoveryServer,
    private readonly privateServers: PrivateServerConfig[],
    private readonly encryptionManager?: EncryptionManager
  ) {
    this.eventPublisher = new EventPublisher(
      this.relayHandler,
      this.keyManager,
      this.encryptionManager
    );
  }

  /**
   * Entrypoint: iterate configured servers and perform handshake sequentially.
   * (Could be parallelised later)
   */
  public async discover(): Promise<void> {
    for (const cfg of this.privateServers) {
      try {
        await this.performHandshake(cfg);
      } catch (err) {
        loggerDiscovery(
          `Private discovery failed for provider ${cfg.providerPubkey}:`,
          err
        );
      }
    }
  }

  private async performHandshake(cfg: PrivateServerConfig): Promise<void> {
    // 1. Send initialize request
    // Build initialize request template
    let initReq: UnsignedEvent =
      this.keyManager.createEventTemplate(REQUEST_KIND);
    initReq.tags.push([TAG_PUBKEY, cfg.providerPubkey]);
    initReq.tags.push([TAG_METHOD, MCPMETHODS.initialize]);
    if (cfg.serverId) {
      initReq.tags.push([TAG_SERVER_IDENTIFIER, cfg.serverId]);
    }
    initReq.content = JSON.stringify({
      method: MCPMETHODS.initialize,
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: this.discoveryServer.getConfig().mcp.name,
          version: this.discoveryServer.getConfig().mcp.version,
        },
      },
    });

    const signedInitReq = this.keyManager.signEvent(initReq);

    // Decide whether to attempt encrypted handshake first
    const encEnabled = !!this.encryptionManager?.isEncryptionEnabled();
    const encMode =
      this.encryptionManager?.getEncryptionMode() ?? EncryptionMode.DISABLED;
    const attemptEncrypted =
      encEnabled &&
      (encMode === EncryptionMode.REQUIRED ||
        encMode === EncryptionMode.OPTIONAL);

    let initResp: Event | undefined;

    if (attemptEncrypted) {
      try {
        await this.eventPublisher.publishEvent(signedInitReq as Event, {
          encrypt: true,
          recipientPublicKey: cfg.providerPubkey,
        });
        loggerDiscovery(
          `Sent ENCRYPTED initialize request to private server ${cfg.providerPubkey} (${cfg.serverId || 'any'})`
        );

        // Wait for encrypted response first
        initResp = await this.waitForResponse(signedInitReq.id, WAIT_TIMEOUT);
      } catch (err) {
        loggerDiscovery('Encrypted initialize publish failed:', err);
      }
    }

    // Fallback to unencrypted if optional mode and no response
    if (!initResp) {
      if (encMode === EncryptionMode.REQUIRED) {
        throw new Error('Encrypted handshake required but failed');
      }
      // Publish plaintext initialize
      await this.relayHandler.publishEvent(signedInitReq as Event);
      loggerDiscovery(
        `Sent UNENCRYPTED initialize request to private server ${cfg.providerPubkey} (${cfg.serverId || 'any'})`
      );
      initResp = await this.waitForResponse(signedInitReq.id, WAIT_TIMEOUT);
    }

    if (!initResp) {
      throw new Error('Timed out waiting for initialize response');
    }

    const announcement: InitializeResult = JSON.parse(initResp.content);

    // Derive serverId from response tag if not provided
    const serverId =
      cfg.serverId ||
      initResp.tags.find(
        (t: string[]) => t[0] === TAG_UNIQUE_IDENTIFIER
      )?.[1] ||
      'unknown-server';

    // Update cfg with encryption support from server response
    const serverSupportsEncryption =
      initResp.tags.find(
        (t: string[]) => t[0] === TAG_SUPPORT_ENCRYPTION
      )?.[1] === 'true';
    cfg.supportsEncryption = serverSupportsEncryption;

    // Send notifications/initialized
    await this.sendInitializedNotification(cfg, serverId);

    // Fetch detailed capability lists and collect them for unified registration
    const allCapabilities: {
      tools?: Tool[];
      resources?: Resource[];
      prompts?: Prompt[];
    } = {};

    // Fetch tools
    await this.fetchAndRegisterCapabilityList(
      MCPMETHODS.toolsList,
      cfg,
      initResp.pubkey,
      (content) => {
        const result = JSON.parse(content) as { tools: Tool[] };
        if (Array.isArray(result.tools) && result.tools.length) {
          allCapabilities.tools = result.tools;
          loggerDiscovery(
            `Fetched ${result.tools.length} tools for ${serverId}`
          );
        }
      }
    );

    // Fetch resources
    await this.fetchAndRegisterCapabilityList(
      MCPMETHODS.resourcesList,
      cfg,
      initResp.pubkey,
      (content) => {
        const result = JSON.parse(content) as { resources: Resource[] };
        if (Array.isArray(result.resources) && result.resources.length) {
          allCapabilities.resources = result.resources;
          loggerDiscovery(
            `Fetched ${result.resources.length} resources for ${serverId}`
          );
        }
      }
    );

    // Fetch prompts
    await this.fetchAndRegisterCapabilityList(
      MCPMETHODS.promptsList,
      cfg,
      initResp.pubkey,
      (content) => {
        const result = JSON.parse(content) as { prompts: Prompt[] };
        if (Array.isArray(result.prompts) && result.prompts.length) {
          allCapabilities.prompts = result.prompts;
          loggerDiscovery(
            `Fetched ${result.prompts.length} prompts for ${serverId}`
          );
        }
      }
    );

    // Use unified registration for all capabilities including server info
    const source = UnifiedRegistration.createPrivateSource(
      initResp.pubkey,
      serverId,
      serverSupportsEncryption
    );

    const capabilities = {
      serverInfo: announcement,
      ...allCapabilities,
    };

    const stats = await this.discoveryServer
      .getUnifiedRegistration()
      .registerServerCapabilities(source, capabilities);

    loggerDiscovery(
      `Private server registration complete for ${serverId}: ` +
        `${stats.toolsCount} tools, ${stats.resourcesCount} resources, ` +
        `${stats.promptsCount} prompts, server registered: ${stats.serverRegistered}`
    );

    loggerDiscovery(`Completed private discovery for server ${serverId}`);
  }

  /**
   * Fetch detailed capability lists (tools, resources, prompts) from a private server.
   * This method accounts for the server's encryption capabilities.
   */
  private async fetchAndRegisterCapabilityList(
    methodConst: (typeof MCPMETHODS)[keyof typeof MCPMETHODS],
    cfg: PrivateServerConfig,
    providerPubkey: string,
    onContent: (content: string) => void
  ): Promise<void> {
    const req = this.keyManager.createEventTemplate(REQUEST_KIND);
    req.tags.push([TAG_PUBKEY, providerPubkey]);
    req.tags.push([TAG_METHOD, methodConst]);
    if (cfg.serverId) req.tags.push([TAG_SERVER_IDENTIFIER, cfg.serverId]);
    req.content = JSON.stringify({ method: methodConst });

    const signedReq = this.keyManager.signEvent(req);

    const encMode =
      this.encryptionManager?.getEncryptionMode() ?? EncryptionMode.DISABLED;
    const attemptEncrypted =
      !!this.encryptionManager?.isEncryptionEnabled() &&
      encMode !== EncryptionMode.DISABLED &&
      cfg.supportsEncryption; // Only attempt encrypted if server indicated support

    let resp: Event | undefined;

    if (attemptEncrypted) {
      try {
        await this.eventPublisher.publishEvent(signedReq as Event, {
          encrypt: true,
          recipientPublicKey: providerPubkey,
        });
        resp = await this.waitForResponse(signedReq.id, WAIT_TIMEOUT);
      } catch (err) {
        loggerDiscovery('Encrypted capability request failed:', err);
        // Do not throw here, allow fallback to unencrypted if not required
      }
    }

    if (!resp) {
      if (encMode === EncryptionMode.REQUIRED) {
        throw new Error('Encrypted capability list required but no response');
      }
      // fallback plaintext
      await this.relayHandler.publishEvent(signedReq as Event);
      resp = await this.waitForResponse(signedReq.id, WAIT_TIMEOUT);
    }

    if (resp) onContent(resp.content);
  }

  private async waitForResponse(
    requestId: string,
    timeoutMs: number
  ): Promise<Event | undefined> {
    return new Promise<Event | undefined>((resolve) => {
      const kinds = [RESPONSE_KIND];

      // If encryption enabled, also listen for gift wrap kind
      const includeEncrypted = this.encryptionManager?.isEncryptionEnabled();
      if (includeEncrypted) {
        kinds.push(GIFT_WRAP_KIND);
      }

      const sub = this.relayHandler.subscribeToRequests(
        async (event: Event) => {
          try {
            // Plain response path
            if (
              event.kind === RESPONSE_KIND &&
              event.tags.some(
                (t: string[]) => t[0] === TAG_EVENT_ID && t[1] === requestId
              )
            ) {
              sub.close();
              clearTimeout(timer);
              resolve(event);
              return;
            }

            // Encrypted path - only check gift wrap events
            if (includeEncrypted && event.kind === GIFT_WRAP_KIND) {
              try {
                const decrypted =
                  await this.encryptionManager!.decryptEventAndExtractSender(
                    event,
                    this.keyManager.getPrivateKey()
                  );
                if (
                  decrypted &&
                  decrypted.decryptedEvent.kind === RESPONSE_KIND
                ) {
                  const respEvent = decrypted.decryptedEvent as Event;
                  if (
                    respEvent.tags?.some(
                      (t: string[]) =>
                        t[0] === TAG_EVENT_ID && t[1] === requestId
                    )
                  ) {
                    sub.close();
                    clearTimeout(timer);
                    resolve(respEvent);
                  }
                }
              } catch (decryptError) {
                // Silently ignore decryption failures for non-matching events
                loggerDiscovery(
                  'Decryption failed for event (likely not for us):',
                  decryptError
                );
              }
            }
          } catch (error) {
            loggerDiscovery('Error processing response event:', error);
          }
        },
        {
          kinds,
          since: Math.floor(Date.now() / 1000),
        }
      );

      const timer = setTimeout(() => {
        sub.close();
        resolve(undefined);
      }, timeoutMs);
    });
  }

  /**
   * Send initialized notification with proper encryption handling
   */
  private async sendInitializedNotification(
    cfg: PrivateServerConfig,
    serverId: string
  ): Promise<void> {
    const initNotif: UnsignedEvent =
      this.keyManager.createEventTemplate(REQUEST_KIND);
    initNotif.tags.push([TAG_PUBKEY, cfg.providerPubkey]);
    initNotif.tags.push([TAG_METHOD, MCPMETHODS.notificationsInitialized]);
    if (cfg.serverId) {
      initNotif.tags.push([TAG_SERVER_IDENTIFIER, cfg.serverId]);
    }
    initNotif.content = JSON.stringify({
      method: MCPMETHODS.notificationsInitialized,
    });
    const signedInitNotif = this.keyManager.signEvent(initNotif);

    // Use EventPublisher to handle encryption properly
    const encMode =
      this.encryptionManager?.getEncryptionMode() ?? EncryptionMode.DISABLED;
    const attemptEncrypted =
      !!this.encryptionManager?.isEncryptionEnabled() &&
      encMode !== EncryptionMode.DISABLED &&
      cfg.supportsEncryption; // Only attempt encrypted if server indicated support

    if (attemptEncrypted) {
      try {
        await this.eventPublisher.publishEvent(signedInitNotif as Event, {
          encrypt: true,
          recipientPublicKey: cfg.providerPubkey,
        });
        loggerDiscovery(
          `Sent ENCRYPTED initialized notification to ${serverId}`
        );
      } catch (err) {
        // Only throw if encryption is strictly required
        if (encMode === EncryptionMode.REQUIRED) {
          throw new Error(`Failed to send encrypted notification: ${err}`);
        }
        // Fallback to unencrypted for optional mode
        loggerDiscovery(
          'Encrypted notification failed, falling back to unencrypted:',
          err
        );
        await this.relayHandler.publishEvent(signedInitNotif as Event);
        loggerDiscovery(
          `Sent UNENCRYPTED initialized notification to ${serverId}`
        );
      }
    } else {
      await this.relayHandler.publishEvent(signedInitNotif as Event);
      loggerDiscovery(
        `Sent UNENCRYPTED initialized notification to ${serverId}`
      );
    }
  }
}
