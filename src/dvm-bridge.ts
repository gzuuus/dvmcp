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
  private isRunning: boolean = false;

  constructor() {
    console.log('Initializing DVM Bridge...');
    this.mcpClient = new MCPClientHandler();
    this.nostrAnnouncer = new NostrAnnouncer();
    this.relayHandler = new RelayHandler(CONFIG.nostr.relayUrls);
  }

  async start() {
    if (this.isRunning) {
      console.log('Bridge is already running');
      return;
    }

    console.log('Starting DVM Bridge...');
    try {
      console.log('Connecting to MCP server...');
      await this.mcpClient.connect();

      const tools = await this.mcpClient.listTools();
      console.log('Available MCP tools:', tools);

      console.log('Announcing service to Nostr network...');
      await this.nostrAnnouncer.announceService();

      console.log('Setting up request handlers...');
      this.relayHandler.subscribeToRequests(this.handleRequest.bind(this));

      this.isRunning = true;
      console.log('DVM Bridge is now running and ready to handle requests');
    } catch (error) {
      console.error('Failed to start DVM Bridge:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping DVM Bridge...');
    try {
      await this.mcpClient.disconnect();
      this.relayHandler.cleanup();
      this.isRunning = false;
      console.log('DVM Bridge stopped successfully');
    } catch (error) {
      console.error('Error stopping DVM Bridge:', error);
      throw error;
    }
  }

  private async handleRequest(event: Event) {
    try {
      if (event.kind === 5600) {
        const tools = await this.mcpClient.listTools();

        const response = keyManager.signEvent({
          ...keyManager.createEventTemplate(6600),
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
      } else if (event.kind === 5601) {
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
            ...keyManager.createEventTemplate(6601),
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
}

if (import.meta.main) {
  console.log('Starting DVM-MCP Bridge service...');
  const bridge = new DVMBridge();

  const shutdown = async () => {
    console.log('Shutting down...');
    try {
      await bridge.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await bridge.start();
  } catch (error) {
    console.error('Failed to start service:', error);
    process.exit(1);
  }
}
