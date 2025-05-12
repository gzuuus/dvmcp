import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MCPPool } from './mcp-pool';
import { createMockServer } from '@dvmcp/commons/mock-server';

describe('MCPPool', () => {
  let mcpPool: MCPPool;
  let transports: any[] = [];
  const serverNames = ['server1', 'server2', 'server3', 'server4'];

  beforeAll(async () => {
    const mockServerPath = join(
      import.meta.dir,
      '../../dvmcp-commons/mock-server.ts'
    );

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

  test('should list tools from all servers', async () => {
    const { tools } = await mcpPool.listTools();
    // Each server now has 2 tools: echo and env
    expect(tools.length).toEqual(serverNames.length * 2);

    // Check that all echo tools are present
    const echoTools = tools.filter((t) => t.name.endsWith('-echo'));
    expect(echoTools.map((t) => t.name).sort()).toEqual(
      serverNames.map((name) => `${name}-echo`).sort()
    );

    // Check that all env tools are present
    const envTools = tools.filter((t) => t.name.endsWith('-env'));
    expect(envTools.map((t) => t.name).sort()).toEqual(
      serverNames.map((name) => `${name}-env`).sort()
    );
  });

  test('should call tool on correct server', async () => {
    const result = (await mcpPool.callTool('server1-echo', {
      text: 'test message',
    })) as CallToolResult;
    expect(result.content[0].text).toBe('[server1] test message');
  });

  test('should properly handle server configuration with environment variables', () => {
    const envVars = {
      TEST_API_KEY: 'test-api-key-123',
      TEST_DEBUG: 'true',
      TEST_ENV: 'testing',
    };

    // Create a server config with environment variables
    const serverConfig = {
      name: 'test-server',
      command: 'node',
      args: ['server.js'],
      env: envVars,
    };

    // Create a pool with the config (but don't connect)
    const pool = new MCPPool([serverConfig]);

    // Verify that the environment variables are stored correctly
    const storedEnv = pool.getServerEnvironment('server-0');
    expect(storedEnv).toBeDefined();
    expect(storedEnv).toEqual(envVars);

    // Verify that the server config is stored correctly
    const configs = pool.getServerConfigs();
    expect(configs.length).toBe(1);
    expect(configs[0].env).toEqual(envVars);
  });

  afterAll(async () => {
    await mcpPool.disconnect();
    await Promise.all(transports.map((t) => t.close()));
  });
});
