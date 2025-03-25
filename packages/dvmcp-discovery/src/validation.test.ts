import { expect, test, describe } from 'bun:test';
import { ToolRegistry } from './tool-registry';
import { ToolExecutor } from './tool-executor';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';
import { type Tool, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodError } from 'zod';
import {
  DVM_ANNOUNCEMENT_KIND,
  TOOL_REQUEST_KIND,
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
      expect(retrievedTool).toEqual(validTool);
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
    test('should correctly parse valid DVM announcement event', () => {
      const mockDVMAnnouncement = {
        kind: DVM_ANNOUNCEMENT_KIND,
        content: JSON.stringify({
          name: 'Test DVM',
          about: 'A test DVM instance',
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
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'dvm-announcement'],
          ['k', `${TOOL_REQUEST_KIND}`],
          ['capabilities', 'mcp-1.0'],
          ['t', 'mcp'],
          ['t', 'test-echo'],
        ],
      };

      const content = JSON.parse(mockDVMAnnouncement.content);
      const tool = content.tools[0] as Tool;

      expect(ToolSchema.parse(tool));

      expect(tool.name).toBe('test-echo');
      expect(tool.description).toBe('Echo test tool');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toHaveProperty('text');
    });

    test('should reject malformed DVM announcement event', () => {
      const malformedAnnouncement = {
        kind: DVM_ANNOUNCEMENT_KIND,
        content: JSON.stringify({
          name: 'Test DVM',
          about: 'A test DVM instance',
          tools: [
            {
              name: 'test-echo',
              // Missing description and inputSchema
            },
          ],
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'dvm-announcement'],
          ['k', `${TOOL_REQUEST_KIND}`],
        ],
      };

      const content = JSON.parse(malformedAnnouncement.content);
      const tool = content.tools[0] as Tool;

      expect(() => ToolSchema.parse(tool));
    });

    test('should validate tool tags in announcement event', () => {
      const mockDVMAnnouncement = {
        kind: DVM_ANNOUNCEMENT_KIND,
        content: JSON.stringify({
          name: 'Test DVM',
          about: 'A test DVM instance',
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
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'dvm-announcement'],
          ['k', `${TOOL_REQUEST_KIND}`],
          ['capabilities', 'mcp-1.0'],
          ['t', 'mcp'],
          ['t', 'test-echo'],
        ],
      };

      const hasKindTag = mockDVMAnnouncement.tags.some(
        ([key, value]) => key === 'k' && value === `${TOOL_REQUEST_KIND}`
      );
      expect(hasKindTag).toBe(true);

      const hasCapabilitiesTag = mockDVMAnnouncement.tags.some(
        ([key, value]) => key === 'capabilities' && value === 'mcp-1.0'
      );
      expect(hasCapabilitiesTag).toBe(true);
    });
  });
});
