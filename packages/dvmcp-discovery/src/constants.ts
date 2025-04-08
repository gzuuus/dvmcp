/**
 * Constants for the DVMCP Discovery package
 */

/**
 * CLI flag constants
 */
export const CLI_FLAGS = {
  // Configuration flags
  CONFIG_PATH: {
    LONG: '--config-path',
    SHORT: '-c',
    DESCRIPTION: 'Path to the configuration file',
    VALUE_DESC: 'PATH',
  },
  CONFIGURE: {
    LONG: '--configure',
    DESCRIPTION: 'Run the configuration wizard',
  },
  VERBOSE: {
    LONG: '--verbose',
    SHORT: '-v',
    DESCRIPTION: 'Show verbose output',
  },
  HELP: {
    LONG: '--help',
    SHORT: '-h',
    DESCRIPTION: 'Show help',
  },

  // Connection flags
  PROVIDER: {
    LONG: '--provider',
    SHORT: '-p',
    DESCRIPTION: 'Connect to a specific provider using an nprofile entity',
    VALUE_DESC: 'NPROFILE',
  },
  SERVER: {
    LONG: '--server',
    SHORT: '-s',
    DESCRIPTION: 'Connect to a specific server using an naddr entity',
    VALUE_DESC: 'NADDR',
  },

  // Nostr configuration flags
  NOSTR_PRIVATE_KEY: {
    LONG: '--nostr-private-key',
    DESCRIPTION: 'Nostr private key (hex string)',
    VALUE_DESC: 'KEY',
  },
  NOSTR_RELAY_URLS: {
    LONG: '--nostr-relay-urls',
    SHORT: '-r',
    DESCRIPTION: 'Comma-separated list of Nostr relay URLs',
    VALUE_DESC: 'URLS',
  },

  // MCP configuration flags
  MCP_NAME: {
    LONG: '--mcp-name',
    DESCRIPTION: 'Name of the MCP service',
    VALUE_DESC: 'NAME',
  },
  MCP_VERSION: {
    LONG: '--mcp-version',
    DESCRIPTION: 'Version of the MCP service',
    VALUE_DESC: 'VERSION',
  },
  MCP_ABOUT: {
    LONG: '--mcp-about',
    DESCRIPTION: 'Description of the MCP service',
    VALUE_DESC: 'DESCRIPTION',
  },

  // NWC configuration flags
  NWC_CONNECTION_STRING: {
    LONG: '--nwc-connection-string',
    DESCRIPTION: 'NWC connection string',
    VALUE_DESC: 'STRING',
  },

  // Whitelist configuration flags
  WHITELIST_ALLOWED_DVMS: {
    LONG: '--whitelist-allowed-dvms',
    DESCRIPTION: 'Comma-separated list of allowed DVM public keys',
    VALUE_DESC: 'PUBKEYS',
  },

  // Discovery configuration flags
  DISCOVERY_LIMIT: {
    LONG: '--discovery-limit',
    DESCRIPTION: 'Limit the number of DVMs to discover',
    VALUE_DESC: 'LIMIT',
  },

  // Interactive mode flag
  INTERACTIVE: {
    LONG: '--interactive',
    SHORT: '-i',
    DESCRIPTION: 'Enable interactive mode with built-in tools',
  },
};

/**
 * Environment variable constants
 */
export const ENV_VARS = {
  // Nostr configuration
  NOSTR_PRIVATE_KEY: 'DVMCP_NOSTR_PRIVATE_KEY',
  NOSTR_RELAY_URLS: 'DVMCP_NOSTR_RELAY_URLS',

  // MCP configuration
  MCP_NAME: 'DVMCP_MCP_NAME',
  MCP_VERSION: 'DVMCP_MCP_VERSION',
  MCP_ABOUT: 'DVMCP_MCP_ABOUT',

  // NWC configuration
  NWC_CONNECTION_STRING: 'DVMCP_NWC_CONNECTION_STRING',

  // Whitelist configuration
  WHITELIST_ALLOWED_DVMS: 'DVMCP_WHITELIST_ALLOWED_DVMS',

  // Discovery configuration
  DISCOVERY_LIMIT: 'DVMCP_DISCOVERY_LIMIT',

  // Interactive mode
  INTERACTIVE: 'DVMCP_INTERACTIVE',
};

/**
 * Default values for configuration
 */
export const DEFAULT_VALUES = {
  DEFAULT_RELAY_URL: 'wss://relay.dvmcp.fun',
  DEFAULT_MCP_NAME: 'DVMCP Discovery',
  DEFAULT_MCP_VERSION: '1.0.0',
  DEFAULT_MCP_ABOUT:
    'DVMCP Discovery Server for aggregating MCP tools from DVMs',
};
