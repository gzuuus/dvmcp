export interface NostrConfig {
  privateKey: string;
  relayUrls: string[];
}

export interface MCPConfig {
  name: string;
  about: string;
  clientName: string;
  clientVersion: string;
  servers: MCPServerConfig[];
}

export interface WhitelistConfig {
  allowedPubkeys: Set<string> | undefined;
}

export interface AppConfig {
  nostr: NostrConfig;
  mcp: MCPConfig;
  whitelist: WhitelistConfig;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
}
