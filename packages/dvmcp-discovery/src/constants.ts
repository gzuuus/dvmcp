// CLI flags have been moved to yargs configuration in cli.ts

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
