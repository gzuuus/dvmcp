import { parse } from 'yaml';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { HEX_KEYS_REGEX } from '@dvmcp/commons/constants';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { CLI_FLAGS, DEFAULT_VALUES, ENV_VARS } from './constants';
import type { Config, MCPServerConfig } from './types';
// TODO: Make id of the server configurable
/**
 * Configuration source types
 */
export enum ConfigSource {
  DEFAULT = 'default',
  FILE = 'file',
  ENV = 'environment',
  CLI = 'cli',
  MEMORY = 'memory',
}

// Default configuration path
let CONFIG_PATH = join(process.cwd(), 'config.dvmcp.yml');

// In-memory configuration
let IN_MEMORY_CONFIG: Config | null = null;

/**
 * Set a custom configuration file path
 * @param path - Path to the configuration file
 */
export function setConfigPath(path: string): void {
  CONFIG_PATH = path.startsWith('/') ? path : join(process.cwd(), path);
}

/**
 * Set an in-memory configuration (highest priority)
 * @param config - Configuration object
 */
export function setInMemoryConfig(config: Config): void {
  IN_MEMORY_CONFIG = config;
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

    // Process environment variables if present
    const envConfig =
      typeof server.env === 'object' && server.env !== null
        ? Object.entries(server.env).reduce(
            (acc, [key, value]) => {
              acc[key] = String(value);
              return acc;
            },
            {} as Record<string, string>
          )
        : undefined;

    return {
      name: server.name,
      command: server.command,
      args: server.args,
      tools: toolsConfig,
      env: envConfig,
    };
  });
}

/**
 * Load configuration from environment variables
 * @returns Partial configuration from environment variables
 */
function loadConfigFromEnv(): Partial<Config> {
  const config: Partial<Config> = {
    nostr: undefined,
    mcp: undefined,
    whitelist: undefined,
    lightning: undefined,
  };

  // Nostr configuration
  if (
    process.env[ENV_VARS.NOSTR_PRIVATE_KEY] ||
    process.env[ENV_VARS.NOSTR_RELAY_URLS]
  ) {
    config.nostr = { privateKey: '', relayUrls: [] };

    if (process.env[ENV_VARS.NOSTR_PRIVATE_KEY]) {
      config.nostr.privateKey = process.env[
        ENV_VARS.NOSTR_PRIVATE_KEY
      ] as string;
    }

    if (process.env[ENV_VARS.NOSTR_RELAY_URLS]) {
      config.nostr.relayUrls = (
        process.env[ENV_VARS.NOSTR_RELAY_URLS] as string
      )
        .split(',')
        .map((url) => url.trim());
    }
  }

  // MCP configuration
  if (
    process.env[ENV_VARS.MCP_NAME] ||
    process.env[ENV_VARS.MCP_ABOUT] ||
    process.env[ENV_VARS.MCP_CLIENT_NAME] ||
    process.env[ENV_VARS.MCP_CLIENT_VERSION] ||
    process.env[ENV_VARS.MCP_PICTURE] ||
    process.env[ENV_VARS.MCP_WEBSITE] ||
    process.env[ENV_VARS.MCP_BANNER]
  ) {
    config.mcp = {
      name: '',
      about: '',
      clientName: '',
      clientVersion: '',
      servers: [],
    };

    if (process.env[ENV_VARS.MCP_NAME]) {
      config.mcp.name = process.env[ENV_VARS.MCP_NAME] as string;
    }

    if (process.env[ENV_VARS.MCP_ABOUT]) {
      config.mcp.about = process.env[ENV_VARS.MCP_ABOUT] as string;
    }

    if (process.env[ENV_VARS.MCP_CLIENT_NAME]) {
      config.mcp.clientName = process.env[ENV_VARS.MCP_CLIENT_NAME] as string;
    }

    if (process.env[ENV_VARS.MCP_CLIENT_VERSION]) {
      config.mcp.clientVersion = process.env[
        ENV_VARS.MCP_CLIENT_VERSION
      ] as string;
    }

    if (process.env[ENV_VARS.MCP_PICTURE]) {
      config.mcp.picture = process.env[ENV_VARS.MCP_PICTURE] as string;
    }

    if (process.env[ENV_VARS.MCP_WEBSITE]) {
      config.mcp.website = process.env[ENV_VARS.MCP_WEBSITE] as string;
    }

    if (process.env[ENV_VARS.MCP_BANNER]) {
      config.mcp.banner = process.env[ENV_VARS.MCP_BANNER] as string;
    }
  }

  // Whitelist configuration
  if (process.env[ENV_VARS.WHITELIST_ALLOWED_PUBKEYS]) {
    config.whitelist = {
      allowedPubkeys: new Set(
        (process.env[ENV_VARS.WHITELIST_ALLOWED_PUBKEYS] as string)
          .split(',')
          .map((pk) => pk.trim())
      ),
    };
  }

  // Lightning configuration
  if (
    process.env[ENV_VARS.LIGHTNING_ADDRESS] ||
    process.env[ENV_VARS.LIGHTNING_ZAP_RELAYS]
  ) {
    config.lightning = { address: '' };

    if (process.env[ENV_VARS.LIGHTNING_ADDRESS]) {
      config.lightning.address = process.env[
        ENV_VARS.LIGHTNING_ADDRESS
      ] as string;
    }

    if (process.env[ENV_VARS.LIGHTNING_ZAP_RELAYS]) {
      config.lightning.zapRelays = (
        process.env[ENV_VARS.LIGHTNING_ZAP_RELAYS] as string
      )
        .split(',')
        .map((url) => url.trim());
    }
  }

  return config;
}

