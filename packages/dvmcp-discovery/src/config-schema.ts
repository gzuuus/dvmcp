/**
 * Unified dvmcp-discovery configuration schema and interfaces.
 *
 * This file defines the single source of truth for all configuration options
 */

import type { ConfigSchema } from '@dvmcp/commons/config';
import type { EncryptionConfig } from '@dvmcp/commons/encryption';
import { EncryptionMode } from '@dvmcp/commons/encryption';

export const DEFAULT_VALUES = {
  DEFAULT_RELAY_URL: 'wss://r.dvmcp.fun',
  DEFAULT_MCP_NAME: 'DVMCP Discovery',
  DEFAULT_MCP_VERSION: '1.0.0',
  DEFAULT_MCP_ABOUT:
    'DVMCP Discovery Server for aggregating MCP tools from DVMs',
};

/**
 * Nostr configuration
 */
export interface NostrConfig {
  /**
   * Private key for Nostr identity (hex string)
   */
  privateKey: string;

  /**
   * List of relay URLs to connect to
   * @minItems 1
   */
  relayUrls: string[];
}

/**
 * MCP service configuration
 */
export interface MCPConfig {
  /**
   * Name of the service
   */
  name: string;

  /**
   * Version of the service
   */
  version: string;

  /**
   * Description of the service
   */
  about: string;
}

/**
 * Nostr Wallet Connect configuration
 */
export interface NWCConfig {
  /**
   * NWC connection string
   */
  connectionString: string;
}

/**
 * Whitelist configuration
 */
export interface WhitelistConfig {
  /**
   * List of allowed DVM public keys
   */
  allowedDVMs?: string[];
}

/**
 * Private server configuration for direct connection
 */
export interface PrivateServerConfig {
  /**
   * Public key of the private server provider
   */
  providerPubkey: string;

  /**
   * Optional server identifier to target a specific server
   * If omitted, discovers all servers from the provider
   */
  serverId?: string;

  /**
   * Indicates if the private server supports encryption.
   * This is determined during the handshake process.
   */
  supportsEncryption?: boolean;
}

/**
 * Discovery configuration
 */
export interface DiscoveryConfig {
  /**
   * Limit the number of DVMs to discover
   */
  limit?: number;

  /**
   * Private servers to connect to directly
   */
  privateServers?: PrivateServerConfig[];
}

/**
 * Feature flags configuration
 */
export interface FeatureFlagsConfig {
  /**
   * Enable interactive mode with built-in tools
   */
  interactive?: boolean;
}

/**
 * Complete configuration interface
 */
export interface DvmcpDiscoveryConfig {
  /** Nostr configuration */
  nostr: NostrConfig;

  /** MCP service configuration */
  mcp: MCPConfig;

  /** Optional NWC configuration */
  nwc?: NWCConfig;

  /** Optional whitelist configuration */
  whitelist?: WhitelistConfig;

  /** Optional discovery configuration */
  discovery?: DiscoveryConfig;

  /** Optional feature flags configuration */
  featureFlags?: FeatureFlagsConfig;

  /** Optional encryption configuration */
  encryption?: EncryptionConfig;
}

/**
 * Unified config schema: includes all fields/types/defaults/docs for use in validation.
 * Each field is defined with metadata for required, default, type, and documentation.
 */
export const dvmcpDiscoveryConfigSchema: ConfigSchema = {
  nostr: {
    type: 'object',
    required: true,
    doc: 'Nostr key and relay configuration',
    fields: {
      privateKey: {
        type: 'string',
        required: true,
        doc: 'Private key for Nostr identity (hex string)',
      },
      relayUrls: {
        type: 'array',
        required: true,
        minItems: 1,
        itemType: 'string',
        default: [DEFAULT_VALUES.DEFAULT_RELAY_URL],
        doc: 'List of relay URLs to connect to (must start with ws:// or wss://)',
      },
    },
  },
  mcp: {
    type: 'object',
    required: true,
    doc: 'MCP service configuration',
    fields: {
      name: {
        type: 'string',
        required: true,
        default: DEFAULT_VALUES.DEFAULT_MCP_NAME,
        doc: 'Name of the service',
      },
      version: {
        type: 'string',
        required: true,
        default: DEFAULT_VALUES.DEFAULT_MCP_VERSION,
        doc: 'Version of the service',
      },
      about: {
        type: 'string',
        required: true,
        default: DEFAULT_VALUES.DEFAULT_MCP_ABOUT,
        doc: 'Description of the service',
      },
    },
  },
  nwc: {
    type: 'object',
    required: false,
    doc: 'Nostr Wallet Connect configuration',
    fields: {
      connectionString: {
        type: 'string',
        required: true,
        doc: 'NWC connection string',
      },
    },
  },
  whitelist: {
    type: 'object',
    required: false,
    doc: 'Whitelist configuration',
    fields: {
      allowedDVMs: {
        type: 'array',
        required: false,
        itemType: 'string',
        doc: 'List of allowed DVM public keys',
      },
    },
  },
  discovery: {
    type: 'object',
    required: false,
    doc: 'Discovery configuration',
    fields: {
      limit: {
        type: 'number',
        required: false,
        doc: 'Limit the number of DVMs to discover',
      },
      privateServers: {
        type: 'array',
        required: false,
        itemType: 'object',
        doc: 'Private servers to connect to directly',
        fields: {
          providerPubkey: {
            type: 'string',
            required: true,
            doc: 'Public key of the private server provider',
          },
          serverId: {
            type: 'string',
            required: false,
            doc: 'Optional server identifier to target a specific server',
          },
          supportsEncryption: {
            type: 'string',
            required: false,
            doc: 'Optional, if the private server supports encryption, determine this beforehand to improve handshake efficiency',
          },
        },
      },
    },
  },
  featureFlags: {
    type: 'object',
    required: false,
    doc: 'Feature flags configuration',
    fields: {
      interactive: {
        type: 'boolean',
        required: false,
        default: false,
        doc: 'Enable interactive mode with built-in tools',
      },
    },
  },
  encryption: {
    type: 'object',
    required: false,
    doc: 'Optional encryption configuration for NIP-17/NIP-59 support',
    fields: {
      mode: {
        type: 'string',
        required: false,
        default: EncryptionMode.OPTIONAL,
        doc: 'Encryption mode: disabled, optional (mirrors incoming format), or required.',
      },
    },
  },
};
