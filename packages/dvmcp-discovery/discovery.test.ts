import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  CallToolResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

describe('DiscoveryServer', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: 'bun',
      args: ['start'],
    });

    client = new Client(
      {
        name: 'test-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    if (transport) {
      await transport.close();
    }
  });

  test('should list discovered tools', async () => {
    const { tools } = (await client.listTools()) as ListToolsResult;
    console.log('Number of tools:', tools.length);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('should execute discovered tool', async () => {
    const { tools } = (await client.listTools()) as ListToolsResult;
    const mockTool = tools.find((t) => t.name.includes('echo'));
    if (!mockTool) return;
    expect(mockTool).toBeDefined();

    const result = (await client.callTool({
      name: mockTool.name,
      arguments: { text: 'test' },
    })) as CallToolResult;

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
  });
});
