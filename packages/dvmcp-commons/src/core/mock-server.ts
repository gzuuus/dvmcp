import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export const createMockServer = async (name: string) => {
  const server = new McpServer({
    name: `Mock ${name}`,
    version: '1.0.0',
  });

  // Add echo tool
  server.tool(
    `${name}-echo`,
    `Echo tool for ${name}`,
    {
      text: z.string(),
    },
    async ({ text }) => ({
      content: [{ type: 'text' as const, text: `[${name}] ${text}` }],
    })
  );

  // Add a tool to return environment variables
  server.tool(
    `${name}-env`,
    `Environment variable tool for ${name}`,
    {
      key: z.string().optional(),
    },
    async ({ key }) => {
      if (key) {
        return {
          content: [{ type: 'text' as const, text: process.env[key] || '' }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(process.env) }],
      };
    }
  );

  // Add a simple resource with text content
  server.resource(
    `${name}-info`,
    new ResourceTemplate(`${name}-info://{topic}`, {
      list: async () => ({
        resources: [
          { name: `${name} Info Example`, uri: `${name}-info://example` },
          { name: `${name} Info Testing`, uri: `${name}-info://testing` },
        ],
      }),
    }),
    async (uri: URL, { topic }) => ({
      contents: [
        {
          uri: uri.href,
          text: `Resource info about ${topic} from server ${name}`,
        },
      ],
    })
  );

  // Add another resource with JSON content
  server.resource(
    `${name}-data`,
    new ResourceTemplate(`${name}-data://{dataId}`, {
      list: async () => ({
        resources: [
          { name: `${name} Data 123`, uri: `${name}-data://123` },
          { name: `${name} Data ABC123`, uri: `${name}-data://abc123` },
        ],
      }),
    }),
    async (uri: URL, { dataId }) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify({
            id: dataId,
            server: name,
            timestamp: new Date().toISOString(),
            data: { message: `Data from server ${name}` },
          }),
        },
      ],
    })
  );

  // Add a prompt
  server.prompt(
    `${name}-prompt`,
    {
      message: z.string(),
      context: z.string().optional(),
    },
    ({ message, context }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: context
              ? `Context: ${context}\n\nPlease process this message: ${message}`
              : `Please process this message: ${message}`,
          },
        },
      ],
      description: `Basic user prompt for ${name}`,
    })
  );

  // Add a system-style prompt (but using user role to comply with MCP)
  server.prompt(
    `${name}-system-prompt`,
    {
      instruction: z.string(),
    },
    ({ instruction }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `[SYSTEM] You are a helpful assistant for ${name}. ${instruction}\n\nHow can you help me today?`,
          },
        },
      ],
      description: `System-style prompt for ${name}`,
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return { server, transport };
};

if (import.meta.path === Bun.main) {
  (async () => {
    await createMockServer(process.argv[2] || 'default');
  })();
}
