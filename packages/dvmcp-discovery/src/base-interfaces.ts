export interface Capability {
  id: string;
  type: 'prompt' | 'tool' | 'resource';
}

export interface ExecutionContext {
  executionId: string;
  createdAt: number;
}

export type ProviderServerMeta = {
  providerPubkey?: string;
  serverId?: string;
};
