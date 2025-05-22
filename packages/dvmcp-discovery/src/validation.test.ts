import { expect, test, describe } from 'bun:test';
import { ToolRegistry } from './tool-registry';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Tool, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError } from 'zod';
import {
  SERVER_ANNOUNCEMENT_KIND,
  REQUEST_KIND,
  TAG_UNIQUE_IDENTIFIER,
  TAG_CAPABILITY,
  TAG_SERVER_IDENTIFIER,
  TAG_KIND,
} from '@dvmcp/commons/constants';

describe('Tool Schema Validation', () => {
  describe('ToolRegistry Validation', () => {
    const mcpServer = new McpServer({
      name: 'test-server',
      version: '1.0.0',
    });
    const registry = new ToolRegistry(mcpServer);

    test('should validate and register a valid tool', () => {
      const validTool: Tool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            number: { type: 'number' },
            boolean: { type: 'boolean' },
            integer: { type: 'integer' },
          },
          required: ['text'],
        },
      };

      const parsed = ToolSchema.parse(validTool);
      expect(parsed).toEqual(validTool);

      registry.registerTool('test:test-tool', validTool, 'test-pubkey');
      const retrievedTool = registry.getTool('test:test-tool');

      const { id, type, ...toolWithoutIdAndType } = retrievedTool as any;
      expect(toolWithoutIdAndType).toEqual(validTool);
    });

    test('should reject invalid tool schema', () => {
      const invalidTool = {
        name: 'invalid-tool',
        description: 'Invalid tool',
        inputSchema: {
          type: 'not-a-valid-type',
          properties: {
            test: { type: 'invalid' },
          },
        },
      };

      expect(() => {
        // @ts-expect-error Testing invalid type
        registry.registerTool('test:invalid-tool', invalidTool);
      }).toThrow(ZodError);

      try {
        // @ts-expect-error Testing invalid type
        registry.registerTool('test:invalid-tool', invalidTool);
      } catch (error) {
        expect(error instanceof ZodError).toBe(true);
      }

      const retrievedTool = registry.getTool('test:invalid-tool');
      expect(retrievedTool).toBeUndefined();
    });

    test('should correctly map JSON Schema to Zod schema', () => {
      const tool: Tool = {
        name: 'schema-test',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            number: { type: 'number' },
            boolean: { type: 'boolean' },
            integer: { type: 'integer' },
          },
          required: ['text'],
        },
      };

      registry.registerTool('test:schema-test', tool, 'test-pubkey');

      const zodSchema = (registry as any).mapJsonSchemaToZod(tool.inputSchema);

      const schema = z.object(zodSchema);

      const validData = {
        text: 'test',
        number: 123,
        boolean: true,
        integer: 42,
      };
      expect(() => schema.parse(validData)).not.toThrow();

      const invalidData = {
        number: 'invalid',
      };
      expect(() => schema.parse(invalidData)).toThrow();
    });
  });
  describe('Nostr Event to Tool Conversion', () => {
    test('should correctly parse valid server announcement event', () => {
      const mockServerAnnouncement = {
        kind: SERVER_ANNOUNCEMENT_KIND,
        content: JSON.stringify({
          jsonrpc: '2.0',
          result: {
            name: 'Test MCP Server',
            version: '1.0.0',
            capabilities: {
              tools: true,
              resources: true,
              prompts: false,
            },
          },
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          [TAG_UNIQUE_IDENTIFIER, 'server-123'],
          [TAG_KIND, `${REQUEST_KIND}`],
          [TAG_CAPABILITY, 'tools'],
          [TAG_CAPABILITY, 'resources'],
        ],
      };

      const mockToolsList = {
        kind: SERVER_ANNOUNCEMENT_KIND + 1,
        content: JSON.stringify({
          result: {
            tools: [
              {
                name: 'test-echo',
                description: 'Echo test tool',
                inputSchema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                  },
                  required: ['text'],
                },
              },
            ],
          },
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          [TAG_UNIQUE_IDENTIFIER, 'tools-list-123'],
          [TAG_SERVER_IDENTIFIER, 'server-123'],
          [TAG_CAPABILITY, 'test-echo'],
        ],
      };

      const serverContent = JSON.parse(mockServerAnnouncement.content);
      expect(serverContent.jsonrpc).toBe('2.0');
      expect(serverContent.result.name).toBe('Test MCP Server');
      expect(serverContent.result.capabilities.tools).toBe(true);

      const toolsContent = JSON.parse(mockToolsList.content);
      const tool = toolsContent.result.tools[0] as Tool;

      expect(ToolSchema.parse(tool));

      expect(tool.name).toBe('test-echo');
      expect(tool.description).toBe('Echo test tool');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toHaveProperty('text');
    });

    test('should reject malformed tools list event', () => {
      const malformedToolsList = {
        kind: SERVER_ANNOUNCEMENT_KIND + 1,
        content: JSON.stringify({
          jsonrpc: '2.0',
          result: {
            tools: [
              {
                name: 'test-echo',
              },
            ],
          },
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          [TAG_UNIQUE_IDENTIFIER, 'tools-list-123'],
          [TAG_SERVER_IDENTIFIER, 'server-123'],
          [TAG_CAPABILITY, 'test-echo'],
        ],
      };

      const content = JSON.parse(malformedToolsList.content);
      const tool = content.result.tools[0] as Tool;

      expect(() => ToolSchema.parse(tool));
    });

    test('should validate tags in server announcement event', () => {
      const mockServerAnnouncement = {
        kind: SERVER_ANNOUNCEMENT_KIND,
        content: JSON.stringify({
          jsonrpc: '2.0',
          result: {
            name: 'Test MCP Server',
            version: '1.0.0',
            capabilities: {
              tools: true,
              resources: true,
              prompts: false,
            },
          },
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          [TAG_UNIQUE_IDENTIFIER, 'server-123'],
          [TAG_KIND, `${REQUEST_KIND}`],
          [TAG_CAPABILITY, 'tools'],
          [TAG_CAPABILITY, 'resources'],
        ],
      };

      const hasUniqueIdTag = mockServerAnnouncement.tags.some(
        ([key, value]) =>
          key === TAG_UNIQUE_IDENTIFIER && value === 'server-123'
      );
      expect(hasUniqueIdTag).toBe(true);

      const hasKindTag = mockServerAnnouncement.tags.some(
        ([key, value]) => key === TAG_KIND && value === `${REQUEST_KIND}`
      );
      expect(hasKindTag).toBe(true);

      const hasCapabilityTags = mockServerAnnouncement.tags.filter(
        ([key]) => key === TAG_CAPABILITY
      );
      expect(hasCapabilityTags.length).toBe(2);
    });
  });
});
