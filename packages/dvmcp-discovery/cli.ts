#!/usr/bin/env bun
import { join, resolve } from 'path';
import process from 'process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  CONFIG_EMOJIS,
  ConfigGenerator,
} from '@dvmcp/commons/config-generator';
import {
  buildYargsOptions,
  extractConfigOverrides,
} from '@dvmcp/commons/config';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import { decodeNaddr, decodeNprofile } from './src/utils';
import {
  fetchProviderAnnouncement,
  fetchServerAnnouncement,
  parseAnnouncement,
} from './src/direct-discovery';
import { DEFAULT_VALUES } from './src/constants';
import { loadDiscoveryConfig } from './src/config-loader';
import { dvmcpDiscoveryConfigSchema } from './src/config-schema';
import type { DvmcpDiscoveryConfig } from './src/config-schema';
import type { DirectServerInfo } from './index';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';

const reservedFlags = [
  'help',
  'configure',
  'provider',
  'server',
  'verbose',
  'interactive',
  'config-path',
];

const { opts: yargsOptions } = buildYargsOptions(dvmcpDiscoveryConfigSchema, {
  reservedFlags,
});
const cli = yargs(hideBin(process.argv))
  .usage(
    `${CONFIG_EMOJIS.INFO} DVMCP Discovery - A MCP server implementation that aggregates tools from DVMs\n\nUsage: dvmcp-discovery [options]`
  )
  .options({
    configure: {
      type: 'boolean',
      describe: 'Run interactive config wizard and exit.',
    },
    provider: {
      alias: 'p',
      type: 'string',
      describe: 'Connect to a specific provider using an nprofile entity',
    },
    server: {
      alias: 's',
      type: 'string',
      describe: 'Connect to a specific server using an naddr entity',
    },
    'config-path': {
      type: 'string',
      describe: 'Path to config YAML file [default: ./config.dvmcp.yml]',
    },
    verbose: {
      alias: 'v',
      type: 'boolean',
      describe: 'Print config before running.',
    },
    interactive: {
      alias: 'i',
      type: 'boolean',
      describe: 'Enable interactive mode with built-in tools',
    },
    ...yargsOptions,
  })
  .help('help')
  .alias('help', 'h')
  .example([
    ['$0', 'Run with default config'],
    ['$0 --configure', 'Run config wizard'],
    ['$0 --config-path ./my-config.yml', 'Use a custom config file'],
    ['$0 --provider <nprofile>', 'Connect to a specific provider'],
    ['$0 --server <naddr>', 'Connect to a specific server'],
    ['$0 --verbose', 'Show verbose output'],
  ])
  .wrap(Math.min(110, process.stdout.columns || 100))
  .version(require('./package.json').version);
const args = cli.parseSync();

const configPath = args['config-path']
  ? resolve(args['config-path'])
  : join(process.cwd(), 'config.dvmcp.yml');

let inMemoryConfig: DvmcpDiscoveryConfig | null = null;
function createMinimalConfig(relayUrls: string[]): DvmcpDiscoveryConfig {
  const privateKey = bytesToHex(generateSecretKey());

  return {
    nostr: {
      privateKey,
      relayUrls,
    },
    mcp: {
      name: DEFAULT_VALUES.DEFAULT_MCP_NAME,
      version: DEFAULT_VALUES.DEFAULT_MCP_VERSION,
      about: DEFAULT_VALUES.DEFAULT_MCP_ABOUT,
    },
    featureFlags: {
      interactive: false,
    },
  };
}

function setupInMemoryConfig(relays: string[], pubkey: string): void {
  const config = createMinimalConfig(relays);

  if (!config.whitelist) {
    config.whitelist = { allowedDVMs: [] };
  }

  config.whitelist.allowedDVMs = [pubkey];

  inMemoryConfig = config;
}

const configure = async (): Promise<void> => {
  const { configSchemaToFieldConfig } = await import(
    '@dvmcp/commons/config/adapter'
  );
  const { dvmcpDiscoveryConfigSchema } = await import('./src/config-schema');

  console.log(
    `${CONFIG_EMOJIS.SETUP} DVMCP Discovery Configuration Setup ${CONFIG_EMOJIS.SETUP}`
  );

  const fieldConfig = configSchemaToFieldConfig(dvmcpDiscoveryConfigSchema);

  const generator = new ConfigGenerator<DvmcpDiscoveryConfig>(
    configPath,
    fieldConfig
  );
  await generator.generate();
};

async function setupFromProvider(nprofileEntity: string): Promise<void> {
  loggerDiscovery(
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
    loggerDiscovery(
      `${CONFIG_EMOJIS.SUCCESS} Successfully set up from provider`
    );
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

async function setupFromServer(naddrEntity: string): Promise<DirectServerInfo> {
  loggerDiscovery(
    `${CONFIG_EMOJIS.INFO} Setting up from server: ${naddrEntity}`
  );

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
    loggerDiscovery(`${CONFIG_EMOJIS.SUCCESS} Successfully set up from server`);

    return {
      pubkey: addrData.pubkey,
      announcement: parsedAnnouncement,
    };
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

const runApp = async (directServerInfo?: DirectServerInfo): Promise<void> => {
  const main = await import('./index');

  const configOverrides = extractConfigOverrides(args, reservedFlags);

  const config =
    inMemoryConfig ||
    (await loadDiscoveryConfig({
      configPath: process.env.DVMCP_CONFIG_PATH || configPath,
      cliFlags: configOverrides,
    }));

  if (args.verbose) {
    console.log('\n📋 Current Configuration:');
    console.log(
      `Nostr Private Key: ${config.nostr.privateKey ? '******' : 'Not set'}`
    );
    console.log(`Relay URLs: ${config.nostr.relayUrls.join(', ')}`);
    console.log(`MCP Name: ${config.mcp.name}`);
    console.log(`MCP Version: ${config.mcp.version}`);
    console.log(`MCP About: ${config.mcp.about}`);

    if (config.whitelist?.allowedDVMs?.length) {
      console.log(`Whitelist: ${config.whitelist.allowedDVMs.join(', ')}`);
    }

    if (config.nwc?.connectionString) {
      console.log('NWC: Configured');
    }

    console.log(
      `Interactive Mode: ${config.featureFlags?.interactive ? 'Enabled' : 'Disabled'}`
    );

    console.log('\n📝 Full Configuration:');
    console.log(JSON.stringify(config, null, 2));
  }

  await main.default(directServerInfo);
};

const cliMain = async (): Promise<void> => {
  if (args.configure) {
    await configure();
    return;
  }
  if (args.provider) {
    await setupFromProvider(args.provider as string);
    await runApp();
    return;
  }

  if (args.server) {
    const serverInfo = await setupFromServer(args.server as string);
    await runApp(serverInfo);
    return;
  }

  await runApp();
};

cliMain().catch((error: unknown) => {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
