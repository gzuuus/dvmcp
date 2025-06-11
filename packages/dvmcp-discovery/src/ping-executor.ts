import { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  TAG_METHOD,
  TAG_PUBKEY,
  TAG_EVENT_ID,
  TAG_SERVER_IDENTIFIER,
  loggerDiscovery,
} from '@dvmcp/commons/core';
import type { Event, Filter } from 'nostr-tools';

export interface PingOptions {
  timeout?: number; // milliseconds, default 10000 (10 seconds)
}

export interface PingResult {
  success: boolean;
  responseTime?: number; // milliseconds
  error?: string;
  response?: Event;
}

/**
 * Executor for ping functionality - handles sending ping requests to DVMCP servers
 * and waiting for responses to verify connection health
 */
export class PingExecutor {
  private pendingPings = new Map<
    string,
    {
      resolve: (result: PingResult) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(
    private relayHandler: RelayHandler,
    private keyManager: KeyManager
  ) {
    // Subscribe to ping responses
    this.setupResponseSubscription();
  }

  /**
   * Update the relay handler instance
   */
  public updateRelayHandler(relayHandler: RelayHandler): void {
    this.relayHandler = relayHandler;
    this.setupResponseSubscription();
  }

  /**
   * Send a ping request to a specific server
   * @param serverPubkey - Public key of the server to ping
   * @param serverId - Server identifier (optional)
   * @param options - Ping options
   * @returns Promise that resolves with ping result
   */
  public async ping(
    serverPubkey: string,
    serverId?: string,
    options: PingOptions = {}
  ): Promise<PingResult> {
    const timeout = options.timeout || 10000; // 10 seconds default
    const startTime = Date.now();

    loggerDiscovery(
      `Sending ping to server ${serverPubkey}${serverId ? ` (${serverId})` : ''}`
    );

    // Create ping request event
    const tags: string[][] = [
      [TAG_METHOD, 'ping'],
      [TAG_PUBKEY, serverPubkey],
    ];

    if (serverId) {
      tags.push([TAG_SERVER_IDENTIFIER, serverId]);
    }

    const pingEvent = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(REQUEST_KIND),
      content: JSON.stringify({ method: 'ping' }),
      tags,
    });

    // Set up promise to wait for response
    const resultPromise = new Promise<PingResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingPings.delete(pingEvent.id);
        resolve({
          success: false,
          error: 'Ping timeout',
          responseTime: Date.now() - startTime,
        });
      }, timeout);

      this.pendingPings.set(pingEvent.id, {
        resolve: (result: PingResult) => {
          clearTimeout(timeoutId);
          resolve({
            ...result,
            responseTime: Date.now() - startTime,
          });
        },
        timeout: timeoutId,
      });
    });

    try {
      // Send ping request
      await this.relayHandler.publishEvent(pingEvent);
      loggerDiscovery(
        `Ping request sent to ${serverPubkey}, waiting for response...`
      );

      // Wait for response
      const result = await resultPromise;

      if (result.success) {
        loggerDiscovery(
          `Ping successful to ${serverPubkey} in ${result.responseTime}ms`
        );
      } else {
        loggerDiscovery(`Ping failed to ${serverPubkey}: ${result.error}`);
      }

      return result;
    } catch (error) {
      // Clean up pending ping
      const pending = this.pendingPings.get(pingEvent.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingPings.delete(pingEvent.id);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Setup subscription to listen for ping responses
   */
  private setupResponseSubscription(): void {
    const publicKey = this.keyManager.getPublicKey();

    const filter: Filter = {
      kinds: [RESPONSE_KIND],
      '#p': [publicKey],
      since: Math.floor(Date.now() / 1000),
    };

    this.relayHandler.subscribeToRequests(
      (event: Event) => this.handlePingResponse(event),
      filter
    );
  }

  /**
   * Handle incoming ping response events
   */
  private handlePingResponse(event: Event): void {
    try {
      // Find the original request ID from the event tags
      const originalEventId = event.tags.find(
        (tag) => tag[0] === TAG_EVENT_ID
      )?.[1];
      if (!originalEventId) {
        return; // Not a response to our ping
      }

      const pending = this.pendingPings.get(originalEventId);
      if (!pending) {
        return; // Not a ping we're waiting for
      }

      // Remove from pending pings
      this.pendingPings.delete(originalEventId);

      // Parse response
      let responseContent: any;
      try {
        responseContent = JSON.parse(event.content);
      } catch (parseError) {
        pending.resolve({
          success: false,
          error: 'Invalid response format',
          response: event,
        });
        return;
      }

      // Check if it's an error response
      if (responseContent.error) {
        pending.resolve({
          success: false,
          error: responseContent.error.message || 'Server error',
          response: event,
        });
        return;
      }

      // Successful ping response
      pending.resolve({
        success: true,
        response: event,
      });
    } catch (error) {
      console.error('Error handling ping response:', error);
    }
  }

  /**
   * Cleanup method to clear pending pings and subscriptions
   */
  public cleanup(): void {
    // Clear all pending timeouts
    for (const [eventId, pending] of this.pendingPings) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        error: 'Cleanup called',
      });
    }
    this.pendingPings.clear();

    loggerDiscovery('PingExecutor cleaned up');
  }

  /**
   * Get the count of pending pings
   * @returns Number of pending ping requests
   */
  public getPendingPingsCount(): number {
    return this.pendingPings.size;
  }
}
