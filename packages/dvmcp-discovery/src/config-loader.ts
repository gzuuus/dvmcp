import { makeConfigLoader } from '@dvmcp/commons/config';
import {
  dvmcpDiscoveryConfigSchema,
  type DvmcpDiscoveryConfig,
} from './config-schema';

/**
 * Load and validate dvmcp-discovery configuration
 * This is a thin wrapper around the common configuration loader
 */
export const loadDiscoveryConfig = makeConfigLoader<DvmcpDiscoveryConfig>(
  dvmcpDiscoveryConfigSchema
);
