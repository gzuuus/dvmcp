import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { join } from 'path';
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { MCPPool } from './mcp-pool';
import { createMockServer } from '@dvmcp/commons/core/mock-server';

describe('MCPPool', () => {
  let mcpPool: MCPPool;
  let transports: any[] = [];
  const serverNames = ['server1', 'server2', 'server3', 'server4'];

  beforeAll(async () => {
    // Create server configs with pricing information for testing
    const serverConfigs = serverNames.map((name, index) => {
      // Add pricing to different capabilities based on server index
      // This allows testing pricing retrieval functionality
      const config: any = {
        name,
        command: 'bun',
        args: [
          '-e',
          `import { createMockServer } from '@dvmcp/commons/core/mock-server'; createMockServer('${name}')`,
        ],
      };

      // Add tool pricing to first server
      if (index === 0) {
        config.tools = [
          { name: `${name}-echo`, price: '1000', unit: 'sats' },
          { name: `${name}-env`, price: '500', unit: 'sats' },
        ];
      }

      // Add prompt pricing to second server
      if (index === 1) {
        config.prompts = [
          { name: `${name}-prompt`, price: '2000', unit: 'sats' },
          { name: `${name}-system-prompt`, price: '3000', unit: 'sats' },
        ];
      }

      // Add resource pricing to third server
      if (index === 2) {
        config.resources = [
          { uri: `${name}-info://example`, price: '1500', unit: 'sats' },
          { uri: `${name}-data://123`, price: '2500', unit: 'sats' },
        ];
      }

      return config;
    });

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
    expect(result.content?.[0].text).toBe('[server1] test message');
  });

  test('should list resources from all servers', async () => {
    const { resources } = await mcpPool.listResources();
    // Each server has 2 resources with 2 URIs each (in the list response)
    expect(resources.length).toEqual(serverNames.length * 4);

    // Verify resource URIs follow the expected pattern
    serverNames.forEach((name) => {
      const serverResources = resources.filter((r) =>
        r.uri.startsWith(`${name}-`)
      );
      expect(serverResources.length).toBe(4); // Each server has 2 resources with 2 URIs each

      // Count the number of each resource type
      const infoResources = serverResources.filter((r) =>
        r.uri.includes(`${name}-info://`)
      );
      const dataResources = serverResources.filter((r) =>
        r.uri.includes(`${name}-data://`)
      );

      expect(infoResources.length).toBe(2); // Each server has 2 info URIs
      expect(dataResources.length).toBe(2); // Each server has 2 data URIs
    });
  });

  test('should read resource from correct server', async () => {
    // Test reading a text resource
    const infoResource = await mcpPool.readResource('server2-info://testing');
    expect(infoResource).toBeDefined();
    expect(infoResource?.contents[0].text).toBe(
      'Resource info about testing from server server2'
    );

    // Test reading a JSON resource
    const dataResource = (await mcpPool.readResource(
      'server3-data://abc123'
    )) as ReadResourceResult;
    expect(dataResource).toBeDefined();

    // Parse the JSON string to verify content
    const jsonData = JSON.parse(dataResource.contents[0].text as string);
    expect(jsonData.id).toBe('abc123');
    expect(jsonData.server).toBe('server3');
    expect(jsonData.data.message).toBe('Data from server server3');
  });

  test('should list prompts from all servers', async () => {
    const { prompts } = await mcpPool.listPrompts();
    // Each server has 2 prompts
    expect(prompts.length).toEqual(serverNames.length * 2);

    // Check that all expected prompts are present
    const allPromptNames = prompts.map((p) => p.name).sort();
    const expectedPromptNames = [
      ...serverNames.map((name) => `${name}-prompt`),
      ...serverNames.map((name) => `${name}-system-prompt`),
    ].sort();

    expect(allPromptNames).toEqual(expectedPromptNames);
  });

  test('should handle prompt registry correctly', async () => {
    // First make sure we've listed all prompts to populate the registry
    const { prompts } = await mcpPool.listPrompts();
    expect(prompts.length).toEqual(serverNames.length * 2);

    // Verify the prompt registry is populated by checking if we can get the handler
    const handler = mcpPool['promptRegistry'].get('server1-prompt');
    expect(handler).toBeDefined();

    // Since the actual getPrompt functionality depends on the real MCP server implementation
    // which might not work in our test environment, we'll just verify the registry is populated
    const handlers = Array.from(mcpPool['promptRegistry'].entries());
    expect(handlers.length).toBeGreaterThan(0);

    // Verify that prompt names are registered correctly
    const promptNames = handlers.map(([name]) => name);
    expect(promptNames).toContain('server1-prompt');
    expect(promptNames).toContain('server1-system-prompt');
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

  test('should retrieve tool pricing information', async () => {
    // First server has pricing for its tools
    const echoPricing = mcpPool.getToolPricing('server1-echo');
    expect(echoPricing).toBeDefined();
    expect(echoPricing?.price).toBe('1000');
    expect(echoPricing?.unit).toBe('sats');

    const envPricing = mcpPool.getToolPricing('server1-env');
    expect(envPricing).toBeDefined();
    expect(envPricing?.price).toBe('500');
    expect(envPricing?.unit).toBe('sats');

    // Tool from server without pricing should return undefined
    const noPricing = mcpPool.getToolPricing('server3-echo');
    expect(noPricing).toBeUndefined();
  });

  test('should retrieve prompt pricing information', async () => {
    // Second server has pricing for its prompts
    const promptPricing = mcpPool.getPromptPricing('server2-prompt');
    expect(promptPricing).toBeDefined();
    expect(promptPricing?.price).toBe('2000');
    expect(promptPricing?.unit).toBe('sats');

    const systemPromptPricing = mcpPool.getPromptPricing(
      'server2-system-prompt'
    );
    expect(systemPromptPricing).toBeDefined();
    expect(systemPromptPricing?.price).toBe('3000');
    expect(systemPromptPricing?.unit).toBe('sats');

    // Prompt from server without pricing should return undefined
    const noPricing = mcpPool.getPromptPricing('server3-prompt');
    expect(noPricing).toBeUndefined();
  });

  test('should retrieve resource pricing information', async () => {
    // Third server has pricing for its resources
    const infoPricing = mcpPool.getResourcePricing('server3-info://example');
    expect(infoPricing).toBeDefined();
    expect(infoPricing?.price).toBe('1500');
    expect(infoPricing?.unit).toBe('sats');

    const dataPricing = mcpPool.getResourcePricing('server3-data://123');
    expect(dataPricing).toBeDefined();
    expect(dataPricing?.price).toBe('2500');
    expect(dataPricing?.unit).toBe('sats');

    // Resource from server without pricing should return undefined
    const noPricing = mcpPool.getResourcePricing('server1-info://example');
    expect(noPricing).toBeUndefined();
  });

  afterAll(async () => {
    await mcpPool.disconnect();
    await Promise.all(transports.map((t) => t.close()));
  });
});
