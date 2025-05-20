import { readFileSync, existsSync } from 'fs';
import * as YAML from 'yaml';
import type {
  ConfigLoaderOptions,
  ConfigSchema,
  ValidationError,
} from './types';
import {
  deepMerge,
  getDefaults,
  parseEnvToConfig,
  validateConfig,
} from './utils';
import { logger } from '../logger';

/**
 * Create a configuration loader for a specific schema
 * @param schema Configuration schema
 * @returns Configuration loader function
 */
export function makeConfigLoader<T>(schema: ConfigSchema) {
  /**
   * Load and validate configuration
   * @param options Configuration loader options
   * @returns Validated configuration object
   */
  return async function loadConfig(opts?: ConfigLoaderOptions<T>): Promise<T> {
    const defaults = getDefaults(schema) || {};

    if (opts?.preloadedConfig) {
      return opts.preloadedConfig as T;
    }

    let configFile: Record<string, any> = {};
    let configPath = opts?.configPath || 'config.dvmcp.yml';

    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf8');
        configFile = YAML.parse(raw) || {};
      } catch (error) {
        console.error(
          `⚠️ Error loading configuration file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      console.log(`⚠️ Configuration file not found at ${configPath}`);
    }

    const envVars = opts?.env || process.env;
    const envPrefix = opts?.envPrefix || 'DVMCP_';

    const envConfig = parseEnvToConfig(envVars, envPrefix);
    const cliFlags = opts?.cliFlags || {};

    let merged = defaults || {};
    merged = deepMerge(merged, configFile);

    for (const section in envConfig) {
      if (!merged[section]) merged[section] = {};

      for (const key in envConfig[section]) {
        const schemaSection = schema[section];
        if (schemaSection && schemaSection.fields) {
          const schemaKeys = Object.keys(schemaSection.fields);
          const matchingKey = schemaKeys.find(
            (k) => k.toLowerCase() === key.toLowerCase()
          );

          if (matchingKey) {
            merged[section][matchingKey] = envConfig[section][key];
          } else {
            merged[section][key] = envConfig[section][key];
          }
        } else {
          merged[section][key] = envConfig[section][key];
        }
      }
    }
    merged = deepMerge(merged, cliFlags);

    const errors = validateConfig(merged, schema);
    if (errors.length > 0) {
      console.log('\n⚠️ Configuration validation issues found:');
      const requiredFields = errors
        .filter((e) => e.message.includes('Missing required field'))
        .map((e) => e.path);

      if (requiredFields.length > 0) {
        console.log('\n📝 Missing required fields:');
        requiredFields.forEach((field) => {
          console.log(`  - ${field}`);
        });
        console.log('\n💡 You can provide these fields in:');
        console.log(`  1. ${configPath} file`);
        console.log('  2. Environment variables');
        console.log('  3. CLI arguments');
      }

      const msg =
        'Configuration validation failed:\n' +
        errors.map((e) => `- [${e.path}]: ${e.message}`).join('\n');
      throw new Error(msg);
    }

    logger('Configuration loaded and validated successfully');

    return merged as T;
  };
}

/**
 * Format validation errors for display
 * @param errors Validation errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `- [${e.path}]: ${e.message}`).join('\n');
}
