export interface Capability {
  id: string;
  type: 'prompt' | 'tool' | 'resource' | 'server';
}

export interface DVMCPBridgeServer extends Capability {
  type: 'server';
  pubkey: string;
  content: string;
}

export interface ExecutionContext {
  executionId: string;
  createdAt: number;
}

export type ProviderServerMeta = {
  providerPubkey?: string;
  serverId?: string;
};
