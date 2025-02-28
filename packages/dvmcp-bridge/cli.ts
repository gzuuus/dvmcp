#!/usr/bin/env bun
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import type { Config } from './src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isNpxRun = !__dirname.includes(process.cwd());

if (!isNpxRun) {
  process.chdir(__dirname);
}

const configPath = join(process.cwd(), 'config.yml');
const configExamplePath = join(__dirname, 'config.example.yml');

async function setupConfig() {
  console.log('🔧 DVMCP Bridge Configuration Setup 🔧');

  // If config exists, ask user if they want to reconfigure
  if (existsSync(configPath)) {
    const shouldReconfigure = await promptYesNo(
      'Configuration file already exists. Do you want to reconfigure it?'
    );
    if (!shouldReconfigure) {
      console.log('Using existing configuration.');
      return;
    }
  }

  // Load example config as template
  if (!existsSync(configExamplePath)) {
    console.error('Error: Example configuration file not found!');
    process.exit(1);
  }

  // Read and parse example config
  const exampleConfigContent = await Bun.file(configExamplePath).text();
  const config: Config = parse(exampleConfigContent);

  // Ensure config structure matches example
  config.nostr = config.nostr || {};
  config.mcp = config.mcp || {};
  config.mcp.servers = config.mcp.servers || [];

  console.log('\n🔑 Nostr Configuration:');
  const useExistingKey = await promptYesNo(
    'Do you have an existing Nostr private key?'
  );

  if (useExistingKey) {
    config.nostr.privateKey = await prompt(
      'Enter your Nostr private key (nsec or hex):',
      config.nostr.privateKey || ''
    );
  } else {
    // Generate a random key
    config.nostr.privateKey = Buffer.from(randomBytes(32)).toString('hex');
    console.log(`Generated new private key: ${config.nostr.privateKey}`);
  }

  console.log('\n🔄 Relay Configuration:');
  let relayUrls = config.nostr.relayUrls || [];
  console.log('Current relays:');
  if (relayUrls.length > 0) {
    relayUrls.forEach((relay, i) => console.log(` ${i + 1}. ${relay}`));
  } else {
    console.log(' No relays configured yet.');
  }

  const addRelays = await promptYesNo('Would you like to add more relays?');
  if (addRelays) {
    let addingRelays = true;
    while (addingRelays) {
      const relay = await prompt(
        'Enter relay URL (or leave empty to finish):',
        ''
      );
      if (relay) {
        relayUrls.push(relay);
      } else {
        addingRelays = false;
      }
    }
  }
  config.nostr.relayUrls = relayUrls;

  console.log('\n🌐 MCP Service Configuration:');
  config.mcp.name = await prompt(
    'Service name:',
    config.mcp.name || 'DVM MCP Bridge'
  );
  config.mcp.about = await prompt(
    'Service description:',
    config.mcp.about || 'MCP-enabled DVM providing AI and computational tools'
  );
  config.mcp.clientName = await prompt(
    'Client name:',
    config.mcp.clientName || 'DVM MCP Bridge Client'
  );
  config.mcp.clientVersion = await prompt(
    'Client version:',
    config.mcp.clientVersion || '1.0.0'
  );

  console.log('\n🖥️ MCP Servers Configuration:');
  console.log('Current configured servers:');
  if (config.mcp.servers.length > 0) {
    config.mcp.servers.forEach((server, i) => {
      console.log(
        ` ${i + 1}. ${server.name} (${server.command} ${server.args.join(' ')})`
      );
    });
  } else {
    console.log(' No servers configured yet.');
  }

  const configureServers = await promptYesNo(
    'Would you like to configure MCP servers?'
  );
  if (configureServers) {
    let configuringServers = true;
    while (configuringServers) {
      console.log('\nConfiguring a new server:');
      const name = await prompt('Server name (or leave empty to finish):', '');
      if (!name) {
        configuringServers = false;
        continue;
      }
      const command = await prompt('Command to run server:', 'node');
      const argsStr = await prompt('Command arguments (space-separated):', '');
      const args = argsStr ? argsStr.split(' ') : [];
      config.mcp.servers.push({ name, command, args });
    }
  }

  console.log('\n📝 Whitelist Configuration:');
  const useWhitelist = await promptYesNo(
    'Would you like to configure a public key whitelist?'
  );

  if (useWhitelist) {
    config.whitelist = config.whitelist || {};
    config.whitelist.allowedPubkeys = config.whitelist.allowedPubkeys;

    console.log('Current allowed public keys:');
    if (
      config.whitelist.allowedPubkeys &&
      config.whitelist.allowedPubkeys.size > 0
    ) {
      config.whitelist.allowedPubkeys.forEach((pubkey, i) =>
        console.log(` ${i + 1}. ${pubkey}`)
      );
    } else {
      console.log(' No public keys whitelisted yet.');
    }

    let addingPubkeys = true;
    while (addingPubkeys) {
      const pubkey = await prompt(
        'Enter public key to whitelist (or leave empty to finish):',
        ''
      );
      if (pubkey) {
        if (!config.whitelist.allowedPubkeys) {
          config.whitelist.allowedPubkeys = new Set<string>();
        }
        config.whitelist.allowedPubkeys.add(pubkey);
      } else {
        addingPubkeys = false;
      }
    }
  } else if (config.whitelist) {
    // If user doesn't want a whitelist but it exists in config, remove it
    config.whitelist.allowedPubkeys = undefined;
  }

  // Save the config
  writeFileSync(configPath, stringify(config));
  console.log(`\n✅ Configuration saved to ${configPath}`);
}

async function prompt(question: string, defaultValue = ''): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      `${question}${defaultValue ? ` (${defaultValue})` : ''} `,
      (answer) => {
        rl.close();
        resolve(answer || defaultValue);
      }
    );
  });
}

async function promptYesNo(
  question: string,
  defaultValue = false
): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultIndicator = defaultValue ? 'Y/n' : 'y/N';

  return new Promise((resolve) => {
    rl.question(`${question} (${defaultIndicator}) `, (answer) => {
      rl.close();
      if (answer.trim() === '') {
        resolve(defaultValue);
      } else {
        resolve(answer.toLowerCase().startsWith('y'));
      }
    });
  });
}

await setupConfig();

import('./index.js');
