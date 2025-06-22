import type { Event as NostrEvent } from 'nostr-tools';
import type { PingRequest } from '@modelcontextprotocol/sdk/types.js';
import { BaseExecutor } from './base-executor';
import type { ExecutionContext, Capability } from './base-interfaces';
import type { KeyManager, RelayHandler } from '@dvmcp/commons/nostr';
import type { EncryptionManager } from '@dvmcp/commons/encryption';
import type { ServerRegistry } from './server-registry';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  TAG_METHOD,
  TAG_PUBKEY,
  TAG_SERVER_IDENTIFIER,
  loggerDiscovery,
} from '@dvmcp/commons/core';

export interface PingResult {
  success: boolean;
  responseTime?: number;
  error?: string;
  response?: NostrEvent;
}

interface PingCapability extends Capability {
  type: 'ping';
  serverPubkey: string;
  serverId?: string;
}

export class PingExecutor extends BaseExecutor<
  PingCapability,
  PingRequest['params'],
  PingResult
> {
  constructor(
    relayHandler: RelayHandler,
    keyManager: KeyManager,
    serverRegistry: ServerRegistry,
    encryptionManager?: EncryptionManager
  ) {
    super(
      relayHandler,
      keyManager,
      { items: new Map() } as any,
      serverRegistry,
      encryptionManager
    );
  }

  public async ping(
    serverPubkey: string,
    serverId?: string,
    params?: PingRequest['params']
  ): Promise<PingResult> {
    const startTime = Date.now();

    loggerDiscovery.debug(
      `Sending ping to server ${serverPubkey}${serverId ? ` (${serverId})` : ''}`
    );

    const pingCapability: PingCapability = {
      id: `ping-${serverPubkey}-${Date.now()}`,
      type: 'ping',
      serverPubkey,
      serverId,
    };

    try {
      const result = await this.execute(
        pingCapability.id,
        pingCapability,
        params
      );
      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;

      loggerDiscovery.error(`Ping failed to ${serverPubkey}: ${error}`);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime,
      };
    }
  }

  protected createRequest(
    id: string,
    item: PingCapability,
    params: PingRequest['params']
  ): NostrEvent {
    const request = this.keyManager.createEventTemplate(REQUEST_KIND);

    const tags: string[][] = [
      [TAG_METHOD, 'ping'],
      [TAG_PUBKEY, item.serverPubkey],
    ];

    if (item.serverId) {
      tags.push([TAG_SERVER_IDENTIFIER, item.serverId]);
    }

    request.content = JSON.stringify({ method: 'ping', params });
    request.tags = tags;

    return this.keyManager.signEvent(request);
  }

  protected async handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: PingResult) => void,
    reject: (reason: Error) => void
  ): Promise<void> {
    const responseTime = Date.now() - context.createdAt;

    if (event.kind === RESPONSE_KIND) {
      try {
        const responseContent = JSON.parse(event.content);

        if (responseContent.error) {
          this.cleanupExecution(context.executionId);
          resolve({
            success: false,
            error: responseContent.error.message || 'Server error',
            response: event,
            responseTime,
          });
          return;
        }

        this.cleanupExecution(context.executionId);
        resolve({
          success: true,
          response: event,
          responseTime,
        });
      } catch (error) {
        this.cleanupExecution(context.executionId);
        resolve({
          success: false,
          error: 'Invalid response format',
          response: event,
          responseTime,
        });
      }
    }
  }

  public cleanup(): void {
    super.cleanup();
    loggerDiscovery.debug('PingExecutor cleaned up');
  }
}
