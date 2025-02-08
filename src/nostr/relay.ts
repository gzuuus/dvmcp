import { SimplePool } from 'nostr-tools/pool';
import type { Event } from 'nostr-tools/pure';
import type { SubCloser } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';

useWebSocketImplementation(WebSocket);

export class RelayHandler {
  private pool: SimplePool;
  private relayUrls: string[];
  private subscriptions: SubCloser[] = [];

  constructor(relayUrls: string[]) {
    this.pool = new SimplePool();
    this.relayUrls = relayUrls;
  }

  async publishEvent(event: Event): Promise<void> {
    try {
      await Promise.any(this.pool.publish(this.relayUrls, event));
      console.log(`Event published(${event.kind}):, ${event.id.slice(0, 12)}`);
    } catch (error) {
      console.error('Failed to publish event:', error);
      throw error;
    }
  }

  subscribeToRequests(onRequest: (event: Event) => void): SubCloser {
    const filters: Filter[] = [
      {
        kinds: [5600, 5601],
        since: Math.floor(Date.now() / 1000),
      },
    ];

    const sub = this.pool.subscribeMany(this.relayUrls, filters, {
      onevent(event) {
        onRequest(event);
      },
      oneose() {
        console.log('Reached end of stored events');
      },
    });

    this.subscriptions.push(sub);
    return sub;
  }

  async queryEvents(filter: Filter): Promise<Event[]> {
    return await this.pool.querySync(this.relayUrls, filter);
  }

  cleanup() {
    this.subscriptions.forEach((sub) => sub.close());
    this.subscriptions = [];
    this.pool.close(this.relayUrls);
  }
}