/**
 * Load configuration from file
 * @returns Loaded configuration or null if file doesn't exist
 */
/**
 * Load configuration from CLI arguments
 * @param args - Command line arguments
 * @returns Partial configuration from CLI arguments
 */
function loadConfigFromCLI(args: string[]): Partial<Config> {
  const config: Partial<Config> = {
    nostr: undefined,
    mcp: undefined,
    whitelist: undefined,
    lightning: undefined,
  };

  // Helper function to get argument value with support for multiple flags (long and short forms)
  const getArgValue = (flags: string[]): string | undefined => {
    for (const flag of flags) {
      const index = args.indexOf(flag);
      if (index !== -1 && index + 1 < args.length) {
        return args[index + 1];
      }
    }
    return undefined;
  };

  // Nostr configuration
  const privateKey = getArgValue([CLI_FLAGS.NOSTR_PRIVATE_KEY.LONG]);
  const relayUrls = getArgValue([
    CLI_FLAGS.NOSTR_RELAY_URLS.LONG,
    CLI_FLAGS.NOSTR_RELAY_URLS.SHORT,
  ]);

  if (privateKey || relayUrls) {
    config.nostr = { privateKey: '', relayUrls: [] };

    if (privateKey) {
      config.nostr.privateKey = privateKey;
    }

    if (relayUrls) {
      config.nostr.relayUrls = relayUrls.split(',').map((url) => url.trim());
    }
  }

  // MCP configuration
  const mcpName = getArgValue([CLI_FLAGS.MCP_NAME.LONG]);
  const mcpAbout = getArgValue([CLI_FLAGS.MCP_ABOUT.LONG]);
  const mcpClientName = getArgValue([CLI_FLAGS.MCP_CLIENT_NAME.LONG]);
  const mcpClientVersion = getArgValue([CLI_FLAGS.MCP_CLIENT_VERSION.LONG]);
  const mcpPicture = getArgValue([CLI_FLAGS.MCP_PICTURE.LONG]);
  const mcpWebsite = getArgValue([CLI_FLAGS.MCP_WEBSITE.LONG]);
  const mcpBanner = getArgValue([CLI_FLAGS.MCP_BANNER.LONG]);

  if (
    mcpName ||
    mcpAbout ||
    mcpClientName ||
    mcpClientVersion ||
    mcpPicture ||
    mcpWebsite ||
    mcpBanner
  ) {
    config.mcp = {
      name: '',
      about: '',
      clientName: '',
      clientVersion: '',
      servers: [],
    };

    if (mcpName) {
      config.mcp.name = mcpName;
    }

    if (mcpAbout) {
      config.mcp.about = mcpAbout;
    }

    if (mcpClientName) {
      config.mcp.clientName = mcpClientName;
    }

    if (mcpClientVersion) {
      config.mcp.clientVersion = mcpClientVersion;
    }

    if (mcpPicture) {
      config.mcp.picture = mcpPicture;
    }

    if (mcpWebsite) {
      config.mcp.website = mcpWebsite;
    }

    if (mcpBanner) {
      config.mcp.banner = mcpBanner;
    }
  }

  // Whitelist configuration
  const allowedPubkeys = getArgValue([
    CLI_FLAGS.WHITELIST_ALLOWED_PUBKEYS.LONG,
  ]);

  if (allowedPubkeys) {
    config.whitelist = {
      allowedPubkeys: new Set(allowedPubkeys.split(',').map((pk) => pk.trim())),
    };
  }

  // Lightning configuration
  const lightningAddress = getArgValue([CLI_FLAGS.LIGHTNING_ADDRESS.LONG]);
  const lightningZapRelays = getArgValue([CLI_FLAGS.LIGHTNING_ZAP_RELAYS.LONG]);

  if (lightningAddress || lightningZapRelays) {
    config.lightning = { address: '' };

    if (lightningAddress) {
      config.lightning.address = lightningAddress;
    }

    if (lightningZapRelays) {
      config.lightning.zapRelays = lightningZapRelays
        .split(',')
        .map((url) => url.trim());
    }
  }

  return config;
}

