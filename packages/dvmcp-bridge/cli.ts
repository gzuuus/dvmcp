#!/usr/bin/env bun
import { join, dirname } from 'node:path';
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ensure we can run from any directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
process.chdir(__dirname);

// Check for config file
const configPath = join(process.cwd(), 'config.yml');
const configExamplePath = join(process.cwd(), 'config.example.yml');

if (!existsSync(configPath)) {
  console.log('Configuration file not found at config.yml');
  console.log('You can create one by copying the example:');
  console.log('cp config.example.yml config.yml');

  // Automatically copy example config if it exists
  if (existsSync(configExamplePath)) {
    console.log('Creating config.yml from example...');
    copyFileSync(configExamplePath, configPath);
    console.log(
      '✅ Created config.yml - please edit this file with your settings!'
    );
  }
}

// Run the application
import './index.js';
