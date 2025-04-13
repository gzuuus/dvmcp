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

export interface LightningConfig {
  address: string;
  zapRelays?: string[];
}

export interface Config {
  nostr: NostrConfig;
  mcp: MCPConfig;
  whitelist: WhitelistConfig;
  lightning?: LightningConfig;
}

export interface ToolPricing {
  name: string;
  price?: string;
  unit?: string;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  tools?: ToolPricing[];
  env?: Record<string, string>;
}
