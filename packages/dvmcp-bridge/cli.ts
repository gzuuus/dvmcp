#!/usr/bin/env bun
/**
 * @file Command-line interface for the DVMCP Bridge package
 * This file provides the CLI entry point for the dvmcp-bridge command
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'path';
import process from 'process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  dvmcpBridgeConfigSchema,
  startBridge,
  loadDvmcpConfig,
} from './index.js';
import { CONFIG_EMOJIS } from '@dvmcp/commons/config-generator';

/**
 * Recursively transform schema into yargs options, with robust types.
 */
type AnySchema = { [k: string]: unknown } | { fields?: Record<string, any> };
function buildYargsOptions(
  schema: AnySchema,
  path: string[] = []
): {
  opts: Record<string, any>;
  normalizers: Record<string, (srcVal: any) => any>;
} {
  const opts: Record<string, any> = {};
  const normalizers: Record<string, (srcVal: any) => any> = {};

  const fields = ('fields' in schema ? schema.fields : schema) as Record<
    string,
    any
  >;

  for (const [key, meta] of Object.entries(fields)) {
    const optionKey = [...path, key].join('.');
    if (meta?.type === 'object') {
      // Recurse for nested objects
      const { opts: childOpts, normalizers: childNorms } = buildYargsOptions(
        meta,
        [...path, key]
      );
      Object.assign(opts, childOpts);
      Object.assign(normalizers, childNorms);
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
        // Don't demand options upfront, we'll validate after loading config
        demandOption: false,
        default: meta.default,
      };
      normalizers[optionKey] = (srcVal: any) => srcVal;
    } else {
      // Scalar
      const typemap: Record<string, string> = {
        string: 'string',
        number: 'number',
        boolean: 'boolean',
      };
      opts[optionKey] = {
        describe: meta.doc,
        type: typemap[meta.type] || 'string',
        // Don't demand options upfront, we'll validate after loading config
        demandOption: false,
        default: meta.default,
      };
      normalizers[optionKey] = (srcVal: any) => srcVal;
    }
  }
  return { opts, normalizers };
}

// Build CLI schema-driven options
const { opts: yargsOptions, normalizers } = buildYargsOptions(
  dvmcpBridgeConfigSchema
);

// These options are “reserved” controls (not config fields):
const reservedFlags = [
  'configure',
  'delete-announcement',
  'verbose',
  'reason',
  'config-path',
  'help',
];

// Yargs CLI definition
const cli = yargs(hideBin(process.argv))
  .usage(
    `${CONFIG_EMOJIS.INFO} DVMCP Bridge - MCP-enabled DVM providing AI/computational tools\n\nUsage: dvmcp-bridge [options]`
  )
  .options({
    configure: {
      type: 'boolean',
      describe: 'Run interactive config wizard and exit.',
    },
    'delete-announcement': {
      type: 'boolean',
      describe: 'Delete announcement event and exit.',
    },
    reason: {
      type: 'string',
      describe: 'Reason text for --delete-announcement',
    },
    'config-path': {
      type: 'string',
      describe: 'Path to config YAML file [default: ./config.dvmcp.yml]',
    },
    verbose: { type: 'boolean', describe: 'Print config before running.' },
    ...yargsOptions,
  })
  .help('help')
  .alias('help', 'h')
  .example([
    [
      '$0 --nostr.privateKey deadbeef --mcp.servers \'[{"name":"foo","command":"node","args":["a.js"]}]\'',
      'Override nested/array config via CLI',
    ],
    ['$0 --config-path ./bridge.yml --help', 'Show help with docs'],
    ['$0 --configure', 'Run config wizard'],
  ])
  .wrap(Math.min(110, process.stdout.columns || 100));
// Parse CLI args
const args = cli.parseSync();

// Strip reserved flags from config override set
/**
 * Extract CLI-defined config overrides, ignoring reserved flags.
 */
function extractConfigOverrides(
  argsObj: Record<string, unknown>
): Record<string, unknown> {
  const configOverrides: Record<string, unknown> = {};
  for (const key of Object.keys(argsObj)) {
    // Only include options produced by schema, skip reserved/known
    if (reservedFlags.includes(key)) continue;
    setDeepProp(configOverrides, key, argsObj[key]);
  }
  return configOverrides;
}

