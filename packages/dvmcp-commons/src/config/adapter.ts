/**
 * Adapter functions to convert between ConfigSchema and FieldConfig formats
 */
import type { ConfigFieldMeta, ConfigSchema } from './types';
import type { FieldConfig, FieldType } from './config-generator';
import {
  CONFIG_EMOJIS,
  generateHexKey,
  validateHexKey,
  validateRelayUrl,
} from './config-generator';

/**
 * Maps ConfigFieldMeta types to FieldConfig types
 */
const typeMapping: Record<string, FieldType> = {
  string: 'string',
  number: 'string',
  boolean: 'boolean',
  array: 'array',
  object: 'nested',
};

/**
 * Get an appropriate emoji for a field based on its name and type
 *
 * @param fieldName The name of the field
 * @param fieldType The type of the field
 * @returns An emoji string
 */
function getEmojiForField(fieldName: string, fieldType: string): string {
  if (
    fieldName.toLowerCase().includes('key') ||
    fieldName.toLowerCase() === 'privatekey'
  ) {
    return CONFIG_EMOJIS.NOSTR;
  }
  if (
    fieldName.toLowerCase().includes('relay') ||
    fieldName.toLowerCase().includes('url')
  ) {
    return CONFIG_EMOJIS.RELAY;
  }
  if (fieldName.toLowerCase() === 'servers') {
    return CONFIG_EMOJIS.SERVER;
  }
  if (
    fieldName.toLowerCase() === 'whitelist' ||
    fieldName.toLowerCase().includes('allowed')
  ) {
    return CONFIG_EMOJIS.WHITELIST;
  }
  if (fieldName.toLowerCase() === 'mcp') {
    return CONFIG_EMOJIS.SERVICE;
  }

  switch (fieldType) {
    case 'nested':
      return CONFIG_EMOJIS.SETUP;
    case 'object-array':
      return CONFIG_EMOJIS.SERVER;
    case 'array':
      return CONFIG_EMOJIS.INFO;
    default:
      return CONFIG_EMOJIS.PROMPT;
  }
}

/**
 * Convert a ConfigSchema to the FieldConfig format expected by ConfigGenerator
 *
 * @param schema The ConfigSchema to convert
 * @returns A Record of field names to FieldConfig objects
 */
export function configSchemaToFieldConfig(
  schema: ConfigSchema
): Record<string, FieldConfig> {
  const result: Record<string, FieldConfig> = {};

  for (const [key, fieldMeta] of Object.entries(schema)) {
    result[key] = convertFieldMeta(key, fieldMeta);
  }

  return result;
}

/**
 * Convert a single ConfigFieldMeta to a FieldConfig
 *
 * @param fieldName The name of the field
 * @param fieldMeta The field metadata
 * @returns A FieldConfig object
 */
function convertFieldMeta(
  fieldName: string,
  fieldMeta: ConfigFieldMeta
): FieldConfig {
  let fieldType = typeMapping[fieldMeta.type] || 'string';

  if (fieldName === 'servers') {
    fieldType = 'object-array';
  } else if (
    fieldMeta.type === 'array' &&
    typeof fieldMeta.itemType === 'object'
  ) {
    fieldType = 'object-array';
  } else if (fieldMeta.type === 'array' && fieldMeta.itemType === 'object') {
    fieldType = 'object-array';
  }

  if (fieldMeta.type === 'string' && fieldName.toLowerCase().includes('key')) {
    fieldType = 'hex';
  }
  if (
    fieldMeta.type === 'array' &&
    (fieldName.toLowerCase().includes('url') ||
      fieldName.toLowerCase().includes('relay'))
  ) {
    fieldType = 'array';
  }

  const result: FieldConfig = {
    type: fieldType,
    description: fieldMeta.doc || `Enter ${fieldName}`,
    default: fieldMeta.default,
    required: fieldMeta.required,
    emoji: getEmojiForField(fieldName, fieldType),
  };

  if (fieldType === 'hex') {
    result.validation = validateHexKey;
  } else if (
    fieldName.toLowerCase().includes('relay') &&
    fieldType === 'array'
  ) {
    result.validation = validateRelayUrl;
  }

  if (fieldType === 'hex' && fieldName.toLowerCase().includes('key')) {
    result.generator = generateHexKey;
  }
  if (fieldMeta.type === 'object' && fieldMeta.fields) {
    result.fields = {};
    for (const [nestedKey, nestedMeta] of Object.entries(fieldMeta.fields)) {
      result.fields[nestedKey] = convertFieldMeta(nestedKey, nestedMeta);
    }
  }

  if (fieldType === 'object-array') {
    result.fields = {};

    if (fieldMeta.itemType === 'object' && fieldMeta.fields) {
      for (const [nestedKey, nestedMeta] of Object.entries(fieldMeta.fields)) {
        result.fields[nestedKey] = convertFieldMeta(nestedKey, nestedMeta);
      }
    } else if (fieldMeta.itemType && typeof fieldMeta.itemType === 'object') {
      for (const [nestedKey, nestedMeta] of Object.entries(
        fieldMeta.itemType.fields || {}
      )) {
        result.fields[nestedKey] = convertFieldMeta(nestedKey, nestedMeta);
      }
    }
  }

  return result;
}
