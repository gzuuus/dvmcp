import { MCPClientHandler } from './mcp-client';
import { NostrAnnouncer } from './nostr/announcer';
import { RelayHandler } from './nostr/relay';
import { keyManager } from './nostr/keys';
import { CONFIG } from './config';
import type { Event } from 'nostr-tools/pure';

export class DVMBridge {
  private mcpClient: MCPClientHandler;
  private nostrAnnouncer: NostrAnnouncer;
  private relayHandler: RelayHandler;

  constructor() {
    this.mcpClient = new MCPClientHandler();
    this.nostrAnnouncer = new NostrAnnouncer();
    this.relayHandler = new RelayHandler(CONFIG.nostr.relayUrls);
  }

  async start() {
    await this.mcpClient.connect();

    const tools = await this.mcpClient.listTools();
    console.log('Available MCP tools:', tools);

    await this.nostrAnnouncer.announceService();

    this.relayHandler.subscribeToRequests(this.handleRequest.bind(this));
  }

  private async handleRequest(event: Event) {
    try {
      if (event.kind === 5000) {
        const tools = await this.mcpClient.listTools();

        const response = keyManager.signEvent({
          ...keyManager.createEventTemplate(6000),
          content: JSON.stringify({
            schema_version: '1.0',
            tools,
          }),
          tags: [
            ['e', event.id],
            ['p', event.pubkey],
          ],
        });

        await this.relayHandler.publishEvent(response);
      } else if (event.kind === 5001) {
        const { name, parameters } = JSON.parse(event.content);

        const processingStatus = keyManager.signEvent({
          ...keyManager.createEventTemplate(7000),
          tags: [
            ['status', 'processing'],
            ['e', event.id],
            ['p', event.pubkey],
          ],
        });
        await this.relayHandler.publishEvent(processingStatus);

        try {
          const result = await this.mcpClient.callTool(name, parameters);

          const successStatus = keyManager.signEvent({
            ...keyManager.createEventTemplate(7000),
            tags: [
              ['status', 'success'],
              ['e', event.id],
              ['p', event.pubkey],
            ],
          });
          await this.relayHandler.publishEvent(successStatus);

          const response = keyManager.signEvent({
            ...keyManager.createEventTemplate(6001),
            content: JSON.stringify(result),
            tags: [
              ['e', event.id],
              ['p', event.pubkey],
            ],
          });
          await this.relayHandler.publishEvent(response);
        } catch (error) {
          const errorStatus = keyManager.signEvent({
            ...keyManager.createEventTemplate(7000),
            tags: [
              [
                'status',
                'error',
                error instanceof Error ? error.message : 'Unknown error',
              ],
              ['e', event.id],
              ['p', event.pubkey],
            ],
          });
          await this.relayHandler.publishEvent(errorStatus);
        }
      }
    } catch (error) {
      console.error('Error handling request:', error);
    }
  }

  async stop() {
    await this.mcpClient.disconnect();
    this.relayHandler.cleanup();
  }
}
