/**
 * Constants for the DVMCP Bridge package
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
  DELETE_ANNOUNCEMENT: {
    LONG: '--delete-announcement',
    DESCRIPTION: 'Delete the current service announcement',
  },
  REASON: {
    LONG: '--reason',
    DESCRIPTION: 'Reason for deleting the announcement',
    VALUE_DESC: 'REASON',
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
  MCP_ABOUT: {
    LONG: '--mcp-about',
    DESCRIPTION: 'Description of the MCP service',
    VALUE_DESC: 'DESCRIPTION',
  },
  MCP_CLIENT_NAME: {
    LONG: '--mcp-client-name',
    DESCRIPTION: 'Name of the MCP client',
    VALUE_DESC: 'NAME',
  },
  MCP_CLIENT_VERSION: {
    LONG: '--mcp-client-version',
    DESCRIPTION: 'Version of the MCP client',
    VALUE_DESC: 'VERSION',
  },
  MCP_PICTURE: {
    LONG: '--mcp-picture',
    DESCRIPTION: 'URL to the MCP service picture',
    VALUE_DESC: 'URL',
  },
  MCP_WEBSITE: {
    LONG: '--mcp-website',
    DESCRIPTION: 'URL to the MCP service website',
    VALUE_DESC: 'URL',
  },
  MCP_BANNER: {
    LONG: '--mcp-banner',
    DESCRIPTION: 'URL to the MCP service banner',
    VALUE_DESC: 'URL',
  },

  // Whitelist configuration flags
  WHITELIST_ALLOWED_PUBKEYS: {
    LONG: '--whitelist-allowed-pubkeys',
    DESCRIPTION: 'Comma-separated list of allowed pubkeys',
    VALUE_DESC: 'PUBKEYS',
  },

  // Lightning configuration flags
  LIGHTNING_ADDRESS: {
    LONG: '--lightning-address',
    DESCRIPTION: 'Lightning address for payments',
    VALUE_DESC: 'ADDRESS',
  },
  LIGHTNING_ZAP_RELAYS: {
    LONG: '--lightning-zap-relays',
    DESCRIPTION: 'Comma-separated list of relays for zap receipts',
    VALUE_DESC: 'URLS',
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
  MCP_ABOUT: 'DVMCP_MCP_ABOUT',
  MCP_CLIENT_NAME: 'DVMCP_MCP_CLIENT_NAME',
  MCP_CLIENT_VERSION: 'DVMCP_MCP_CLIENT_VERSION',
  MCP_PICTURE: 'DVMCP_MCP_PICTURE',
  MCP_WEBSITE: 'DVMCP_MCP_WEBSITE',
  MCP_BANNER: 'DVMCP_MCP_BANNER',

  // Whitelist configuration
  WHITELIST_ALLOWED_PUBKEYS: 'DVMCP_WHITELIST_ALLOWED_PUBKEYS',

  // Lightning configuration
  LIGHTNING_ADDRESS: 'DVMCP_LIGHTNING_ADDRESS',
  LIGHTNING_ZAP_RELAYS: 'DVMCP_LIGHTNING_ZAP_RELAYS',
};

/**
 * Default values for configuration
 */
export const DEFAULT_VALUES = {
  DEFAULT_RELAY_URL: 'wss://relay.dvmcp.fun',
  DEFAULT_MCP_NAME: 'DVM MCP Bridge',
  DEFAULT_MCP_ABOUT: 'MCP-enabled DVM providing AI and computational tools',
  DEFAULT_MCP_CLIENT_NAME: 'DVM MCP Bridge Client',
  DEFAULT_MCP_CLIENT_VERSION: '1.0.0',
};
