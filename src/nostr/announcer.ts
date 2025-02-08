import { CONFIG } from '../config';
import { RelayHandler } from './relay';
import { keyManager } from './keys';

export class NostrAnnouncer {
  private relayHandler: RelayHandler;

  constructor() {
    this.relayHandler = new RelayHandler(CONFIG.nostr.relayUrls);
  }

  async announceService() {
    const event = keyManager.signEvent({
      ...keyManager.createEventTemplate(31990),
      content: JSON.stringify({
        name: CONFIG.mcp.name,
        about: CONFIG.mcp.about,
      }),
      tags: [
        ['d', Math.random().toString(36).substring(7)],
        ['k', '5000'],
        ['k', '5001'],
        ['capabilities', 'mcp-1.0'],
        ['t', 'mcp'],
      ],
    });

    await this.relayHandler.publishEvent(event);
  }
}
