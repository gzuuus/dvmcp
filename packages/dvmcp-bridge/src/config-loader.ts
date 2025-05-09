import { readFileSync, existsSync } from 'fs';
import * as YAML from 'yaml';
import {
  dvmcpBridgeConfigSchema,
  type DvmcpBridgeConfig,
} from './config-schema.js';
import { loggerBridge } from '@dvmcp/commons/logger';

/**
 * Utility to deeply walk the schema, returning:
 * - defaults: a config object with schema defaults applied.
 * - required checks, type checks, and error collection.
 */
type ValidationError = { path: string; message: string };

function getDefaults(schema: any): any {
  if (schema.type === 'object') {
    const result: any = {};
    for (const key in schema.fields) {
      if ('default' in schema.fields[key]) {
        result[key] = schema.fields[key].default;
      } else {
        result[key] = getDefaults(schema.fields[key]);
      }
    }
    return result;
  }
  if (schema.type === 'array') {
    // No default for arrays; return undefined or empty if explicitly specified
    return [];
  }
  if ('default' in schema) return schema.default;
  return undefined;
}

/**
 * Deep merge utility for config objects.
 * Values in 'source' override those in 'target'.
 */
function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return source;
  if (Array.isArray(source)) {
    // Arrays: source replaces target.
    return source.slice();
  }

  const result = { ...(target || {}) };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      if (sourceValue === undefined) continue;

      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // Deep merge objects (but not arrays)
        result[key] = deepMerge(result[key], sourceValue);
      } else {
        // Replace primitives, arrays, and null/undefined
        result[key] = sourceValue;
      }
    }
  }
  return result;
}

/**
 * Parse environment variables to config structure.
 *   - Keys in SCREAMING_SNAKE (with _ and 0-index for arrays) map to config.
 *   - For objects/arrays: allow JSON or CSV (for arrays of strings/numbers).
 */
function parseEnvToConfig(schema: any, prefix = '', env = process.env): any {
  let out: any = {};

  function parseValue(value: string, s: any) {
    if (s.type === 'array') {
      // Try JSON, else CSV
      try {
        const arr = JSON.parse(value);
        if (Array.isArray(arr)) return arr;
      } catch {}
      return value.split(',').map((v) => v.trim());
    }
    if (s.type === 'object') {
      // Try JSON
      try {
        const obj = JSON.parse(value);
        if (typeof obj === 'object' && obj !== null) return obj;
      } catch {}
      // Otherwise skip (cannot parse object from flat env)
      return undefined;
    }
    if (s.type === 'number') {
      const n = Number(value);
      return isNaN(n) ? undefined : n;
    }
    if (s.type === 'boolean') {
      return value === 'true' || value === '1';
    }
    return value;
  }

  function walk(s: any, currentPrefix: string): any {
    if (s.type === 'object') {
      const o: any = {};
      for (const f in s.fields) {
        const fieldSchema = s.fields[f];
        const envKey = `${currentPrefix}${f}`.toUpperCase();

        // Match exact for top-level, or find nested via prefix
        const found = Object.entries(env).find(([k]) => k === envKey);
        if (found) {
          if (found[1] !== undefined) {
            o[f] = parseValue(found[1], fieldSchema);
          }
        } else {
          // Recurse for nested
          const subPrefix = `${envKey}_`;
          o[f] = walk(fieldSchema, subPrefix);
        }
      }
      // Collapse empty objects
      if (Object.values(o).every((v) => v === undefined)) return undefined;
      return o;
    }
    if (s.type === 'array') {
      // Array as ENV: allow full JSON or CSV at whole-array level
      const envKey = currentPrefix.replace(/_$/, '').toUpperCase();
      const arrval = env[envKey];
      if (arrval !== undefined) {
        return parseValue(arrval, s);
      }
      // Try element-wise (e.g., FOO_0, FOO_1, ...)
      const items: any[] = [];
      let i = 0;
      while (true) {
        const itemKey = `${envKey}_${i}`;
        if (env[itemKey] === undefined) break;
        items.push(
          parseValue(
            env[itemKey],
            s.itemType === 'object'
              ? { type: 'object', fields: s.fields }
              : { type: s.itemType }
          )
        );
        i++;
      }
      if (items.length > 0) return items;
      return undefined;
    }
    // Primitive
    const envKey = currentPrefix.replace(/_$/, '').toUpperCase();
    const val = env[envKey];
    if (val !== undefined) return parseValue(val, s);
    return undefined;
  }
  out = walk(schema, prefix);
  // Remove all-undefined collapses at top
  if (
    out &&
    typeof out === 'object' &&
    Object.values(out).every((v) => v === undefined)
  )
    return undefined;
  return out;
}

/**
 * Validate config object against schema.
 * Returns { ok, errors } where errors is an array with paths & messages.
 */
