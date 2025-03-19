export interface NostrConfig {
  privateKey: string;
  relayUrls: string[];
}

export interface MCPConfig {
  name: string;
  about: string;
  clientName: string;
  clientVersion: string;
  picture?: string;
  website?: string;
  banner?: string;
  servers: MCPServerConfig[];
}

export interface WhitelistConfig {
  allowedPubkeys: Set<string> | undefined;
}

export interface Config {
  nostr: NostrConfig;
  mcp: MCPConfig;
  whitelist: WhitelistConfig;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
}
