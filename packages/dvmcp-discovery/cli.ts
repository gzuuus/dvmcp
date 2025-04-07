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
import { argv } from 'process';
import { existsSync } from 'fs';
import {
  setConfigPath,
  setInMemoryConfig,
  createDefaultConfig,
  printConfig,
  resetConfig,
  type Config,
} from './src/config.js';
import { decodeNaddr, decodeNprofile } from './src/nip19-utils.js';
import {
  fetchProviderAnnouncement,
  fetchServerAnnouncement,
  parseAnnouncement,
} from './src/direct-discovery.js';
import type { DirectServerInfo } from './index.js';
import logger from './src/logger';
import { CLI_FLAGS } from './src/constants';

// CLI argument definitions
interface CliOption {
  flag: string;
  shortFlag?: string;
  description: string;
  takesValue: boolean;
  valueDescription?: string;
}

const CLI_OPTIONS: CliOption[] = [
  {
    flag: CLI_FLAGS.CONFIG_PATH.LONG,
    shortFlag: CLI_FLAGS.CONFIG_PATH.SHORT,
    description: CLI_FLAGS.CONFIG_PATH.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.CONFIG_PATH.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.PROVIDER.LONG,
    shortFlag: CLI_FLAGS.PROVIDER.SHORT,
    description: CLI_FLAGS.PROVIDER.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.PROVIDER.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.SERVER.LONG,
    shortFlag: CLI_FLAGS.SERVER.SHORT,
    description: CLI_FLAGS.SERVER.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.SERVER.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.CONFIGURE.LONG,
    description: CLI_FLAGS.CONFIGURE.DESCRIPTION,
    takesValue: false,
  },
  {
    flag: CLI_FLAGS.HELP.LONG,
    shortFlag: CLI_FLAGS.HELP.SHORT,
    description: CLI_FLAGS.HELP.DESCRIPTION,
    takesValue: false,
  },
  {
    flag: CLI_FLAGS.NOSTR_PRIVATE_KEY.LONG,
    description: CLI_FLAGS.NOSTR_PRIVATE_KEY.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.NOSTR_PRIVATE_KEY.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.NOSTR_RELAY_URLS.LONG,
    shortFlag: CLI_FLAGS.NOSTR_RELAY_URLS.SHORT,
    description: CLI_FLAGS.NOSTR_RELAY_URLS.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.NOSTR_RELAY_URLS.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.VERBOSE.LONG,
    shortFlag: CLI_FLAGS.VERBOSE.SHORT,
    description: CLI_FLAGS.VERBOSE.DESCRIPTION,
    takesValue: false,
  },
  // Add MCP configuration options
  {
    flag: CLI_FLAGS.MCP_NAME.LONG,
    description: CLI_FLAGS.MCP_NAME.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_NAME.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_VERSION.LONG,
    description: CLI_FLAGS.MCP_VERSION.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_VERSION.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_ABOUT.LONG,
    description: CLI_FLAGS.MCP_ABOUT.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_ABOUT.VALUE_DESC,
  },
  // Add NWC configuration option
  {
    flag: CLI_FLAGS.NWC_CONNECTION_STRING.LONG,
    description: CLI_FLAGS.NWC_CONNECTION_STRING.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.NWC_CONNECTION_STRING.VALUE_DESC,
  },
  // Add whitelist configuration option
  {
    flag: CLI_FLAGS.WHITELIST_ALLOWED_DVMS.LONG,
    description: CLI_FLAGS.WHITELIST_ALLOWED_DVMS.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.WHITELIST_ALLOWED_DVMS.VALUE_DESC,
  },
];

/**
 * Parse command line arguments
 * @param args - Command line arguments
 * @returns Parsed arguments as a record
 */
function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const option = CLI_OPTIONS.find(
      (opt) => opt.flag === arg || opt.shortFlag === arg
    );

    if (option) {
      if (option.takesValue && i + 1 < args.length) {
        // If the next argument doesn't start with - or --, it's a value
        const nextArg = args[i + 1];
        if (!nextArg.startsWith('-')) {
          result[option.flag] = nextArg;
          i++; // Skip the value in the next iteration
        } else {
          // If the option takes a value but none is provided, set it to true
          result[option.flag] = true;
        }
      } else {
        // If the option doesn't take a value, set it to true
        result[option.flag] = true;
      }
    }
  }

  return result;
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
${CONFIG_EMOJIS.INFO} DVMCP Discovery - A MCP server implementation that aggregates tools from DVMs

Usage: dvmcp-discovery [options]

