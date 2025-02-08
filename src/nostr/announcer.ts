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
        ['d', 'dvm-announcement'],
        ['k', '5600'],
        ['k', '5601'],
        ['capabilities', 'mcp-1.0'],
        ['t', 'mcp'],
      ],
    });

    await this.relayHandler.publishEvent(event);
  }
}
