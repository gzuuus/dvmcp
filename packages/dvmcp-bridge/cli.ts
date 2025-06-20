#!/usr/bin/env bun
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
import {
  buildYargsOptions,
  CONFIG_EMOJIS,
  ConfigGenerator,
  configSchemaToFieldConfig,
  extractConfigOverrides,
} from '@dvmcp/commons/config';
import type { DvmcpBridgeConfig } from './src/config-schema.js';

const reservedFlags = [
  'configure',
  'delete-announcement',
  'verbose',
  'reason',
  'config-path',
  'help',
];

const { opts: yargsOptions } = buildYargsOptions(dvmcpBridgeConfigSchema, {
  reservedFlags,
});

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
  .wrap(Math.min(110, process.stdout.columns || 100))
  .version(require('./package.json').version);
const args = cli.parseSync();

const configPath = args['config-path']
  ? resolve(args['config-path'])
  : join(process.cwd(), 'config.dvmcp.yml');

const configure = async (): Promise<void> => {
  const { dvmcpBridgeConfigSchema } = await import('./src/config-schema');

  console.log(
    `${CONFIG_EMOJIS.SETUP} DVMCP Bridge Configuration Setup ${CONFIG_EMOJIS.SETUP}`
  );

  // Convert the config schema to field config format
  const fieldConfig = configSchemaToFieldConfig(dvmcpBridgeConfigSchema);

  const generator = new ConfigGenerator<DvmcpBridgeConfig>(
    configPath,
    fieldConfig
  );
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

const deleteAnnouncement = async (config: DvmcpBridgeConfig) => {
  const reason =
    typeof args['reason'] === 'string' ? args['reason'] : undefined;
  try {
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
  if (args.configure) {
    await configure();
    return;
  }

  const cliFlagsConfig = extractConfigOverrides(args, reservedFlags);

  let config;
  try {
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
        console.log(
          `${CONFIG_EMOJIS.INFO} Configuration created, attempting to load...`
        );
      }
    }

    config = await loadDvmcpConfig({
      configPath,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([_, v]) => typeof v === 'string'
        ) as [string, string][]
      ),
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

  if (args.deleteAnnouncement) {
    if (!existsSync(configPath)) {
      console.error(
        `${CONFIG_EMOJIS.INFO} No configuration file found at ${configPath}`
      );
      process.exit(1);
    }
    await deleteAnnouncement(config);
    return;
  }

  if (args.verbose) {
    const { default: yaml } = await import('yaml');
    console.log('\n📋 DVMCP Bridge Configuration:');
    console.log(yaml.stringify(config));
  }

  await runApp(config);
};

cliMain().catch(console.error);