function validateConfig(
  config: any,
  schema: any,
  path = ''
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (schema.type === 'object') {
    for (const key in schema.fields) {
      const field = schema.fields[key];
      const fullPath = path ? `${path}.${key}` : key;
      const value = config?.[key];

      if (field.required && (value === undefined || value === null)) {
        errors.push({
          path: fullPath,
          message: `Missing required field "${fullPath}"`,
        });
        continue;
      }

      if (value !== undefined && value !== null) {
        // Recursively validate nested
        const nestedErrors = validateConfig(value, field, fullPath);
        errors.push(...nestedErrors);
      }
    }
  } else if (schema.type === 'array') {
    if (schema.required && (config === undefined || config === null)) {
      errors.push({ path, message: `Missing required array "${path}"` });
    } else if (Array.isArray(config)) {
      for (let i = 0; i < config.length; i++) {
        errors.push(
          ...validateConfig(
            config[i],
            schema.itemType === 'object'
              ? { type: 'object', fields: schema.fields }
              : { type: schema.itemType },
            `${path}[${i}]`
          )
        );
      }
    }
  } else {
    // Primitives: type checking
    if (config !== undefined && config !== null) {
      let typeOk = true;
      switch (schema.type) {
        case 'string':
          typeOk = typeof config === 'string';
          break;
        case 'number':
          typeOk = typeof config === 'number';
          break;
        case 'boolean':
          typeOk = typeof config === 'boolean';
          break;
        default:
          typeOk = true;
      }
      if (!typeOk) {
        errors.push({
          path,
          message: `Expected type ${schema.type} at "${path}" but got ${typeof config}`,
        });
      }
    }
  }
  return errors;
}

/**
 * Load, merge, and validate the dvmcp-bridge config.
 * Merging order: schema defaults < YAML file < ENV < CLI flags.
 *
 * @param opts Optional. { configPath?: string, env?: Record<string,string>, cliFlags?: Record<string, any> }
 * @returns fully merged, validated, and typed config object.
 * @throws on validation errors with details.
 */
export async function loadDvmcpConfig(opts?: {
  configPath?: string;
  env?: Record<string, string>;
  cliFlags?: Record<string, any>;
}): Promise<DvmcpBridgeConfig> {
  const schema = dvmcpBridgeConfigSchema;
  // Get defaults
  const defaults = getDefaults(schema);

  // Load YAML config file
  let configFile: Record<string, any> = {};
  let configPath = opts?.configPath || 'config.dvmcp.yml';

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf8');
      configFile = YAML.parse(raw) || {};
      loggerBridge(`📋 Loaded configuration from ${configPath}`);
    } catch (error) {
      console.error(
        `⚠️ Error loading configuration file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    loggerBridge(`⚠️ Configuration file not found at ${configPath}`);
  }

  // Load environment variables (override YAML)
  const envVars = opts?.env || process.env;

  // Process environment variables with DVMCP_ prefix
  const envConfig: Record<string, any> = {};

  // Direct mapping for environment variables
  for (const [key, value] of Object.entries(envVars)) {
    if (key.startsWith('DVMCP_') && value !== undefined) {
      // Convert DVMCP_MCP_ABOUT to mcp.about
      const parts = key
        .replace(/^DVMCP_/, '')
        .toLowerCase()
        .split('_');

      if (parts.length === 2) {
        // Handle two-level keys like MCP_ABOUT
        const [section, field] = parts;
        if (!envConfig[section]) envConfig[section] = {};
        envConfig[section][field] = value;
      } else if (parts.length === 1) {
        // Handle top-level keys
        const [field] = parts;
        envConfig[field] = value;
      }
      // More complex nested paths could be handled here if needed
    }
  }

  // CLI flags (highest priority)
  const cliFlags = opts?.cliFlags || {};

  // Merge: defaults < YAML < ENV < CLI
  const merged = deepMerge(
    deepMerge(deepMerge(defaults, configFile), envConfig),
    cliFlags
  );

  // Validate
  const errors = validateConfig(merged, schema);
  if (errors.length > 0) {
    loggerBridge('\n⚠️ Configuration validation issues found:');
    const requiredFields = errors
      .filter((e) => e.message.includes('Missing required field'))
      .map((e) => e.path);

    if (requiredFields.length > 0) {
      loggerBridge('\n📝 Missing required fields:');
      requiredFields.forEach((field) => {
        loggerBridge(`  - ${field}`);
      });
      loggerBridge('\n💡 You can provide these fields in:');
      loggerBridge('  1. config.dvmcp.yml file');
      loggerBridge('  2. Environment variables');
      loggerBridge('  3. CLI arguments');
    }

    const msg =
      'Configuration validation failed:\n' +
      errors.map((e) => `- [${e.path}]: ${e.message}`).join('\n');
    throw new Error(msg);
  }

  // Log a simple message that configuration is loaded
  if (process.env.DEBUG) {
    loggerBridge('Configuration loaded and validated successfully');
  }

  return merged as DvmcpBridgeConfig;
}
