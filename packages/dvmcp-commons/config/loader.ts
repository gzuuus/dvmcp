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
    // Ensure we have default values for required fields
    const defaults = getDefaults(schema) || {};

    // If preloaded config is provided, use it directly
    if (opts?.preloadedConfig) {
      return opts.preloadedConfig as T;
    }

    let configFile: Record<string, any> = {};
    let configPath = opts?.configPath || 'config.dvmcp.yml';

    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf8');
        configFile = YAML.parse(raw) || {};
        console.log(`📋 Loaded configuration from ${configPath}`);
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

    // Debug the inputs for troubleshooting
    if (process.env.DEBUG) {
      console.log('Defaults:', JSON.stringify(defaults, null, 2));
      console.log('Config file:', JSON.stringify(configFile, null, 2));
      console.log('Environment config:', JSON.stringify(envConfig, null, 2));
      console.log('CLI flags:', JSON.stringify(cliFlags, null, 2));
    }

    // Apply merges in the correct order of precedence:
    // 1. Start with defaults
    // 2. Merge with config file values
    // 3. Merge with environment variable values
    // 4. Finally merge with CLI flags
    let merged = defaults || {};
    merged = deepMerge(merged, configFile);

    // Handle environment variables more carefully
    // We need to manually apply them because the case sensitivity might be different
    for (const section in envConfig) {
      if (!merged[section]) merged[section] = {};

      for (const key in envConfig[section]) {
        // Find the correct case-sensitive key in the schema
        const schemaSection = schema[section];
        if (schemaSection && schemaSection.fields) {
          const schemaKeys = Object.keys(schemaSection.fields);
          // Find a case-insensitive match
          const matchingKey = schemaKeys.find(
            (k) => k.toLowerCase() === key.toLowerCase()
          );

          if (matchingKey) {
            // Use the correct case from the schema
            merged[section][matchingKey] = envConfig[section][key];
          } else {
            // If no match found, use the key as-is
            merged[section][key] = envConfig[section][key];
          }
        } else {
          // If section not in schema, use as-is
          merged[section][key] = envConfig[section][key];
        }
      }
    }

    // Apply CLI flags
    merged = deepMerge(merged, cliFlags);

    // Debug the final merged config
    if (process.env.DEBUG) {
      console.log('Final merged config:', JSON.stringify(merged, null, 2));
    }

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

    if (process.env.DEBUG) {
      console.log('Configuration loaded and validated successfully');
    }

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
