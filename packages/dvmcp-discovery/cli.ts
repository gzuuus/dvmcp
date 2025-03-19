#!/usr/bin/env bun
import {
  ConfigGenerator,
  generateHexKey,
  type FieldConfig,
  CONFIG_EMOJIS,
  validateHexKey,
  validateRelayUrl,
} from '@dvmcp/commons/config-generator';
import { join } from 'path';
import type { Config } from './src/config.js';
import { argv } from 'process';
import { existsSync } from 'fs';

const configPath = join(process.cwd(), 'config.dvmcp.yml');

const configFields: Record<string, FieldConfig> = {
  nostr: {
    type: 'nested',
    description: 'Nostr Configuration',
    emoji: CONFIG_EMOJIS.NOSTR,
    fields: {
      privateKey: {
        type: 'hex',
        description: 'Private key',
        generator: generateHexKey,
        validation: validateHexKey,
        required: true,
      },
      relayUrls: {
        type: 'array',
        description: 'Relay URLs',
        validation: validateRelayUrl,
        required: true,
      },
    },
  },
  mcp: {
    type: 'nested',
    description: 'Service Configuration',
    emoji: CONFIG_EMOJIS.SERVICE,
    fields: {
      name: {
        type: 'string',
        description: 'Service name',
        default: 'DVMCP Discovery',
      },
      version: {
        type: 'string',
        description: 'Service version',
        default: '1.0.0',
        required: true,
      },
      about: {
        type: 'string',
        description: 'Service description',
        default: 'DVMCP Discovery Server for aggregating MCP tools from DVMs',
      },
    },
  },
  whitelist: {
    type: 'nested',
    description: 'DVM Whitelist Configuration',
    emoji: CONFIG_EMOJIS.WHITELIST,
    fields: {
      allowedDVMs: {
        type: 'set',
        description: 'Allowed DVM public keys',
        validation: validateHexKey,
      },
    },
  },
};

const configure = async () => {
  console.log(
    `${CONFIG_EMOJIS.SETUP} DVMCP Discovery Configuration Setup ${CONFIG_EMOJIS.SETUP}`
  );
  const generator = new ConfigGenerator<Config>(configPath, configFields);
  await generator.generate();
};

const runApp = async () => {
  const main = await import('./index.js');
  console.log(`${CONFIG_EMOJIS.INFO} Running main application...`);
  await main.default();
};

const cliMain = async () => {
  if (argv.includes('--configure')) {
    await configure();
  }

  if (!existsSync(configPath)) {
    console.log(
      `${CONFIG_EMOJIS.INFO} No configuration file found. Starting setup...`
    );
    await configure();
  }

  await runApp();
};

cliMain().catch(console.error);
