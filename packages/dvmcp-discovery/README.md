# DVMCP Discovery

A MCP server implementation that aggregates tools from DVMs across the Nostr network and makes them available through a single interface.

## Features

- Discovers MCP tools from DVMs across the Nostr network
- Provides a unified interface to access tools from multiple DVMs
- Tool execution handling and status tracking
- Configurable DVM whitelist

## Configuration

When the package is run for the first time, it will detect if the `config.yml` file exists, and if not, it will launch a configuration wizard to help you create the configuration file. You can also create your configuration file by copying `config.example.yml` and changing the values of the fields

```bash
cp config.example.yml config.yml
nano config.yml
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

## Testing

Run the test suite:

```bash
bun test
```
