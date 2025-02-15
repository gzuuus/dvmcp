import { parse } from 'yaml';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { HEX_KEYS_REGEX } from 'commons/constants';

export interface Config {
  nostr: {
    privateKey: string;
    relayUrls: string[];
  };
  mcp: {
    name: string;
    version: string;
    about: string;
  };
  whitelist?: {
    allowedDVMs?: Set<string>;
  };
}

const CONFIG_PATH = join(process.cwd(), 'config.yml');

const TEST_CONFIG: Config = {
  nostr: {
    privateKey:
      '034cf6179a62e5aaf12bd67dc7d19be2f0fae9065fccaddd4607c2ca041fdaf9',
    relayUrls: ['ws://localhost:3334'],
  },
  mcp: {
    name: 'Test DVMCP Discovery',
    version: '1.0.0',
    about: 'Test DVMCP Discovery Server',
  },
  whitelist: {
    allowedDVMs: new Set(),
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

function loadConfig(): Config {
  if (process.env.NODE_ENV === 'test') {
    return TEST_CONFIG;
  }

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'No config.yml file found. Please create one based on config.example.yml'
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
        name: getConfigValue(rawConfig.mcp?.name, 'DVMCP Discovery'),
        version: validateRequiredField(rawConfig.mcp?.version, 'mcp.version'),
        about: getConfigValue(
          rawConfig.mcp?.about,
          'DVMCP Discovery Server for aggregating MCP tools from DVMs'
        ),
      },
      whitelist: {
        allowedDVMs: rawConfig.whitelist?.allowedDVMs
          ? new Set(
              rawConfig.whitelist.allowedDVMs.map((pk: string) => pk.trim())
            )
          : undefined,
      },
    };

    if (!HEX_KEYS_REGEX.test(config.nostr.privateKey)) {
      throw new Error('privateKey must be a 32-byte hex string');
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to load config: ${error}`);
  }
}

export const CONFIG = loadConfig();