/**
 * Load configuration from file
 * @returns Loaded configuration or null if file doesn't exist
 */
function loadConfigFromFile(): Config | null {
  if (process.env.NODE_ENV === 'test') {
    return TEST_CONFIG;
  }

  if (!existsSync(CONFIG_PATH)) {
    return null;
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
        name: getConfigValue(
          rawConfig.mcp?.name,
          DEFAULT_VALUES.DEFAULT_MCP_NAME
        ),
        about: getConfigValue(
          rawConfig.mcp?.about,
          DEFAULT_VALUES.DEFAULT_MCP_ABOUT
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

/**
 * Create a default configuration
 * @param relayUrls - Array of relay URLs
 * @returns Default configuration
 */
export function createDefaultConfig(relayUrls: string[]): Config {
  // Generate a new private key
  const privateKey = bytesToHex(generateSecretKey());

  return {
    nostr: {
      privateKey,
      relayUrls:
        relayUrls.length > 0 ? relayUrls : [DEFAULT_VALUES.DEFAULT_RELAY_URL],
    },
    mcp: {
      name: DEFAULT_VALUES.DEFAULT_MCP_NAME,
      about: DEFAULT_VALUES.DEFAULT_MCP_ABOUT,
      clientName: DEFAULT_VALUES.DEFAULT_MCP_CLIENT_NAME,
      clientVersion: DEFAULT_VALUES.DEFAULT_MCP_CLIENT_VERSION,
      servers: [],
    },
    whitelist: {
      allowedPubkeys: new Set(),
    },
  };
}

/**
 * Merge configurations with priority
 * @param configs - Array of partial configurations in order of increasing priority
 * @returns Merged configuration
 */
function mergeConfigs(...configs: Partial<Config>[]): Config {
  // Start with a default configuration structure
  const result: Partial<Config> = {
    nostr: {
      privateKey: '',
      relayUrls: [],
    },
    mcp: {
      name: '',
      about: '',
      clientName: '',
      clientVersion: '',
      servers: [],
    },
    whitelist: {
      allowedPubkeys: new Set(),
    },
  };

  // Merge configurations in order of priority
  for (const config of configs) {
    if (!config) continue;

    // Merge nostr configuration
    if (config.nostr) {
      // Special handling for relay URLs to combine them instead of replacing
      if (config.nostr.relayUrls && result.nostr?.relayUrls) {
        const combinedRelays = [...result.nostr.relayUrls];

        // Add new relays that don't already exist
        for (const relay of config.nostr.relayUrls) {
          if (!combinedRelays.includes(relay)) {
            combinedRelays.push(relay);
          }
        }

        // Create a new nostr config with the combined relays
        result.nostr = {
          ...result.nostr,
          ...config.nostr,
          relayUrls: combinedRelays,
        };
      } else {
        // If no existing relays, just use the standard merge
        result.nostr = { ...result.nostr, ...config.nostr };
      }
    }

    // Merge mcp configuration
    if (config.mcp) {
      // Special handling for servers to combine them instead of replacing
      if (config.mcp.servers && result.mcp?.servers) {
        result.mcp = {
          ...result.mcp,
          ...config.mcp,
          servers: [...result.mcp.servers, ...config.mcp.servers],
        };
      } else {
        result.mcp = { ...result.mcp, ...config.mcp };
      }
    }

    // Merge whitelist configuration
    if (config.whitelist) {
      result.whitelist = { ...config.whitelist };
    }

    // Merge lightning configuration
    if (config.lightning) {
      result.lightning = { ...config.lightning };
    }
  }

  return result as Config;
}

// Cached configuration
let cachedConfig: Config | null = null;

/**
 * Reset the cached configuration
 */
export function resetConfig(): void {
  cachedConfig = null;
}

/**
 * Get the configuration with all sources merged according to priority
 * @returns Merged configuration
 */
export function getConfig(): Config {
  // Return cached configuration if available
  if (cachedConfig) {
    return cachedConfig;
  }

  // If in-memory configuration is set, use it
  if (IN_MEMORY_CONFIG) {
    cachedConfig = IN_MEMORY_CONFIG;
    return cachedConfig;
  }

  // If in test environment, use test configuration
  if (process.env.NODE_ENV === 'test') {
    cachedConfig = TEST_CONFIG;
    return cachedConfig;
  }

  // Load configuration from different sources
  const fileConfig = loadConfigFromFile();
  const envConfig = loadConfigFromEnv();
  const cliConfig = loadConfigFromCLI(process.argv);

  // Create a default configuration for fallback values
  const defaultConfig = createDefaultConfig([DEFAULT_VALUES.DEFAULT_RELAY_URL]);

  // Merge configurations with priority
  const externalConfig = mergeConfigs(
    {},
    fileConfig || {},
    envConfig,
    cliConfig
  );

  // Check if we have any external configuration for nostr.privateKey
  const hasExternalPrivateKey = !!externalConfig.nostr?.privateKey;

  // Create a new config object with defaults applied where needed
  const finalConfig: Config = {
    nostr: {
      // Always use external privateKey if available, otherwise use default
      privateKey: hasExternalPrivateKey
        ? externalConfig.nostr!.privateKey
        : defaultConfig.nostr.privateKey,
      // For relay URLs, use external if provided, otherwise use default
      relayUrls: externalConfig.nostr?.relayUrls?.length
        ? externalConfig.nostr.relayUrls
        : defaultConfig.nostr.relayUrls,
    },
    mcp: {
      // Apply defaults for MCP fields
      name: externalConfig.mcp?.name || defaultConfig.mcp.name,
      about: externalConfig.mcp?.about || defaultConfig.mcp.about,
      clientName:
        externalConfig.mcp?.clientName || defaultConfig.mcp.clientName,
      clientVersion:
        externalConfig.mcp?.clientVersion || defaultConfig.mcp.clientVersion,
      picture: externalConfig.mcp?.picture,
      website: externalConfig.mcp?.website,
      banner: externalConfig.mcp?.banner,
      servers: externalConfig.mcp?.servers || defaultConfig.mcp.servers,
    },
    // Apply defaults for whitelist
    whitelist: {
      allowedPubkeys:
        externalConfig.whitelist?.allowedPubkeys ||
        defaultConfig.whitelist.allowedPubkeys,
    },
    // Include lightning configuration if provided
    ...(externalConfig.lightning && { lightning: externalConfig.lightning }),
  };

  cachedConfig = finalConfig;

  // Validate the merged configuration
  if (!cachedConfig.nostr.privateKey) {
    throw new Error('Missing required config field: nostr.privateKey');
  }

  if (!HEX_KEYS_REGEX.test(cachedConfig.nostr.privateKey)) {
    throw new Error('privateKey must be a 32-byte hex string');
  }

  if (
    !cachedConfig.nostr.relayUrls ||
    cachedConfig.nostr.relayUrls.length === 0
  ) {
    throw new Error(
      'At least one relay URL must be provided in nostr.relayUrls'
    );
  }

  if (!cachedConfig.mcp.clientName) {
    throw new Error('Missing required config field: mcp.clientName');
  }

  if (!cachedConfig.mcp.clientVersion) {
    throw new Error('Missing required config field: mcp.clientVersion');
  }

  return cachedConfig;
}

/**
 * Print configuration information
 * @param verbose - Whether to print detailed information
 */
export function printConfig(verbose = false): void {
  const config = getConfig();
  const configSources = [];

  console.log('\n📋 DVMCP Bridge Configuration');
  console.log('------------------------');

  // Print Nostr configuration
  console.log('🔑 Nostr:');
  console.log(`  Private Key: ${config.nostr.privateKey.substring(0, 8)}...`);
  console.log(`  Relay URLs: ${config.nostr.relayUrls.join(', ')}`);

  // Print MCP configuration
  console.log('🛠️ MCP:');
  console.log(`  Name: ${config.mcp.name}`);
  console.log(`  About: ${config.mcp.about}`);
  console.log(`  Client Name: ${config.mcp.clientName}`);
  console.log(`  Client Version: ${config.mcp.clientVersion}`);

  if (config.mcp.picture) {
    console.log(`  Picture: ${config.mcp.picture}`);
  }

  if (config.mcp.website) {
    console.log(`  Website: ${config.mcp.website}`);
  }

  if (config.mcp.banner) {
    console.log(`  Banner: ${config.mcp.banner}`);
  }

  // Print server configuration if verbose
  if (verbose && config.mcp.servers.length > 0) {
    console.log('  Servers:');
    config.mcp.servers.forEach((server, index) => {
      console.log(`    ${index + 1}. ${server.name}`);
      console.log(`       Command: ${server.command} ${server.args.join(' ')}`);
      if (server.tools && server.tools.length > 0) {
        console.log('       Tools:');
        server.tools.forEach((tool) => {
          let toolInfo = `         - ${tool.name}`;
          if (tool.price) {
            toolInfo += ` (${tool.price} ${tool.unit || 'sats'})`;
          }
          console.log(toolInfo);
        });
      }
    });
  } else if (config.mcp.servers.length > 0) {
    console.log(`  Servers: ${config.mcp.servers.length} configured`);
  } else {
    console.log('  Servers: None configured');
  }

  // Print whitelist configuration
  if (
    config.whitelist?.allowedPubkeys &&
    config.whitelist.allowedPubkeys.size > 0
  ) {
    console.log('🔒 Whitelist:');
    if (verbose) {
      console.log('  Allowed Pubkeys:');
      [...config.whitelist.allowedPubkeys].forEach((pk) => {
        console.log(`    - ${pk}`);
      });
    } else {
      console.log(
        `  Allowed Pubkeys: ${config.whitelist.allowedPubkeys.size} configured`
      );
    }
  }

  // Print lightning configuration
  if (config.lightning) {
    console.log('⚡ Lightning:');
    console.log(`  Address: ${config.lightning.address}`);
    if (config.lightning.zapRelays && config.lightning.zapRelays.length > 0) {
      if (verbose) {
        console.log('  Zap Relays:');
        config.lightning.zapRelays.forEach((relay) => {
          console.log(`    - ${relay}`);
        });
      } else {
        console.log(
          `  Zap Relays: ${config.lightning.zapRelays.length} configured`
        );
      }
    }
  }

  console.log('\n');
}

// For backward compatibility
export const CONFIG = getConfig();
