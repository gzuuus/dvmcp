/**
 * Common types for the configuration system
 */

/**
 * Field types supported in configuration schemas
 */
export type ConfigFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object';

/**
 * Base configuration field metadata
 */
export interface ConfigFieldMeta {
  type: ConfigFieldType;
  required?: boolean;
  default?: any;
  doc?: string;
  fields?: Record<string, ConfigFieldMeta>;
  itemType?: string | ObjectFieldMeta;
  minItems?: number;
  keyType?: string;
  valueType?: string;
}

/**
 * String field metadata
 */
export interface StringFieldMeta extends ConfigFieldMeta {
  type: 'string';
  default?: string;
}

/**
 * Number field metadata
 */
export interface NumberFieldMeta extends ConfigFieldMeta {
  type: 'number';
  default?: number;
}

/**
 * Boolean field metadata
 */
export interface BooleanFieldMeta extends ConfigFieldMeta {
  type: 'boolean';
  default?: boolean;
}

/**
 * Array field metadata
 */
export interface ArrayFieldMeta extends ConfigFieldMeta {
  type: 'array';
  itemType: string | ObjectFieldMeta;
  default?: any[];
  minItems?: number;
}

/**
 * Object field metadata
 */
export interface ObjectFieldMeta extends ConfigFieldMeta {
  type: 'object';
  fields?: Record<string, ConfigFieldMeta>;
  keyType?: string;
  valueType?: string;
}

/**
 * Union type for all field metadata types
 */
export type AnyFieldMeta =
  | StringFieldMeta
  | NumberFieldMeta
  | BooleanFieldMeta
  | ArrayFieldMeta
  | ObjectFieldMeta;

/**
 * Configuration schema type
 */
export type ConfigSchema = Record<string, ConfigFieldMeta>;

/**
 * Validation error type
 */
export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Configuration loader options
 */
export interface ConfigLoaderOptions<T> {
  configPath?: string;
  env?: Record<string, string>;
  cliFlags?: Record<string, any>;
  envPrefix?: string;
  preloadedConfig?: T;
}
