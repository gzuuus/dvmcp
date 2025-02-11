import { config } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';

interface NostrConfig {
  privateKey: string;
  relayUrls: string[];
}

interface MCPConfig {
  name: string;
  about: string;
  clientName: string;
  clientVersion: string;
  serverCommand: string;
  serverArgs: string[];
}

interface WhitelistConfig {
  allowedPubkeys: Set<string> | undefined;
}

interface AppConfig {
  nostr: NostrConfig;
  mcp: MCPConfig;
  whitelist: WhitelistConfig;
}

const envPath = join(process.cwd(), '.env');
if (!existsSync(envPath)) {
  throw new Error(
    'No .env file found. Please create one based on .env.example'
  );
}

const result = config();

if (result.error) {
  throw new Error(`Error loading .env file: ${result.error.message}`);
}

const HEX_KEYS_REGEX = /^(?:[0-9a-fA-F]{64})$/;

function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env file`
    );
  }
  return value;
}

function getEnvVar(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const CONFIG: AppConfig = {
  nostr: {
    privateKey: requireEnvVar('PRIVATE_KEY'),
    relayUrls: requireEnvVar('RELAY_URLS')
      .split(',')
      .map((url) => url.trim()),
  },
  mcp: {
    name: getEnvVar('MCP_SERVICE_NAME', 'DVM MCP Bridge'),
    about: getEnvVar(
      'MCP_SERVICE_ABOUT',
      'MCP-enabled DVM providing AI and computational tools'
    ),
    clientName: requireEnvVar('MCP_CLIENT_NAME'),
    clientVersion: requireEnvVar('MCP_CLIENT_VERSION'),
    serverCommand: requireEnvVar('MCP_SERVER_COMMAND'),
    serverArgs: requireEnvVar('MCP_SERVER_ARGS').split(','),
  },
  whitelist: {
    allowedPubkeys: process.env.ALLOWED_PUBKEYS
      ? new Set(process.env.ALLOWED_PUBKEYS.split(',').map((pk) => pk.trim()))
      : undefined,
  },
};

if (!HEX_KEYS_REGEX.test(CONFIG.nostr.privateKey)) {
  throw new Error('PRIVATE_KEY must be a 32-byte hex string');
}

CONFIG.nostr.relayUrls.forEach((url) => {
  try {
    new URL(url);
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      throw new Error(`Relay URL must start with ws:// or wss://: ${url}`);
    }
  } catch (error) {
    throw new Error(`Invalid relay URL: ${url}`);
  }
});

if (CONFIG.nostr.relayUrls.length === 0) {
  throw new Error('At least one relay URL must be provided in RELAY_URLS');
}
