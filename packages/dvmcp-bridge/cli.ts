#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join } from 'path';
import {
  ConfigGenerator,
  type FieldConfig,
} from '@dvmcp/commons/config-generator';
import {
  generateHexKey,
  validateHexKey,
  validateRelayUrl,
  CONFIG_EMOJIS,
} from '@dvmcp/commons/config-generator';
import { argv } from 'process';
import type { Config } from './src/types';

const defaultConfigPath = join(process.cwd(), 'config.dvmcp.yml');
let configPath = defaultConfigPath;

const configPathArgIndex = argv.indexOf('--config-path');
if (configPathArgIndex !== -1 && argv[configPathArgIndex + 1]) {
  configPath = argv[configPathArgIndex + 1];
  console.log(configPath);
}

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
        default: 'DVM MCP Bridge',
      },
      about: {
        type: 'string',
        description: 'Service description',
        default: 'MCP-enabled DVM providing AI and computational tools',
      },
      clientName: {
        type: 'string',
        description: 'Client name',
        default: 'DVM MCP Bridge Client',
        required: true,
      },
      clientVersion: {
        type: 'string',
        description: 'Client version',
        default: '1.0.0',
        required: true,
      },
      servers: {
        type: 'object-array',
        description: 'Server Configuration',
        emoji: CONFIG_EMOJIS.SERVER,
        required: true,
        fields: {
          command: {
            type: 'string',
            description: 'Command',
          },
          args: {
            type: 'array',
            description: 'Arguments',
          },
        },
      },
    },
  },
  whitelist: {
    type: 'nested',
    description: 'Whitelist Configuration',
    emoji: CONFIG_EMOJIS.WHITELIST,
    fields: {
      allowedPubkeys: {
        type: 'set',
        description: 'Allowed public keys',
      },
    },
  },
};

const configure = async () => {
  console.log(
    `${CONFIG_EMOJIS.SETUP} DVMCP Bridge Configuration Setup ${CONFIG_EMOJIS.SETUP}`
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
  console.log('1', configPath);
  if (!existsSync(configPath)) {
    console.log(
      `${CONFIG_EMOJIS.INFO} No configuration file found. Starting setup...`
    );
    await configure();
  }

  await runApp();
};

cliMain().catch(console.error);
