import { parse } from 'yaml';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { HEX_KEYS_REGEX } from '@dvmcp/commons/constants';
import { generateSecretKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { CLI_FLAGS, DEFAULT_VALUES, ENV_VARS } from './constants';

/**
 * Nostr configuration
 */
export interface NostrConfig {
  /** Private key for Nostr identity (hex string) */
  privateKey: string;
  /** List of relay URLs to connect to */
  relayUrls: string[];
}

/**
 * MCP service configuration
 */
export interface MCPConfig {
  /** Name of the service */
  name: string;
  /** Version of the service */
  version: string;
  /** Description of the service */
  about: string;
}

/**
 * Nostr Wallet Connect configuration
 */
export interface NWCConfig {
  /** NWC connection string */
  connectionString: string;
}

/**
 * Whitelist configuration
 */
export interface WhitelistConfig {
  /** Set of allowed DVM public keys */
  allowedDVMs?: Set<string>;
}

/**
 * Complete configuration interface
 */
export interface Config {
  /** Nostr configuration */
  nostr: NostrConfig;
  /** MCP service configuration */
  mcp: MCPConfig;
  /** Optional NWC configuration */
  nwc?: NWCConfig;
  /** Optional whitelist configuration */
  whitelist?: WhitelistConfig;
}

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

/**
 * Default test configuration
 */
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

/**
 * Validate a required field
 * @param value - Value to validate
 * @param fieldName - Name of the field
 * @returns The validated value
 * @throws Error if the value is missing
 */
function validateRequiredField(value: unknown, fieldName: string): string {
  if (!value) {
    throw new Error(`Missing required config field: ${fieldName}`);
  }
  return String(value);
}

/**
 * Get a configuration value with a default fallback
 * @param value - Value to check
 * @param defaultValue - Default value to use if the value is missing
 * @returns The value or the default value
 */
function getConfigValue(
  value: string | undefined,
  defaultValue: string
): string {
  return value || defaultValue;
}

/**
 * Validate relay URLs
 * @param urls - Array of relay URLs to validate
 * @returns Validated array of relay URLs
 * @throws Error if the URLs are invalid
 */
function validateRelayUrls(urls: unknown): string[] {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error(
      'At least one relay URL must be provided in nostr.relayUrls'
    );
  }

  return urls.map((url: unknown) => {
    try {
      const trimmedUrl = String(url).trim();
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

/**
 * Load configuration from environment variables
 * @returns Partial configuration from environment variables
 */
function loadConfigFromEnv(): Partial<Config> {
  const config: Partial<Config> = {};

  // Nostr configuration
  if (
    process.env[ENV_VARS.NOSTR_PRIVATE_KEY] ||
    process.env[ENV_VARS.NOSTR_RELAY_URLS]
  ) {
    config.nostr = {} as NostrConfig;

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
    process.env[ENV_VARS.MCP_VERSION] ||
    process.env[ENV_VARS.MCP_ABOUT]
  ) {
    config.mcp = {} as MCPConfig;

    if (process.env[ENV_VARS.MCP_NAME]) {
      config.mcp.name = process.env[ENV_VARS.MCP_NAME] as string;
    }

    if (process.env[ENV_VARS.MCP_VERSION]) {
      config.mcp.version = process.env[ENV_VARS.MCP_VERSION] as string;
    }

    if (process.env[ENV_VARS.MCP_ABOUT]) {
      config.mcp.about = process.env[ENV_VARS.MCP_ABOUT] as string;
    }
  }

  // NWC configuration
  if (process.env[ENV_VARS.NWC_CONNECTION_STRING]) {
    config.nwc = {
      connectionString: process.env[ENV_VARS.NWC_CONNECTION_STRING] as string,
    };
  }

  // Whitelist configuration
  if (process.env[ENV_VARS.WHITELIST_ALLOWED_DVMS]) {
    config.whitelist = {
      allowedDVMs: new Set(
        (process.env[ENV_VARS.WHITELIST_ALLOWED_DVMS] as string)
          .split(',')
          .map((pk) => pk.trim())
      ),
    };
  }

  return config;
}

/**
 * Load configuration from CLI arguments
 * @param args - Command line arguments
 * @returns Partial configuration from CLI arguments
 */
function loadConfigFromCLI(args: string[]): Partial<Config> {
  const config: Partial<Config> = {};

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
    config.nostr = {} as NostrConfig;

    if (privateKey) {
      config.nostr.privateKey = privateKey;
    }

    if (relayUrls) {
      config.nostr.relayUrls = relayUrls.split(',').map((url) => url.trim());
    }
  }

  // MCP configuration
  const mcpName = getArgValue([CLI_FLAGS.MCP_NAME.LONG]);
  const mcpVersion = getArgValue([CLI_FLAGS.MCP_VERSION.LONG]);
  const mcpAbout = getArgValue([CLI_FLAGS.MCP_ABOUT.LONG]);

  if (mcpName || mcpVersion || mcpAbout) {
    config.mcp = {} as MCPConfig;

    if (mcpName) {
      config.mcp.name = mcpName;
    }

    if (mcpVersion) {
      config.mcp.version = mcpVersion;
    }

    if (mcpAbout) {
      config.mcp.about = mcpAbout;
    }
  }

  // NWC configuration
  const nwcConnectionString = getArgValue([
    CLI_FLAGS.NWC_CONNECTION_STRING.LONG,
  ]);

  if (nwcConnectionString) {
    config.nwc = {
      connectionString: nwcConnectionString,
    };
  }

  // Whitelist configuration
  const allowedDVMs = getArgValue([CLI_FLAGS.WHITELIST_ALLOWED_DVMS.LONG]);

  if (allowedDVMs) {
    config.whitelist = {
      allowedDVMs: new Set(allowedDVMs.split(',').map((pk) => pk.trim())),
    };
  }

  return config;
}

/**
 * Load configuration from file
 * @returns Loaded configuration or null if file doesn't exist
 */
function loadConfigFromFile(): Config | null {
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
        name: getConfigValue(rawConfig.mcp?.name, 'DVMCP Discovery'),
        version: validateRequiredField(rawConfig.mcp?.version, 'mcp.version'),
        about: getConfigValue(
          rawConfig.mcp?.about,
          'DVMCP Discovery Server for aggregating MCP tools from DVMs'
        ),
      },
      nwc: rawConfig.nwc?.connectionString
        ? {
            connectionString: rawConfig.nwc.connectionString,
          }
        : undefined,
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
    throw new Error(`Failed to load config from file: ${error}`);
  }
}

/**
 * Create a default configuration
 * @param relayUrls - Array of relay URLs
 * @returns Default configuration
 */
export function createDefaultConfig(relayUrls: string[]): Config {
  return {
    nostr: {
      privateKey: bytesToHex(generateSecretKey()),
      relayUrls: validateRelayUrls(relayUrls),
    },
    mcp: {
      name: DEFAULT_VALUES.DEFAULT_MCP_NAME,
      version: DEFAULT_VALUES.DEFAULT_MCP_VERSION,
      about: DEFAULT_VALUES.DEFAULT_MCP_ABOUT,
    },
    whitelist: {
      allowedDVMs: new Set(),
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
      version: '',
      about: '',
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
      result.mcp = { ...result.mcp, ...config.mcp };
    }

    // Merge nwc configuration
    if (config.nwc) {
      result.nwc = { ...config.nwc };
    }

    // Merge whitelist configuration
    if (config.whitelist) {
      result.whitelist = { ...config.whitelist };
    }
  }

  return result as Config;
}

// Cached configuration
let _CONFIG: Config | null = null;

/**
 * Reset the cached configuration
 */
export function resetConfig(): void {
  _CONFIG = null;
}

/**
 * Get the configuration with all sources merged according to priority
 * @returns Merged configuration
 */
export function getConfig(): Config {
  if (_CONFIG) {
    return _CONFIG;
  }

  // If in-memory configuration is set, use it
  if (IN_MEMORY_CONFIG) {
    _CONFIG = IN_MEMORY_CONFIG;
    return _CONFIG;
  }

  // If in test environment, use test configuration
  if (process.env.NODE_ENV === 'test') {
    _CONFIG = TEST_CONFIG;
    return _CONFIG;
  }

  // Load configuration from different sources
  const fileConfig = loadConfigFromFile();
  const envConfig = loadConfigFromEnv();
  const cliConfig = loadConfigFromCLI(process.argv);

  // Create a default configuration for fallback values
  const defaultConfig = createDefaultConfig([DEFAULT_VALUES.DEFAULT_RELAY_URL]);

  // Helper function to apply defaults for missing fields
  const applyDefaults = <T>(userValue: T | undefined, defaultValue: T): T => {
    return userValue !== undefined ? userValue : defaultValue;
  };

  // Merge all external configs with priority: file < env < cli
  const externalConfig = mergeConfigs(
    {},
    fileConfig || {},
    envConfig,
    cliConfig
  );

  // Check if we have any external configuration
  const hasExternalConfig = Object.keys(externalConfig).length > 0;

  if (!hasExternalConfig) {
    // No external configuration, use default configuration
    _CONFIG = defaultConfig;
  } else {
    // Create a new config object with defaults applied where needed
    const finalConfig: Config = {
      nostr: {
        // Use external privateKey if available, otherwise use default
        privateKey: applyDefaults(
          externalConfig.nostr?.privateKey,
          defaultConfig.nostr.privateKey
        ),
        // For relay URLs, only use default if external is empty or undefined
        relayUrls:
          externalConfig.nostr?.relayUrls?.length > 0
            ? externalConfig.nostr.relayUrls
            : defaultConfig.nostr.relayUrls,
      },
      mcp: {
        // Apply defaults for MCP fields
        name: applyDefaults(externalConfig.mcp?.name, defaultConfig.mcp.name),
        version: applyDefaults(
          externalConfig.mcp?.version,
          defaultConfig.mcp.version
        ),
        about: applyDefaults(
          externalConfig.mcp?.about,
          defaultConfig.mcp.about
        ),
      },
      // Apply defaults for optional fields
      whitelist: externalConfig.whitelist || defaultConfig.whitelist,
      // Only include NWC if provided in external config
      ...(externalConfig.nwc && { nwc: externalConfig.nwc }),
    };

    _CONFIG = finalConfig;
  }

  // Validate the merged configuration
  if (!_CONFIG.nostr.privateKey) {
    throw new Error('Missing required config field: nostr.privateKey');
  }

  if (!HEX_KEYS_REGEX.test(_CONFIG.nostr.privateKey)) {
    throw new Error('privateKey must be a 32-byte hex string');
  }

  if (!_CONFIG.nostr.relayUrls || _CONFIG.nostr.relayUrls.length === 0) {
    throw new Error(
      'At least one relay URL must be provided in nostr.relayUrls'
    );
  }

  if (!_CONFIG.mcp.version) {
    throw new Error('Missing required config field: mcp.version');
  }

  return _CONFIG;
}

/**
 * Print configuration information
 * @param verbose - Whether to print detailed information
 */
export function printConfig(verbose = false): void {
  const config = getConfig();

  console.log('\n=== DVMCP Discovery Configuration ===');
  console.log(`MCP Service: ${config.mcp.name} (v${config.mcp.version})`);
  console.log(`Connected to ${config.nostr.relayUrls.length} relays`);

  if (verbose) {
    console.log('\nDetailed Configuration:');

    // Print nostr configuration
    if (config.nostr.privateKey) {
      const privateKey = config.nostr.privateKey;
      console.log(
        `nostr.privateKey: ${privateKey.substring(0, 4)}...${privateKey.substring(privateKey.length - 4)}`
      );
    }
    console.log(`nostr.relayUrls: ${config.nostr.relayUrls.join(', ')}`);

    // Print mcp configuration
    console.log(`mcp.name: ${config.mcp.name}`);
    console.log(`mcp.version: ${config.mcp.version}`);
    console.log(`mcp.about: ${config.mcp.about}`);

    // Print nwc configuration if present
    if (config.nwc) {
      console.log('nwc.connectionString: [Connection String Hidden]');
    }

    // Print whitelist configuration if present
    if (config.whitelist?.allowedDVMs) {
      console.log(
        `whitelist.allowedDVMs: ${Array.from(config.whitelist.allowedDVMs).join(', ') || 'None'}`
      );
    }
  }

  console.log('=======================================\n');
}
