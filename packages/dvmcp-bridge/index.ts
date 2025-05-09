/**
 * @file Main library entry point for the DVMCP Bridge package
 * This file exports components for programmatic usage of the bridge
 */

export { DVMBridge } from './src/dvm-bridge';
export { loadDvmcpConfig } from './src/config-loader';
export { createRelayHandler } from './src/relay';
export { dvmcpBridgeConfigSchema } from './src/config-schema';

import { DVMBridge } from './src/dvm-bridge';
import { loggerBridge } from '@dvmcp/commons/logger';
import { loadDvmcpConfig } from './src/config-loader';
import { createRelayHandler } from './src/relay';

/**
 * Options for starting the DVMCP Bridge
 */
export interface BridgeStartOptions {
  /** Path to the configuration file */
  configPath?: string;
  /** Environment variables to use for configuration */
  env?: Record<string, string>;
  /** CLI flags to use for configuration */
  cliFlags?: Record<string, any>;
  /** Provide a pre-loaded configuration object instead of loading from sources */
  preloadedConfig?: any;
}

/**
 * Main function to start the DVMCP Bridge service
 * This is used by the CLI but can also be used programmatically
 * @param options Configuration options for starting the bridge
 * @returns The bridge instance that was started
 */
export async function startBridge(options: BridgeStartOptions = {}) {
  try {
    // Use preloaded config or load from sources
    const config = options.preloadedConfig || (await loadDvmcpConfig(options));

    // Initialize bridge with configuration (relay handler is created internally)
    const bridge = new DVMBridge(config);

    const shutdown = async () => {
      loggerBridge('Shutting down...');
      try {
        await bridge.stop();
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await bridge.start();
    return bridge;
  } catch (error) {
    console.error('Failed to start service:', error);
    throw error;
  }
}

// For backward compatibility
export default startBridge;
