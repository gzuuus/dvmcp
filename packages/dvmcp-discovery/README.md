# DVMCP Discovery

A MCP server implementation that aggregates tools from DVMs across the Nostr network and makes them available through a single interface.

## Features

- Discovers MCP tools from DVMs across the Nostr network
- Provides a unified interface to access tools from multiple DVMs
- Tool execution handling and status tracking
- Configurable DVM whitelist
- Direct connection to specific providers or servers

## Configuration

When the package is run for the first time, it will detect if the `config.dvmcp.yml` file exists, and if not, it will launch a configuration wizard to help you create the configuration file. You can also create your configuration file by copying `config.example.yml` and changing the values of the fields

```bash
cp config.example.yml config.dvmcp.yml
nano config.dvmcp.yml
```

You can also specify a custom configuration file path using the `--config-path` flag.

```bash
npx dvmcp-discovery --config-path /path/to/custom/config.dvmcp.yml
```

## Usage

**Prerequisite:** Ensure you have [Bun](https://bun.sh/) installed.

You can run this package directly using `npx`:

```bash
npx @dvmcp/discovery
```

Alternatively, for development:

```bash
bun run dev
```

For production:

```bash
bun run start
```

### Direct Connection Options

You can connect directly to a specific provider or server without a configuration file:

#### Connect to a Provider

Use the `--provider` flag followed by an nprofile entity to discover and register all tools from a specific provider:

```bash
bun run start --provider nprofile1...
```

#### Connect to a Server

Use the `--server` flag followed by an naddr entity to register only the tools from a specific server:

```bash
bun run start --server naddr1...
```

This is useful when you want to work with a specific subset of tools rather than discovering all tools from a provider.

## Debug

You can enable debug mode by setting the `DEBUG` environment variable to `*`:

```bash
DEBUG=* npx @dvmcp/discovery
```

## Testing

Run the test suite:

```bash
bun test
```
