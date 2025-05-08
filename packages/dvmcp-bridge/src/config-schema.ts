/**
 * Unified dvmcp-bridge configuration schema and interfaces.
 *
 * This file defines the single source of truth for all configuration options:
 * - Used for CLI flags, config file shapes, help output, and type inference.
 * - Each field is described with TypeScript types, JSDoc, required/default/doc metadata.
 * - Schema is exportable for yargs integration, loader, and validation.
 */

/* =========================
 * Interface Definitions
 * ========================= */

/**
 * Nostr protocol configuration.
 */
export interface NostrConfig {
  /**
   * 32-byte hex encoded private key to use for signing/managing.
   * @example "d4d4d7aa..."
   */
  privateKey: string;
  /**
   * List of relay URLs (must start with ws:// or wss://), at least one required.
   * @example ["wss://relay1.com", "wss://relay2.net"]
   */
  relayUrls: string[];
}

/**
 * MCP tool price configuration (per tool/server).
 */
export interface MCPToolConfig {
  /**
   * Name of the tool exposed by the MCP server.
   */
  name: string;
  /**
   * Price for tool use/requests, as a string (integer in "sats" unless unit specified).
   * If omitted, tool may be free or inherit global pricing.
   * @example "1000"
   */
  price?: string;
  /**
   * Price unit (default: "sats").
   * @default "sats"
   */
  unit?: string;
}

/**
 * MCP Server process configuration (external or local service).
 */
export interface MCPServerConfig {
  /**
   * Command line to launch the MCP server process (e.g., "node", "python").
   */
  command: string;
  /**
   * Command-line arguments to pass to the server process.
   */
  args: string[];
  /**
   * Environment variables for the server process (key-value pairs).
   */
  env?: Record<string, string>;
  /**
   * Array of tools/pricing exposed by this server.
   */
  tools?: MCPToolConfig[];
}

/**
 * General MCP bridge configuration.
 */
export interface MCPConfig {
  /**
   * Name for the service (used in announcements and UI).
   * @default "DVM MCP Bridge"
   */
  name: string;
  /**
   * Info/about text for this bridge.
   */
  about?: string;
  /**
   * Instructions for using this MCP server.
   * This will be included in the server announcement.
   */
  instructions?: string;
  /**
   * Optional custom server ID to use for announcements.
   * If not provided, an ID will be auto-generated from server name and public key.
   */
  serverId?: string;
  /**
   * Client software version.
   * @example "1.0.0"
   */
  clientVersion: string;
  /**
   * Optional avatar/profile image URL.
   */
  picture?: string;
  /**
   * Optional website URL.
   */
  website?: string;
  /**
   * Optional banner image URL.
   */
  banner?: string;
  /**
   * List of MCP server configurations.
   * @minItems 1
   */
  servers: MCPServerConfig[];
}

/**
 * Whitelist configuration for allowed public keys.
 */
export interface WhitelistConfig {
  /**
   * List of allowed public keys (hex). If empty or omitted, no restriction.
   */
  allowedPubkeys?: string[];
}

/**
 * Lightning payment handler configuration.
 */
export interface LightningConfig {
  /**
   * Lightning address (e.g. getalby.com) for invoice generation.
   */
  address: string;
  /**
   * Array of dedicated relays for zap subscriptions.
   */
  zapRelays?: string[];
}

/**
 * The unified dvmcp-bridge config root.
 */
export interface DvmcpBridgeConfig {
  /**
   * Nostr key and relay configuration.
   */
  nostr: NostrConfig;
  /**
   * Main MCP service details and server registry.
   */
  mcp: MCPConfig;
  /**
   * Optional public key whitelist.
   */
  whitelist?: WhitelistConfig;
  /**
   * Optional Lightning payment configuration.
   */
  lightning?: LightningConfig;
}

/* =========================
 * Schema Metadata
 * ========================= */

/**
 * Unified config schema: includes all fields/types/defaults/docs for use in yargs and validation.
 * Each field is defined with metadata for required, default, type, and documentation.
 */
export const dvmcpBridgeConfigSchema = {
  nostr: {
    type: 'object',
    required: true,
    doc: 'Nostr configuration: keys and relays.',
    fields: {
      privateKey: {
        type: 'string',
        required: true,
        doc: '32-byte hex encoded private key to use for signing/managing.',
      },
      relayUrls: {
        type: 'array',
        itemType: 'string',
        required: true,
        doc: 'List of relay URLs (must start with ws:// or wss://); at least one.',
        minItems: 1,
      },
    },
  },
  mcp: {
    type: 'object',
    required: true,
    doc: 'MCP bridge service info and server config.',
    fields: {
      name: {
        type: 'string',
        required: true,
        default: 'DVM MCP Bridge',
        doc: 'Name for the service (used in announcements).',
      },
      about: {
        type: 'string',
        required: false,
        doc: 'Info/about text for this bridge.',
      },
      instructions: {
        type: 'string',
        required: false,
        doc: 'Instructions for using this MCP server. This will be included in the server announcement.',
      },
      serverId: {
        type: 'string',
        required: false,
        doc: 'Optional custom server ID to use for announcements. If not provided, an ID will be auto-generated.',
      },
      clientVersion: {
        type: 'string',
        required: true,
        doc: 'Bridge client version.',
      },
      picture: {
        type: 'string',
        required: false,
        doc: 'Profile/avatar image URL.',
      },
      website: {
        type: 'string',
        required: false,
        doc: 'Website URL.',
      },
      banner: {
        type: 'string',
        required: false,
        doc: 'Banner image URL.',
      },
      servers: {
        type: 'array',
        required: true,
        minItems: 1,
        itemType: 'object',
        doc: 'List of MCP server process configurations.',
        fields: {
          command: {
            type: 'string',
            required: true,
            doc: 'Executable name to launch MCP server process.',
          },
          args: {
            type: 'array',
            itemType: 'string',
            required: true,
            doc: 'Arguments for the command to launch server.',
          },
          env: {
            type: 'object',
            keyType: 'string',
            valueType: 'string',
            required: false,
            doc: 'Environment variables (key-value map) for the server process.',
          },
          tools: {
            type: 'array',
            itemType: 'object',
            required: false,
            doc: 'Tools and per-tool pricing exposed by this server.',
            fields: {
              name: {
                type: 'string',
                required: true,
                doc: 'Tool name.',
              },
              price: {
                type: 'string',
                required: false,
                doc: 'Tool price (string integer, e.g. in sats).',
              },
              unit: {
                type: 'string',
                required: false,
                default: 'sats',
                doc: 'Tool price unit (e.g. "sats")',
              },
            },
          },
        },
      },
    },
  },
  whitelist: {
    type: 'object',
    required: false,
    doc: 'Optional whitelist of allowed public keys.',
    fields: {
      allowedPubkeys: {
        type: 'array',
        itemType: 'string',
        required: false,
        doc: 'List of allowed public keys (hex). If omitted/empty, disables restriction.',
      },
    },
  },
  lightning: {
    type: 'object',
    required: false,
    doc: 'Optional Lightning payment configuration (required if pricing is used).',
    fields: {
      address: {
        type: 'string',
        required: false,
        doc: 'Lightning address for invoices.',
      },
      zapRelays: {
        type: 'array',
        itemType: 'string',
        required: false,
        doc: 'Zap receipt relay URLs (optional).',
      },
    },
  },
} as const;

export type DvmcpBridgeConfigSchema = typeof dvmcpBridgeConfigSchema;
