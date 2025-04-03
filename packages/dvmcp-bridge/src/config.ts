import { parse } from 'yaml';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { HEX_KEYS_REGEX } from '@dvmcp/commons/constants';
import type { Config, MCPServerConfig } from './types';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

let CONFIG_PATH = join(process.cwd(), 'config.dvmcp.yml');

export function setConfigPath(path: string) {
  CONFIG_PATH = path.startsWith('/') ? path : join(process.cwd(), path);
}

const TEST_CONFIG: Config = {
  nostr: {
    privateKey:
      'd4d4d7aae7857054596c4c0976b22a73acac3a10d30bf56db35ee038bbf0dd44',
    relayUrls: ['ws://localhost:3334'],
  },
  mcp: {
    name: 'Test DVM MCP Bridge',
    about: 'Test MCP-enabled DVM',
    clientName: 'Test Client',
    clientVersion: '1.0.0',
    servers: [],
  },
  whitelist: {
    allowedPubkeys: new Set(),
  },
};

function validateRequiredField(value: any, fieldName: string): string {
  if (!value) {
    throw new Error(`Missing required config field: ${fieldName}`);
  }
  return value;
}

function getConfigValue(
  value: string | undefined,
  defaultValue: string
): string {
  return value || defaultValue;
}

function validateRelayUrls(urls: any): string[] {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error(
      'At least one relay URL must be provided in nostr.relayUrls'
    );
  }
  return urls.map((url: string) => {
    try {
      const trimmedUrl = url.trim();
      new URL(trimmedUrl);
      if (!trimmedUrl.startsWith('ws://') && !trimmedUrl.startsWith('wss://')) {
        throw new Error(
          `Relay URL must start with ws:// or wss://: ${trimmedUrl}`
        );
      }
      return trimmedUrl;
    } catch (error) {
      throw new Error(`Invalid relay URL: ${url}`);
    }
  });
}

function validateMCPServers(servers: any): MCPServerConfig[] {
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error(
      'At least one MCP server must be configured in mcp.servers'
    );
  }
  return servers.map((server: any, index: number) => {
    if (!server.name || !server.command || !Array.isArray(server.args)) {
      throw new Error(
        `Invalid MCP server configuration at index ${index}. Required fields: name, command, args[]`
      );
    }

    // Process tool pricing configuration if present
    const toolsConfig = Array.isArray(server.tools)
      ? server.tools.map((tool: any) => {
          if (!tool.name) {
            throw new Error(
              `Invalid tool configuration in server ${server.name}. Tool name is required.`
            );
          }
          return {
            name: tool.name,
            price: tool.price ? String(tool.price) : undefined,
            unit: tool.unit ? String(tool.unit) : undefined,
          };
        })
      : undefined;

    return {
      name: server.name,
      command: server.command,
      args: server.args,
      tools: toolsConfig,
    };
  });
}

function loadConfig(): Config {
  if (process.env.NODE_ENV === 'test') {
    return TEST_CONFIG;
  }

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `No config file found at ${CONFIG_PATH}. Please create one based on config.example.yml`
    );
  }

  try {
    const configFile = readFileSync(CONFIG_PATH, 'utf8');
    const rawConfig = parse(configFile);

    const config: Config = {
      nostr: {
        privateKey: validateRequiredField(
          rawConfig.nostr?.privateKey,
          'nostr.privateKey'
        ),
        relayUrls: validateRelayUrls(rawConfig.nostr?.relayUrls),
      },
      mcp: {
        name: getConfigValue(rawConfig.mcp?.name, 'DVM MCP Bridge'),
        about: getConfigValue(
          rawConfig.mcp?.about,
          'MCP-enabled DVM providing AI and computational tools'
        ),
        clientName: validateRequiredField(
          rawConfig.mcp?.clientName,
          'mcp.clientName'
        ),
        clientVersion: validateRequiredField(
          rawConfig.mcp?.clientVersion,
          'mcp.clientVersion'
        ),
        picture: rawConfig.mcp?.picture,
        website: rawConfig.mcp?.website,
        banner: rawConfig.mcp?.banner,
        servers: validateMCPServers(rawConfig.mcp?.servers),
      },
      whitelist: {
        allowedPubkeys: rawConfig.whitelist?.allowedPubkeys
          ? new Set(
              rawConfig.whitelist.allowedPubkeys.map((pk: string) => pk.trim())
            )
          : undefined,
      },
      lightning: rawConfig.lightning?.address
        ? {
            address: rawConfig.lightning.address,
            zapRelays: Array.isArray(rawConfig.lightning.zapRelays)
              ? rawConfig.lightning.zapRelays
              : undefined,
          }
        : undefined,
    };

    if (!HEX_KEYS_REGEX.test(config.nostr.privateKey)) {
      throw new Error('privateKey must be a 32-byte hex string');
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to load config from ${CONFIG_PATH}: ${error}`);
  }
}

let cachedConfig: Config | null = null;
export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

// For backward compatibility
export const CONFIG = getConfig();
