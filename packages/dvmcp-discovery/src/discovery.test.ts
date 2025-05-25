import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import { DiscoveryServer } from './discovery-server';
import { createMockServer, stop as stopRelay } from '@dvmcp/commons/nostr/mock-relay';
import {
  type Tool,
  type Resource,
  GetPromptResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

describe('DiscoveryServer E2E', () => {
  let discoveryServer: DiscoveryServer;
  let relayConnected = false;

  beforeAll(async () => {
    // Use a different port for this test to avoid conflicts
    createMockServer(3335);
    relayConnected = true;

    const testConfig = {
      nostr: {
        privateKey:
          'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        relayUrls: ['ws://localhost:3335'],
      },
      mcp: {
        name: 'test-discovery',
        version: '0.0.1',
        about: 'Test discovery server',
      },
      featureFlags: {
        interactive: true,
      },
    };

    discoveryServer = new DiscoveryServer(testConfig);
    await discoveryServer.start();
  });
  afterAll(async () => {
    if (discoveryServer) {
      discoveryServer.cleanup();
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
    const toolIds = Array.from(toolRegistry.listToolsWithIds()).map(
      ([id]) => id
    );
    console.log('Available tool IDs:', toolIds);

    const toolId = toolIds.find((id) => id.startsWith(`${mockTool.name}`));
    expect(toolId).toBeDefined();
    console.log('Selected tool ID:', toolId);

    console.log('Executing tool...');

    const result = await discoveryServer['toolExecutor'].executeTool(toolId!, {
      text: 'Hello from test',
      name: mockTool.name,
    });

    console.log('Execution result:', result);
    CallToolResultSchema.parse(result);
    expect(result).toBeDefined();
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: '[test] Hello from test',
        },
      ],
    });
  });

  test('should list discovered resources', async () => {
    const resources = await discoveryServer.listResources();
    console.log('Number of resources:', resources.length);
    console.log('Final discovered resources:', resources);

    expect(resources.length).toBeGreaterThan(0);
    const mockResource = resources.find((r) => r.uri === 'test://resource');
    expect(mockResource).toBeDefined();
    expect(mockResource?.mimeType).toBe('text/plain');
  });

  test('should read discovered resource', async () => {
    const resources = await discoveryServer.listResources();
    const mockResource = resources.find(
      (r) => r.uri === 'test://resource'
    ) as Resource;
    expect(mockResource).toBeDefined();
    console.log('Found resource:', mockResource);

    const resourceRegistry = discoveryServer['resourceRegistry'];
    const resourceIds = Array.from(resourceRegistry.listResourcesWithIds()).map(
      ([id]) => id
    );
    console.log('Available resource IDs:', resourceIds);

    const resourceId = resourceIds.find((id) => id.startsWith(`test-resource`));
    expect(resourceId).toBeDefined();
    console.log('Selected resource ID:', resourceId);

    console.log('Reading resource...');

    const result = await discoveryServer['resourceExecutor'].executeResource(
      resourceId!,
      mockResource
    );
    ReadResourceResultSchema.parse(result);
    console.log('Resource content:', result);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('contents');
    expect(result.contents[0]).toHaveProperty('text');
    expect(result.contents[0].text).toContain(
      'This is a test resource content'
    );
  });

  test('should list discovered prompts', async () => {
    const prompts = await discoveryServer.listPrompts();
    console.log('Number of prompts:', prompts.length);
    console.log('Final discovered prompts:', prompts);

    expect(prompts.length).toBeGreaterThan(0);
    const mockPrompt = prompts.find((p) => p.name === 'test-prompt');
    expect(mockPrompt).toBeDefined();
    expect(mockPrompt?.description).toBe('Test prompt for unit tests');
  });

  test('should execute discovered prompt', async () => {
    const prompts = await discoveryServer.listPrompts();
    const mockPrompt = prompts.find((p) => p.name === 'test-prompt');
    expect(mockPrompt).toBeDefined();
    console.log('Found prompt:', mockPrompt);

    const promptRegistry = discoveryServer['promptRegistry'];
    const promptIds = Array.from(promptRegistry.listPromptsWithIds()).map(
      ([id]) => id
    );
    console.log('Available prompt IDs:', promptIds);

    const promptId = promptIds.find((id) => id.includes(`test-prompt`));
    expect(promptId).toBeDefined();
    console.log('Selected prompt ID:', promptId);

    console.log('Executing prompt...');

    const result = await discoveryServer['promptExecutor'].executePrompt(
      promptId!,
      {
        input: 'Test input',
      }
    );
    GetPromptResultSchema.parse(result);
    console.log('Prompt execution result:', result);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('messages');
    expect(result.messages).toBeInstanceOf(Array);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]).toHaveProperty('role');
    expect(result.messages[0]).toHaveProperty('content');
  });
});
