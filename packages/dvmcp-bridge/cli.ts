#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join, resolve } from 'path';
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
import {
  setConfigPath,
  resetConfig,
  getConfig,
  printConfig,
} from './src/config.js';
import { DVMBridge } from './src/dvm-bridge.js';
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
    flag: CLI_FLAGS.VERBOSE.LONG,
    shortFlag: CLI_FLAGS.VERBOSE.SHORT,
    description: CLI_FLAGS.VERBOSE.DESCRIPTION,
    takesValue: false,
  },
  {
    flag: CLI_FLAGS.DELETE_ANNOUNCEMENT.LONG,
    description: CLI_FLAGS.DELETE_ANNOUNCEMENT.DESCRIPTION,
    takesValue: false,
  },
  {
    flag: CLI_FLAGS.REASON.LONG,
    description: CLI_FLAGS.REASON.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.REASON.VALUE_DESC,
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
    flag: CLI_FLAGS.MCP_NAME.LONG,
    description: CLI_FLAGS.MCP_NAME.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_NAME.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_ABOUT.LONG,
    description: CLI_FLAGS.MCP_ABOUT.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_ABOUT.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_CLIENT_NAME.LONG,
    description: CLI_FLAGS.MCP_CLIENT_NAME.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_CLIENT_NAME.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_CLIENT_VERSION.LONG,
    description: CLI_FLAGS.MCP_CLIENT_VERSION.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_CLIENT_VERSION.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_PICTURE.LONG,
    description: CLI_FLAGS.MCP_PICTURE.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_PICTURE.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_WEBSITE.LONG,
    description: CLI_FLAGS.MCP_WEBSITE.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_WEBSITE.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.MCP_BANNER.LONG,
    description: CLI_FLAGS.MCP_BANNER.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.MCP_BANNER.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.WHITELIST_ALLOWED_PUBKEYS.LONG,
    description: CLI_FLAGS.WHITELIST_ALLOWED_PUBKEYS.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.WHITELIST_ALLOWED_PUBKEYS.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.LIGHTNING_ADDRESS.LONG,
    description: CLI_FLAGS.LIGHTNING_ADDRESS.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.LIGHTNING_ADDRESS.VALUE_DESC,
  },
  {
    flag: CLI_FLAGS.LIGHTNING_ZAP_RELAYS.LONG,
    description: CLI_FLAGS.LIGHTNING_ZAP_RELAYS.DESCRIPTION,
    takesValue: true,
    valueDescription: CLI_FLAGS.LIGHTNING_ZAP_RELAYS.VALUE_DESC,
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
${CONFIG_EMOJIS.INFO} DVMCP Bridge - A MCP-enabled DVM providing AI and computational tools

Usage: dvmcp-bridge [options]

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
  dvmcp-bridge --nostr-relay-urls wss://relay.damus.io,wss://relay.dvmcp.fun
  dvmcp-bridge --config-path /path/to/config.yml
  dvmcp-bridge --configure
  dvmcp-bridge --delete-announcement --reason "Service maintenance"
`);
}

// Default configuration path
const defaultConfigPath = join(process.cwd(), 'config.dvmcp.yml');
let configPath = defaultConfigPath;

// Parse command line arguments
const parsedArgs = parseArgs(argv);

// Set config path if provided
if (parsedArgs[CLI_FLAGS.CONFIG_PATH.LONG]) {
  const configPathArg = parsedArgs[CLI_FLAGS.CONFIG_PATH.LONG];
  if (typeof configPathArg === 'string') {
    configPath = resolve(configPathArg);
    console.log(`${CONFIG_EMOJIS.INFO} Using config path: ${configPath}`);
    setConfigPath(configPath);
  }
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

const deleteAnnouncement = async () => {
  const reason =
    typeof parsedArgs[CLI_FLAGS.REASON.LONG] === 'string'
      ? (parsedArgs[CLI_FLAGS.REASON.LONG] as string)
      : undefined;

  const bridge = new DVMBridge();

  try {
    console.log(`${CONFIG_EMOJIS.INFO} Deleting service announcement...`);
    await bridge.deleteAnnouncement(reason);
    console.log(
      `${CONFIG_EMOJIS.SUCCESS} Service announcement deleted successfully`
    );
    process.exit(0);
  } catch (error) {
    console.error(
      `${CONFIG_EMOJIS.INFO} Failed to delete service announcement:`,
      error
    );
    process.exit(1);
  }
};

/**
 * Main CLI function
 */
const cliMain = async () => {
  // Reset any cached configuration to ensure we use the latest settings
  resetConfig();

  // Show help if requested
  if (parsedArgs[CLI_FLAGS.HELP.LONG]) {
    showHelp();
    process.exit(0);
  }

  // Run configuration wizard if requested
  if (parsedArgs[CLI_FLAGS.CONFIGURE.LONG]) {
    await configure();
    return;
  }

  // Handle delete announcement request
  if (parsedArgs[CLI_FLAGS.DELETE_ANNOUNCEMENT.LONG]) {
    if (!existsSync(configPath)) {
      console.error(
        `${CONFIG_EMOJIS.INFO} No configuration file found at ${configPath}`
      );
      process.exit(1);
    }
    await deleteAnnouncement();
    return;
  }

  // Only run the configuration wizard if no config file exists
  if (!existsSync(configPath)) {
    console.log(
      `${CONFIG_EMOJIS.INFO} No configuration file found. Starting setup...`
    );
    await configure();
  }

  // Print configuration if verbose mode is enabled
  if (parsedArgs[CLI_FLAGS.VERBOSE.LONG]) {
    printConfig(true);
  }

  // Run the application
  await runApp();
};

cliMain().catch(console.error);
