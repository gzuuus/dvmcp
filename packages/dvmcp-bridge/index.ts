export { DVMBridge } from './src/dvm-bridge';
export { loadDvmcpConfig } from './src/config-loader';
export { dvmcpBridgeConfigSchema } from './src/config-schema';

import { DVMBridge } from './src/dvm-bridge';
import { loggerBridge } from '@dvmcp/commons/core';
import { loadDvmcpConfig } from './src/config-loader';

export interface BridgeStartOptions {
  configPath?: string;
  env?: Record<string, string>;
  cliFlags?: Record<string, any>;
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
    const config = options.preloadedConfig || (await loadDvmcpConfig(options));
    const bridge = new DVMBridge(config);

    const shutdown = async () => {
      loggerBridge.info('Shutting down...');
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

export default startBridge;
