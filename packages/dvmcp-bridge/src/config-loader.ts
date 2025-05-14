import { readFileSync, existsSync } from 'fs';
import * as YAML from 'yaml';
import {
  dvmcpBridgeConfigSchema,
  type DvmcpBridgeConfig,
} from './config-schema.js';
import { loggerBridge } from '@dvmcp/commons/logger';

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
    return [];
  }
  if ('default' in schema) return schema.default;
  return undefined;
}

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object') return source;
  if (Array.isArray(source)) {
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
        result[key] = deepMerge(result[key], sourceValue);
      } else {
        result[key] = sourceValue;
      }
    }
  }
  return result;
}

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

export async function loadDvmcpConfig(opts?: {
  configPath?: string;
  env?: Record<string, string>;
  cliFlags?: Record<string, any>;
}): Promise<DvmcpBridgeConfig> {
  const schema = dvmcpBridgeConfigSchema;
  const defaults = getDefaults(schema);

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

  const envVars = opts?.env || process.env;

  const envConfig: Record<string, any> = {};

  for (const [key, value] of Object.entries(envVars)) {
    if (key.startsWith('DVMCP_') && value !== undefined) {
      const parts = key
        .replace(/^DVMCP_/, '')
        .toLowerCase()
        .split('_');

      if (parts.length === 2) {
        const [section, field] = parts;
        if (!envConfig[section]) envConfig[section] = {};
        envConfig[section][field] = value;
      } else if (parts.length === 1) {
        const [field] = parts;
        envConfig[field] = value;
      }
    }
  }

  const cliFlags = opts?.cliFlags || {};
  const merged = deepMerge(
    deepMerge(deepMerge(defaults, configFile), envConfig),
    cliFlags
  );

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

  if (process.env.DEBUG) {
    loggerBridge('Configuration loaded and validated successfully');
  }

  return merged as DvmcpBridgeConfig;
}
