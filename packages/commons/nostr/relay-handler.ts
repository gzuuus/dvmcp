import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import type { SubCloser } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import { DVM_NOTICE_KIND, TOOL_REQUEST_KIND, TOOL_RESPONSE_KIND } from '../constants';

useWebSocketImplementation(WebSocket);

export class RelayHandler {
  private pool: SimplePool;
  private relayUrls: string[];
  private subscriptions: SubCloser[] = [];
  private reconnectInterval?: ReturnType<typeof setTimeout>;

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
      console.log(`Connected to relay: ${url}`);
    } catch (error) {
      console.log(`Failed to connect to relay ${url}:`, error);
    }
  }

  async publishEvent(event: Event): Promise<void> {
    try {
      await Promise.any(this.pool.publish(this.relayUrls, event));
      console.log(
        `Event published(${event.kind}), id: ${event.id.slice(0, 12)}`
      );
    } catch (error) {
      console.error('Failed to publish event:', error);
      throw error;
    }
  }

  subscribeToRequests(
    onRequest: (event: Event) => void,
    filter?: Filter
  ): SubCloser {
    const defaultFilter: Filter = {
      kinds: [TOOL_REQUEST_KIND, TOOL_RESPONSE_KIND, DVM_NOTICE_KIND],
      since: Math.floor(Date.now() / 1000),
    };

    const filters: Filter[] = [filter || defaultFilter];

    const sub = this.pool.subscribeMany(this.relayUrls, filters, {
      onevent(event) {
        console.log(
          `Event received(${event.kind}), id: ${event.id.slice(0, 12)}`
        );
        onRequest(event);
      },
      oneose() {
        console.log('Reached end of stored events');
      },
      onclose(reasons) {
        console.log('Subscription closed:', reasons);
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
