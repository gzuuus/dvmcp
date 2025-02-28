#!/usr/bin/env bun
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { HEX_KEYS_REGEX } from '@dvmcp/commons/constants';
import type { Config } from './src/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isNpxRun = !__dirname.includes(process.cwd());
if (!isNpxRun) {
  process.chdir(__dirname);
}

const configPath = join(process.cwd(), 'config.yml');
const configExamplePath = join(__dirname, 'config.example.yml');

async function setupConfig() {
  console.log('🔧 DVMCP Discovery Configuration Setup 🔧');

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
  let config: Config = parse(exampleConfigContent);

  // If existing config, load it instead of the example
  if (existsSync(configPath)) {
    const existingConfigContent = await Bun.file(configPath).text();
    try {
      config = parse(existingConfigContent);
    } catch (error) {
      console.warn(
        'Warning: Could not parse existing config. Using example config as base.'
      );
    }
  }

  config.nostr = config.nostr || {};
  config.mcp = config.mcp || {};
  config.whitelist = config.whitelist || {};

  console.log('\n🔑 Nostr Configuration:');
  // Check if private key exists and is valid
  const hasValidKey =
    config.nostr.privateKey &&
    HEX_KEYS_REGEX.test(config.nostr.privateKey) &&
    config.nostr.privateKey !== 'your_private_key_here';

  const useExistingKey = hasValidKey
    ? await promptYesNo('Use existing private key?', true)
    : false;

  if (!useExistingKey) {
    const useCustomKey = await promptYesNo(
      'Would you like to enter a custom private key?'
    );
    if (useCustomKey) {
      let validKey = false;
      while (!validKey) {
        const defaultKey = hasValidKey ? config.nostr.privateKey : '';
        config.nostr.privateKey = await prompt(
          'Enter your Nostr private key (hex format):',
          defaultKey
        );
        if (HEX_KEYS_REGEX.test(config.nostr.privateKey)) {
          validKey = true;
        } else {
          console.log(
            '❌ Invalid key format. Please enter a 32-byte hex string.'
          );
        }
      }
    } else {
      // Generate a random key
      config.nostr.privateKey = Buffer.from(randomBytes(32)).toString('hex');
      console.log(`Generated new private key: ${config.nostr.privateKey}`);
    }
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
        try {
          const trimmedUrl = relay.trim();
          new URL(trimmedUrl);
          if (
            !trimmedUrl.startsWith('ws://') &&
            !trimmedUrl.startsWith('wss://')
          ) {
            console.log('❌ Relay URL must start with ws:// or wss://');
            continue;
          }
          relayUrls.push(trimmedUrl);
        } catch (error) {
          console.log(`❌ Invalid relay URL: ${relay}`);
        }
      } else {
        addingRelays = false;
      }
    }
  }

  const removeRelays =
    relayUrls.length > 0 &&
    (await promptYesNo('Would you like to remove any relays?'));
  if (removeRelays) {
    let removingRelays = true;
    while (removingRelays && relayUrls.length > 0) {
      console.log('Current relays:');
      relayUrls.forEach((relay, i) => console.log(` ${i + 1}. ${relay}`));

      const indexStr = await prompt(
        'Enter number of relay to remove (or leave empty to finish):',
        ''
      );
      if (!indexStr) {
        removingRelays = false;
        continue;
      }

      const index = parseInt(indexStr, 10) - 1;
      if (isNaN(index) || index < 0 || index >= relayUrls.length) {
        console.log('Invalid relay number. Please try again.');
        continue;
      }

      relayUrls.splice(index, 1);
      console.log('Relay removed.');

      if (relayUrls.length === 0) {
        console.log('No relays remaining.');
        break;
      }
    }
  }

  config.nostr.relayUrls = relayUrls;

  console.log('\n🌐 MCP Service Configuration:');
  config.mcp.name = await prompt(
    'Service name:',
    config.mcp.name || 'DVMCP Discovery'
  );
  config.mcp.version = await prompt(
    'Service version:',
    config.mcp.version || '1.0.0'
  );
  config.mcp.about = await prompt(
    'Service description:',
    config.mcp.about ||
      'DVMCP Discovery Server for aggregating MCP tools from DVMs'
  );

  console.log('\n📝 DVM Whitelist Configuration:');
  const useWhitelist = await promptYesNo(
    'Would you like to configure a DVM whitelist?'
  );

  if (useWhitelist) {
    config.whitelist = config.whitelist || {};
    config.whitelist.allowedDVMs =
      config.whitelist.allowedDVMs || new Set<string>();

    console.log('Current whitelisted DVMs:');
    if (config.whitelist.allowedDVMs && config.whitelist.allowedDVMs.size > 0) {
      Array.from(config.whitelist.allowedDVMs).forEach((pubkey, i) =>
        console.log(` ${i + 1}. ${pubkey}`)
      );
    } else {
      console.log(' No DVMs whitelisted yet.');
    }

    let addingDVMs = true;
    while (addingDVMs) {
      const pubkey = await prompt(
        'Enter DVM public key to whitelist (or leave empty to finish):',
        ''
      );
      if (pubkey) {
        if (HEX_KEYS_REGEX.test(pubkey.trim())) {
          config.whitelist.allowedDVMs.add(pubkey.trim());
        } else {
          console.log(
            '❌ Invalid public key format. Please enter a 32-byte hex string.'
          );
        }
      } else {
        addingDVMs = false;
      }
    }
  } else if (config.whitelist?.allowedDVMs) {
    // If user doesn't want a whitelist but it exists in config, ask if they want to clear it
    const clearWhitelist = await promptYesNo(
      'Do you want to clear the existing whitelist?'
    );
    if (clearWhitelist) {
      config.whitelist.allowedDVMs = undefined;
      console.log('Whitelist cleared.');
    }
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
