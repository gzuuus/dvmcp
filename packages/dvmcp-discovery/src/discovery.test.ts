import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { DiscoveryServer } from './discovery-server';
import { CONFIG } from './config';
import {
  server as mockRelay,
  stop as stopRelay,
} from '@dvmcp/commons/nostr/mock-relay';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

describe('DiscoveryServer E2E', () => {
  let discoveryServer: DiscoveryServer;
  let relayConnected = false;

  beforeAll(async () => {
    mockRelay;
    relayConnected = true;

    const testConfig = {
      ...CONFIG,
      nostr: {
        ...CONFIG.nostr,
        relayUrls: ['ws://localhost:3334'],
      },
    };

    discoveryServer = new DiscoveryServer(testConfig);
    await discoveryServer.start();
  });
  afterAll(async () => {
    if (discoveryServer) {
      await discoveryServer.cleanup();
    }

    stopRelay();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test('should list discovered tools', async () => {
    const tools = await discoveryServer.listTools();
    console.log('Number of tools:', tools.length);
    console.log('Final discovered tools:', tools);

    expect(tools.length).toBeGreaterThan(0);
    const mockTool = tools.find((t) => t.name === 'test-echo');
    expect(mockTool).toBeDefined();
    expect(mockTool?.description).toBe('Echo test tool');
  });

  test('should execute discovered tool', async () => {
    const tools = await discoveryServer.listTools();
    const mockTool = tools.find((t) => t.name === 'test-echo') as Tool;
    expect(mockTool).toBeDefined();
    console.log('Found tool:', mockTool);

    const toolRegistry = discoveryServer['toolRegistry'];
    const toolIds = Array.from(toolRegistry['discoveredTools'].keys());
    console.log('Available tool IDs:', toolIds);

    const toolId = toolIds.find((id) => id.startsWith(`${mockTool.name}`));
    expect(toolId).toBeDefined();
    console.log('Selected tool ID:', toolId);

    console.log('Executing tool...');

    const result = await discoveryServer['toolExecutor'].executeTool(
      toolId!,
      mockTool,
      {
        text: 'Hello from test',
      }
    );

    console.log('Execution result:', result);
    expect(result).toBeDefined();
    expect(result).toEqual([
      {
        type: 'text',
        text: '[test] Hello from test',
      },
    ]);
  });
});
