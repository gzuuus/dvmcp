import type { ValidationError } from './types';

/**
 * Extract default values from a configuration schema
 * @param schema Configuration schema
 * @returns Object with default values
 */
export function getDefaults(schema: any): any {
  if (!schema) return undefined;

  if (schema.type === 'object') {
    const result: any = {};
    if (schema.fields) {
      for (const key in schema.fields) {
        const field = schema.fields[key];
        if ('default' in field) {
          result[key] = field.default;
        } else {
          const value = getDefaults(field);
          if (value !== undefined) {
            result[key] = value;
          }
        }
      }
    }
    return result; // Always return the result object even if empty
  }
  if (schema.type === 'array') {
    return [];
  }
  if ('default' in schema) return schema.default;
  return undefined;
}

/**
 * Deep merge two objects
 * @param target Target object
 * @param source Source object
 * @returns Merged object
 */
export function deepMerge(target: any, source: any): any {
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

/**
 * Validate a configuration object against a schema
 * @param config Configuration object
 * @param schema Configuration schema
 * @param path Current path (for nested validation)
 * @returns Array of validation errors
 */
export function validateConfig(
  config: any,
  schema: any,
  path = ''
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!schema) return errors;

  if (schema.type === 'object') {
    // If schema is an object type but config is not an object, that's an error
    if (config !== undefined && config !== null && typeof config !== 'object') {
      errors.push({
        path,
        message: `Expected an object at "${path}" but got ${typeof config}`,
      });
      return errors;
    }

    // If fields are defined in schema, validate each field
    if (schema.fields) {
      for (const key in schema.fields) {
        const field = schema.fields[key];
        const fullPath = path ? `${path}.${key}` : key;
        const value = config?.[key];

        // Ensure required fields are present and have values
        if (
          field.required === true &&
          (value === undefined || value === null)
        ) {
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
    }
  } else if (schema.type === 'array') {
    if (schema.required && (config === undefined || config === null)) {
      errors.push({ path, message: `Missing required array "${path}"` });
    } else if (config !== undefined && config !== null) {
      if (!Array.isArray(config)) {
        errors.push({
          path,
          message: `Expected an array at "${path}" but got ${typeof config}`,
        });
      } else {
        if (schema.minItems !== undefined && config.length < schema.minItems) {
          errors.push({
            path,
            message: `Array "${path}" must have at least ${schema.minItems} items`,
          });
        }

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

/**
 * Parse environment variables into a configuration object
 * @param env Environment variables
 * @param prefix Prefix for environment variables
 * @returns Configuration object
 */
export function parseEnvToConfig(
  env: Record<string, string | undefined>,
  prefix: string
): Record<string, any> {
  const envConfig: Record<string, any> = {};

  for (const [key, value] of Object.entries(env)) {
    // Case-insensitive prefix matching
    if (
      key.toUpperCase().startsWith(prefix.toUpperCase()) &&
      value !== undefined
    ) {
      // Remove the prefix and convert to lowercase for case-insensitive matching
      const envKey = key.replace(new RegExp(`^${prefix}`, 'i'), '');
      const parts = envKey.toLowerCase().split('_');

      if (parts.length >= 2) {
        // Handle nested properties (e.g., DVMCP_SECTION1_STRINGVALUE)
        const section = parts[0];
        const field = parts[1];

        // Ensure the section exists in the config
        if (!envConfig[section]) envConfig[section] = {};

        if (parts.length > 2) {
          // Handle deeper nesting if needed
          let current = envConfig[section];
          for (let i = 1; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!current[part]) current[part] = {};
            current = current[part];
          }
          current[parts[parts.length - 1]] = value;
        } else {
          // Set the field value in the section
          envConfig[section][field] = value;
        }
      } else if (parts.length === 1) {
        const [field] = parts;
        envConfig[field] = value;
      }
    }
  }

  // Debug output to help diagnose issues
  if (process.env.DEBUG) {
    console.log(
      'Environment variables config:',
      JSON.stringify(envConfig, null, 2)
    );
  }

  return envConfig;
}