Options:`);

  for (const option of CLI_OPTIONS) {
    const flagStr = option.shortFlag
      ? `${option.shortFlag}, ${option.flag}`
      : `    ${option.flag}`;

    const valueStr =
      option.takesValue && option.valueDescription
        ? ` <${option.valueDescription}>`
        : '';

    console.log(`  ${flagStr.padEnd(30)}${option.description}${valueStr}`);
  }

  console.log(`
Examples:
  dvmcp-discovery                                # Run with default config
  dvmcp-discovery --configure                    # Run configuration wizard
  dvmcp-discovery --config-path ./custom.yml     # Use custom config file
  dvmcp-discovery --provider nprofile1...        # Connect to specific provider
  dvmcp-discovery --server naddr1...             # Connect to specific server
  dvmcp-discovery --nostr-relay-urls wss://relay1.com,wss://relay2.com  # Set relay URLs
  `);
}

// Default configuration path
const defaultConfigPath = join(process.cwd(), 'config.dvmcp.yml');

/**
 * Configuration fields for the wizard
 */
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

/**
 * Run the configuration wizard
 * @param configPath - Path to the configuration file
 * @returns Promise that resolves when the wizard is complete
 */
async function runConfigWizard(configPath: string): Promise<void> {
  logger(
    `${CONFIG_EMOJIS.SETUP} DVMCP Discovery Configuration Setup ${CONFIG_EMOJIS.SETUP}`
  );
  const generator = new ConfigGenerator<Config>(configPath, configFields);
  await generator.generate();
}

/**
 * Run the main application
 * @param directServerInfo - Optional server info for direct connection
 * @returns Promise that resolves when the application is running
 */
async function runApp(directServerInfo?: DirectServerInfo): Promise<void> {
  const main = await import('./index.js');
  logger(`${CONFIG_EMOJIS.INFO} Running main application...`);
  await main.default(directServerInfo);
}

/**
 * Set up in-memory configuration for direct connection
 * @param relays - Array of relay URLs
 * @param pubkey - Provider public key
 */
function setupInMemoryConfig(relays: string[], pubkey: string): void {
  const config = createDefaultConfig(relays);

  config.whitelist = {
    allowedDVMs: new Set([pubkey]),
  };

  setInMemoryConfig(config);
}

/**
 * Set up from a provider using an nprofile entity
 * @param nprofileEntity - nprofile entity
 * @returns Promise that resolves when setup is complete
 */
async function setupFromProvider(nprofileEntity: string): Promise<void> {
  logger(`${CONFIG_EMOJIS.INFO} Setting up from provider: ${nprofileEntity}`);

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
    logger(`${CONFIG_EMOJIS.SUCCESS} Successfully set up from provider`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

/**
 * Set up from a server using an naddr entity
 * @param naddrEntity - naddr entity
 * @returns Promise that resolves to server info
 */
async function setupFromServer(naddrEntity: string): Promise<DirectServerInfo> {
  logger(`${CONFIG_EMOJIS.INFO} Setting up from server: ${naddrEntity}`);

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
    logger(`${CONFIG_EMOJIS.SUCCESS} Successfully set up from server`);

    return {
      pubkey: addrData.pubkey,
      announcement: parsedAnnouncement,
    };
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

/**
 * Main CLI function
 */
async function cliMain(): Promise<void> {
  // Parse command line arguments
  const parsedArgs = parseArgs(argv);

  // Show help if requested
  if (parsedArgs['--help']) {
    showHelp();
    process.exit(0);
  }

  // Set config path if provided
  let configPath = defaultConfigPath;
  if (
    parsedArgs['--config-path'] &&
    typeof parsedArgs['--config-path'] === 'string'
  ) {
    configPath = resolve(parsedArgs['--config-path']);
    logger(`Using config path: ${configPath}`);
    setConfigPath(configPath);
  }

  // Reset any cached configuration to ensure we use the latest settings
  resetConfig();

  // Run configuration wizard if requested
  if (parsedArgs['--configure']) {
    await runConfigWizard(configPath);
    return;
  }

  // Handle direct connection options
  if (
    parsedArgs['--provider'] &&
    typeof parsedArgs['--provider'] === 'string'
  ) {
    await setupFromProvider(parsedArgs['--provider']);
    await runApp();
    return;
  }

  if (parsedArgs['--server'] && typeof parsedArgs['--server'] === 'string') {
    const serverInfo = await setupFromServer(parsedArgs['--server']);
    await runApp(serverInfo);
    return;
  }

  // Only run the configuration wizard if explicitly requested
  // If config file exists, we'll use it; otherwise, we'll use defaults

  // Print configuration if verbose mode is enabled
  if (parsedArgs['--verbose']) {
    printConfig(true);
  }

  // Run the application
  await runApp();
}

// Run the CLI
cliMain().catch((error) => {
  console.error(`Error: ${error}`);
  process.exit(1);
});
