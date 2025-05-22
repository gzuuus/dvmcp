import type { ConfigSchema } from './types';

/**
 * Options for building yargs options
 */
export interface YargsOptionsBuilderOptions {
  /**
   * Reserved flags that should not be included in the generated options
   */
  reservedFlags?: string[];
}

/**
 * Build yargs options from a configuration schema
 * @param schema Configuration schema
 * @param options Options for building yargs options
 * @returns Object with yargs options
 */
export function buildYargsOptions(
  schema: ConfigSchema,
  options: YargsOptionsBuilderOptions = {},
  path: string[] = []
): {
  opts: Record<string, any>;
} {
  const opts: Record<string, any> = {};
  const reservedFlags = options.reservedFlags || [];

  for (const [key, meta] of Object.entries(schema)) {
    const optionKey = [...path, key].join('.');

    // Skip reserved flags
    if (reservedFlags.includes(optionKey)) {
      continue;
    }

    if (meta?.type === 'object') {
      // Recurse for nested objects
      const { opts: childOpts } = buildYargsOptions(
        meta.fields || {},
        options,
        [...path, key]
      );
      Object.assign(opts, childOpts);
    } else if (meta?.type === 'array') {
      opts[optionKey] = {
        describe: meta.doc,
        type: 'string',
        coerce: (val: unknown) => {
          if (val === undefined) return undefined;
          try {
            const parsed = JSON.parse(val as string);
            if (Array.isArray(parsed)) return parsed;
          } catch {}
          return ('' + val)
            .split(',')
            .map((v: string) => v.trim())
            .filter(Boolean);
        },
        demandOption: false,
      };
    } else {
      const typemap: Record<string, string> = {
        string: 'string',
        number: 'number',
        boolean: 'boolean',
      };
      opts[optionKey] = {
        describe: meta.doc,
        type: typemap[meta.type] || 'string',
        demandOption: false,
      };
    }
  }
  return { opts };
}

/**
 * Extract config overrides from CLI arguments
 * @param argsObj CLI arguments object
 * @param reservedFlags Reserved flags to exclude
 * @returns Config overrides object
 */
export function extractConfigOverrides(
  argsObj: Record<string, unknown>,
  reservedFlags: string[] = []
): Record<string, unknown> {
  const configOverrides: Record<string, unknown> = {};
  for (const key of Object.keys(argsObj)) {
    if (reservedFlags.includes(key)) continue;
    setDeepProp(configOverrides, key, argsObj[key]);
  }
  return configOverrides;
}

/**
 * Set a deep property in an object
 * @param obj Target object
 * @param path Property path (dot-separated)
 * @param value Property value
 */
export function setDeepProp(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const keys = path.split('.');
  let o: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; ++i) {
    if (!(keys[i] in o)) o[keys[i]] = {};
    o = o[keys[i]] as Record<string, unknown>;
  }
  o[keys[keys.length - 1]] = value;
}
