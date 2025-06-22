import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import type { SubCloser } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND,
  TAG_METHOD,
} from '../core/constants';
import { logger } from '../core/logger';
import { EventEmitter } from 'node:events';

useWebSocketImplementation(WebSocket);

export class RelayHandler {
  private pool: SimplePool;
  private relayUrls: string[];
  private subscriptions: SubCloser[] = [];
  private reconnectInterval?: ReturnType<typeof setTimeout>;
  private emitter = new EventEmitter();

  constructor(relayUrls: string[]) {
    this.pool = new SimplePool();
    this.relayUrls = relayUrls;
    this.startReconnectLoop();
  }

  private startReconnectLoop() {
    this.reconnectInterval = setInterval(() => {
      this.relayUrls.forEach((url) => {
        const normalizedUrl = new URL(url).href;
        if (!this.getConnectionStatus().get(normalizedUrl)) {
          this.ensureRelay(url);
        }
      });
    }, 10000);
  }

  private async ensureRelay(url: string) {
    try {
      await this.pool.ensureRelay(url, { connectionTimeout: 5000 });
      logger.info(`Connected to relay: ${url}`);
      this.emitter.emit('relayReconnected', url);
    } catch (error) {
      logger.error(`Failed to connect to relay ${url}:`, error);
    }
  }

  onRelayReconnected(handler: (url: string) => void) {
    this.emitter.on('relayReconnected', handler);
  }

  async publishEvent(event: Event): Promise<void> {
    try {
      await Promise.any(this.pool.publish(this.relayUrls, event));
      logger.info(
        `Event published(${event.kind}), id: ${event.id.slice(0, 12)}`
      );
    } catch (error) {
      logger.error('Failed to publish event:', error);
      throw error;
    }
  }

  subscribeToRequests(
    onRequest: (event: Event) => void,
    filter?: Filter
  ): SubCloser {
    const defaultFilter: Filter = {
      kinds: [REQUEST_KIND, RESPONSE_KIND, NOTIFICATION_KIND],
      since: Math.floor(Date.now() / 1000),
    };

    const filters: Filter[] = [filter || defaultFilter];

    const sub = this.pool.subscribeMany(this.relayUrls, filters, {
      onevent(event) {
        logger.info(
          `Event received(${event.kind}), id: ${event.id.slice(0, 12)}, pubkey: ${event.pubkey.slice(0, 12)}, method: ${event.tags.find(([tag]) => tag === TAG_METHOD)?.[1]}`
        );
        onRequest(event);
      },
      oneose() {
        logger.debug('Reached end of stored events');
      },
      onclose(reasons) {
        logger.debug('Subscription closed:', reasons);
      },
    });

    this.subscriptions.push(sub);
    return sub;
  }

  async queryEvents(filter: Filter): Promise<Event[]> {
    return await this.pool.querySync(this.relayUrls, filter);
  }

  cleanup() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    this.subscriptions.forEach((sub) => sub.close());
    this.subscriptions = [];
    this.pool.close(this.relayUrls);
  }

  getConnectionStatus(): Map<string, boolean> {
    return this.pool.listConnectionStatus();
  }
}
