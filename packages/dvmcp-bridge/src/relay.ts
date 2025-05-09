import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { DvmcpBridgeConfig } from './config-schema';

/**
 * Create a relay handler instance with the provided configuration.
 * @param config The DVMCP Bridge configuration
 * @returns A new RelayHandler instance
 */
export function createRelayHandler(config: DvmcpBridgeConfig): RelayHandler {
  return new RelayHandler(config.nostr.relayUrls);
}
