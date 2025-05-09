import {
  expect,
  test,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
} from 'bun:test';
import { join } from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import * as YAML from 'yaml';
import { loadDvmcpConfig } from './config-loader';

describe('Configuration Loader', () => {
  // Path for temporary test config file that will be created and deleted during tests
  const tempConfigPath = join(import.meta.dir, '../temp-test-config.yml');

  // Test fixtures to reduce duplication
  const baseConfig = {
    nostr: {
      privateKey:
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      relayUrls: ['wss://test-relay.com'],
    },
    mcp: {
      name: 'Base Config Name',
      clientName: 'Test Client',
      clientVersion: '1.0.0',
      servers: [
        {
          name: 'test-server',
          command: 'node',
          args: ['server.js'],
        },
      ],
    },
  };

  // Helper function to create a config file
  const createConfigFile = (config: any = baseConfig) => {
    writeFileSync(tempConfigPath, YAML.stringify(config));
    return tempConfigPath;
  };

  // Clean up any test config files before and after tests
  beforeAll(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  afterAll(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  beforeEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  test('should apply file config values correctly', async () => {
    // Create a config file with custom values
    const fileConfig = {
      ...baseConfig,
      nostr: {
        ...baseConfig.nostr,
        relayUrls: ['wss://file-relay.com'],
      },
      mcp: {
        ...baseConfig.mcp,
        name: 'File Config Name',
      },
    };

    // Create the config file
    createConfigFile(fileConfig);

    // Load config using the file
    const config = await loadDvmcpConfig({
      configPath: tempConfigPath,
    });

    // Verify file values are loaded correctly
    expect(config.mcp.name).toBe('File Config Name');
    expect(config.nostr.relayUrls).toEqual(['wss://file-relay.com']);
  });

  test('should prioritize config file over defaults', async () => {
    // Create a config file with custom values
    const fileConfig = {
      ...baseConfig,
      mcp: {
        ...baseConfig.mcp,
        name: 'File Config Name',
      },
    };

    // Create the config file
    createConfigFile(fileConfig);

    // Load config using the file
    const config = await loadDvmcpConfig({
      configPath: tempConfigPath,
    });

    // Verify file values are used
    expect(config.mcp.name).toBe('File Config Name');
  });

  test('should prioritize environment variables over file config', async () => {
    // Create a config file with custom values
    const fileConfig = {
      ...baseConfig,
      mcp: {
        ...baseConfig.mcp,
        name: 'File Config Name',
      },
    };

    // Create the config file
    createConfigFile(fileConfig);

    // Create environment variables
    const envVars = {
      DVMCP_MCP_NAME: 'Env Config Name',
    };

    // Load config using both file and env
    const config = await loadDvmcpConfig({
      configPath: tempConfigPath,
      env: envVars,
    });

    // Verify env values override file values
    expect(config.mcp.name).toBe('Env Config Name');
  });

  test('should prioritize CLI flags over environment variables', async () => {
    // Create a config file with custom values
    const fileConfig = {
      ...baseConfig,
      mcp: {
        ...baseConfig.mcp,
        name: 'File Config Name',
      },
    };

    // Create the config file
    createConfigFile(fileConfig);

    // Create environment variables
    const envVars = {
      DVMCP_MCP_NAME: 'Env Config Name',
    };

    // Create CLI flags
    const cliFlags = {
      mcp: {
        name: 'CLI Config Name',
      },
    };

    // Load config using file, env, and CLI
    const config = await loadDvmcpConfig({
      configPath: tempConfigPath,
      env: envVars,
      cliFlags: cliFlags,
    });

    // Verify CLI values override env and file values
    expect(config.mcp.name).toBe('CLI Config Name');
  });

  test('should correctly merge arrays from different sources', async () => {
    // Create a config file with relay URLs
    const fileConfig = {
      ...baseConfig,
      nostr: {
        ...baseConfig.nostr,
        relayUrls: ['wss://file-relay.com'],
      },
    };

    // Create the config file
    createConfigFile(fileConfig);

    // Create CLI flags with different relay URLs
    const cliFlags = {
      nostr: {
        relayUrls: ['wss://cli-relay.com'],
      },
    };

    // Load config using both file and CLI
    const config = await loadDvmcpConfig({
      configPath: tempConfigPath,
      cliFlags: cliFlags,
    });

    // Verify CLI relay URLs override file relay URLs (not merged)
    expect(config.nostr.relayUrls).toEqual(['wss://cli-relay.com']);
  });

  test('should handle environment variables correctly', async () => {
    // Create the config file with base configuration
    createConfigFile();

    // Create environment variables to override specific values
    const envVars = {
      DVMCP_MCP_NAME: 'Env MCP Name',
    };

    // Load config using file and env vars
    const config = await loadDvmcpConfig({
      configPath: tempConfigPath,
      env: envVars,
    });

    // Verify env vars override file values for scalar properties
    expect(config.mcp.name).toBe('Env MCP Name');

    // These should come from the file
    expect(config.nostr.privateKey).toBe(baseConfig.nostr.privateKey);
    expect(config.nostr.relayUrls).toEqual(baseConfig.nostr.relayUrls);
    expect(config.mcp.clientName).toBe(baseConfig.mcp.clientName);
    expect(config.mcp.clientVersion).toBe(baseConfig.mcp.clientVersion);
    expect(config.mcp.servers[0].name).toBe(baseConfig.mcp.servers[0].name);
  });
});
