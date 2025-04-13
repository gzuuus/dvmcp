import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export const createMockServer = async (name: string) => {
  const server = new McpServer({
    name: `Mock ${name}`,
    version: '1.0.0',
  });

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return { server, transport };
};

if (import.meta.path === Bun.main) {
  await createMockServer(process.argv[2] || 'default');
}
