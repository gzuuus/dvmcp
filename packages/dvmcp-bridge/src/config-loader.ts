import { makeConfigLoader } from '@dvmcp/commons/config';
import {
  dvmcpBridgeConfigSchema,
  type DvmcpBridgeConfig,
} from './config-schema.js';

/**
 * Load and validate dvmcp-bridge configuration
 * This is a thin wrapper around the common configuration loader
 */
export const loadDvmcpConfig = makeConfigLoader<DvmcpBridgeConfig>(
  dvmcpBridgeConfigSchema
);
