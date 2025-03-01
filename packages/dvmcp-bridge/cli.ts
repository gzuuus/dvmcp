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
import type { Config } from './src/types';

const configPath = join(process.cwd(), 'config.yml');

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
const main = async () => {
  console.log(
    `${CONFIG_EMOJIS.SETUP} DVMCP Bridge Configuration Setup ${CONFIG_EMOJIS.SETUP}`
  );

  const generator = new ConfigGenerator<Config>(configPath, configFields);
  await generator.generate();
};

main().catch(console.error);
