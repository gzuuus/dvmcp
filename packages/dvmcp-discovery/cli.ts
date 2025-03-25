#!/usr/bin/env bun
import {
  ConfigGenerator,
  generateHexKey,
  type FieldConfig,
  CONFIG_EMOJIS,
  validateHexKey,
  validateRelayUrl,
} from '@dvmcp/commons/config-generator';
import { join, resolve } from 'path';
import type { Config } from './src/config.js';
import { argv } from 'process';
import { existsSync } from 'fs';
import {
  setConfigPath,
  setInMemoryConfig,
  createDefaultConfig,
} from './src/config.js';
import { decodeNaddr, decodeNprofile } from './src/nip19-utils.js';
import {
  fetchProviderAnnouncement,
  fetchServerAnnouncement,
  parseAnnouncement,
  type DVMAnnouncement,
} from './src/direct-discovery.js';
import type { DirectServerInfo } from './index.js';

const defaultConfigPath = join(process.cwd(), 'config.dvmcp.yml');
let configPath = defaultConfigPath;

// Check for provider flag
const providerArgIndex = argv.indexOf('--provider');
const hasProviderFlag = providerArgIndex !== -1 && argv[providerArgIndex + 1];
const providerValue = hasProviderFlag ? argv[providerArgIndex + 1] : null;

// Check for server flag
const serverArgIndex = argv.indexOf('--server');
const hasServerFlag = serverArgIndex !== -1 && argv[serverArgIndex + 1];
const serverValue = hasServerFlag ? argv[serverArgIndex + 1] : null;

// Check for config path flag (only used if provider and server flags are not present)
const configPathArgIndex = argv.indexOf('--config-path');
if (
  !hasProviderFlag &&
  !hasServerFlag &&
  configPathArgIndex !== -1 &&
  argv[configPathArgIndex + 1]
) {
  configPath = resolve(argv[configPathArgIndex + 1]);
  console.log(`Using config path: ${configPath}`);
  setConfigPath(configPath);
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

const runApp = async (directServerInfo?: DirectServerInfo) => {
  const main = await import('./index.js');
  console.log(`${CONFIG_EMOJIS.INFO} Running main application...`);
  await main.default(directServerInfo);
};

const setupInMemoryConfig = (relays: string[], pubkey: string) => {
  const config = createDefaultConfig(relays);

  config.whitelist = {
    allowedDVMs: new Set([pubkey]),
  };

  setInMemoryConfig(config);
};

const setupFromProvider = async (nprofileEntity: string) => {
  console.log(
    `${CONFIG_EMOJIS.INFO} Setting up from provider: ${nprofileEntity}`
  );

  const providerData = decodeNprofile(nprofileEntity);
  if (!providerData) {
    console.error('Invalid nprofile entity');
    process.exit(1);
  }

  try {
    const announcement = await fetchProviderAnnouncement(providerData);
    if (!announcement) {
      console.error('Failed to fetch provider announcement');
      process.exit(1);
    }

    setupInMemoryConfig(providerData.relays, providerData.pubkey);
    console.log(`${CONFIG_EMOJIS.SUCCESS} Successfully set up from provider`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};

const setupFromServer = async (naddrEntity: string) => {
  console.log(`${CONFIG_EMOJIS.INFO} Setting up from server: ${naddrEntity}`);

  const addrData = decodeNaddr(naddrEntity);
  if (!addrData) {
    console.error('Invalid naddr entity');
    process.exit(1);
  }

  try {
    const announcement = await fetchServerAnnouncement(addrData);
    if (!announcement) {
      console.error('Failed to fetch server announcement');
      process.exit(1);
    }

    const parsedAnnouncement = parseAnnouncement(announcement);
    if (!parsedAnnouncement) {
      console.error('Failed to parse server announcement');
      process.exit(1);
    }

    setupInMemoryConfig(addrData.relays, addrData.pubkey);
    console.log(`${CONFIG_EMOJIS.SUCCESS} Successfully set up from server`);

    return {
      pubkey: addrData.pubkey,
      announcement: parsedAnnouncement,
    };
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};

const cliMain = async () => {
  // Handle --configure flag
  if (argv.includes('--configure')) {
    await configure();
    return;
  }

  // Handle --provider flag
  if (hasProviderFlag && providerValue) {
    await setupFromProvider(providerValue);
    await runApp();
  }
  // Handle --server flag
  else if (hasServerFlag && serverValue) {
    const serverInfo = await setupFromServer(serverValue);
    await runApp(serverInfo);
  }
  // Handle normal config file mode
  else if (!existsSync(configPath)) {
    console.log(
      `${CONFIG_EMOJIS.INFO} No configuration file found. Starting setup...`
    );
    await configure();
    await runApp();
  } else {
    await runApp();
  }
};

cliMain().catch(console.error);