// Helper to set .-delimited path in object tree
function setDeepProp(
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

// Default config path, but prefer --config-path if provided
const configPath = args['config-path']
  ? resolve(args['config-path'])
  : join(process.cwd(), 'config.dvmcp.yml');

/* No-op: setConfigPath removed – configPath is passed directly to loader */
const configure = async (): Promise<void> => {
  // Lazy import only if used to minimize deps
  const { ConfigGenerator } = await import('@dvmcp/commons/config-generator');

  console.log(
    `${CONFIG_EMOJIS.SETUP} DVMCP Bridge Configuration Setup ${CONFIG_EMOJIS.SETUP}`
  );

  const generator = new ConfigGenerator(configPath, {});
  await generator.generate();
};

const runApp = async (config: any) => {
  console.log(`${CONFIG_EMOJIS.INFO} Running main application...`);
  try {
    await startBridge({ preloadedConfig: config });
  } catch (error) {
    console.error(`${CONFIG_EMOJIS.INFO} Failed to start bridge:`, error);
    process.exit(1);
  }
};

const deleteAnnouncement = async (config: any) => {
  const reason =
    typeof args['reason'] === 'string' ? args['reason'] : undefined;
  try {
    // Create a bridge instance using the startBridge function
    const bridge = await startBridge({ preloadedConfig: config });
    console.log(`${CONFIG_EMOJIS.INFO} Deleting service announcement...`);
    await bridge.deleteAnnouncement(reason);
    console.log(
      `${CONFIG_EMOJIS.SUCCESS} Service announcement deleted successfully`
    );
    process.exit(0);
  } catch (error) {
    console.error(
      `${CONFIG_EMOJIS.INFO} Failed to delete service announcement:`,
      error
    );
    process.exit(1);
  }
};

const cliMain = async () => {
  if (args['help']) {
    cli.showHelp();
    // Print extra schema/option reference
    console.log('\n---\nConfig schema options:');
    Object.entries(dvmcpBridgeConfigSchema).forEach(([section, meta]) => {
      console.log(`  --${section}.* : ${meta.doc}`);
      if (meta.fields) {
        Object.entries(meta.fields).forEach(([sub, submeta]) => {
          console.log(
            `    --${section}.${sub} : ${submeta.doc}${submeta.required ? ' (required)' : ''}`
          );
        });
      }
    });
    process.exit(0);
  }

  if (args['configure']) {
    await configure();
    return;
  }

  // Load, merge, and validate the final config (now including CLI flag overrides)
  // (move config loading/validation before relay handler instantiation)
  // Prepare CLI flag overrides in config schema shape
  const cliFlagsConfig = extractConfigOverrides(args);

  let config;
  try {
    // Check if config file exists before attempting to load
    if (!existsSync(configPath)) {
      console.log(
        `${CONFIG_EMOJIS.INFO} No configuration file found at ${configPath}`
      );
      console.log(
        `${CONFIG_EMOJIS.INFO} You can create one by copying config.example.yml to config.dvmcp.yml and editing it.`
      );
      console.log(
        `${CONFIG_EMOJIS.INFO} Alternatively, you can run with --configure to set up a new configuration.`
      );

      if (!args['configure']) {
        console.log(`${CONFIG_EMOJIS.INFO} Starting configuration wizard...`);
        await configure();
        // After configuration is complete, try loading again
        console.log(
          `${CONFIG_EMOJIS.INFO} Configuration created, attempting to load...`
        );
      }
    }

    // Load configuration using the loadDvmcpConfig function
    config = await loadDvmcpConfig({
      configPath,
      // Only include defined env variables as strings
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([_, v]) => typeof v === 'string'
        ) as [string, string][]
      ),
      // Pass CLI flags directly to the loader for proper merging
      cliFlags: cliFlagsConfig,
    });
  } catch (err) {
    console.error(`${CONFIG_EMOJIS.INFO} Config loading failed:`);
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    console.log(
      `${CONFIG_EMOJIS.INFO} Try running with --configure to set up a new configuration.`
    );
    process.exit(1);
  }

  if (args['delete-announcement']) {
    if (!existsSync(configPath)) {
      console.error(
        `${CONFIG_EMOJIS.INFO} No configuration file found at ${configPath}`
      );
      process.exit(1);
    }
    await deleteAnnouncement(config);
    return;
  }

  if (!existsSync(configPath)) {
    console.log(
      `${CONFIG_EMOJIS.INFO} No configuration file found. Starting setup...`
    );
    await configure();
  }

  if (args['verbose']) {
    // Print the actively loaded config as YAML (for --verbose users)
    const { default: yaml } = await import('yaml');
    console.log('\n📋 DVMCP Bridge Configuration:');
    console.log(yaml.stringify(config));
  }

  await runApp(config);
};

cliMain().catch(console.error);
