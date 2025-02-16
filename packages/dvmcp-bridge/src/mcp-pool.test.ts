import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MCPPool } from './mcp-pool';
import { createMockServer } from 'commons/mock-server';

describe('MCPPool', () => {
  let mcpPool: MCPPool;
  let transports: any[] = [];
  const serverNames = ['server1', 'server2', 'server3', 'server4'];
  beforeAll(async () => {
    const mockServerPath = join(import.meta.dir, 'mock-server.ts');

    const serverConfigs = serverNames.map((name) => ({
      name,
      command: 'bun',
      args: ['run', mockServerPath, name],
    }));

    const servers = await Promise.all(
      serverNames.map((name) => createMockServer(name))
    );
    transports = servers.map((s) => s.transport);

    mcpPool = new MCPPool(serverConfigs);
    await mcpPool.connect();
  });

  afterAll(async () => {
    await mcpPool.disconnect();
    await Promise.all(transports.map((t) => t.close()));
  });

  test('should list tools from all servers', async () => {
    const tools = await mcpPool.listTools();
    expect(tools.length).toEqual(serverNames.length);
    expect(tools.map((t) => t.name).sort()).toEqual(
      serverNames.map((name) => `${name}-echo`).sort()
    );
  });

  test('should call tool on correct server', async () => {
    const result = (await mcpPool.callTool('server1-echo', {
      text: 'test message',
    })) as CallToolResult;
    expect(result.content[0].text).toBe('[server1] test message');
  });
});
