# DVMCP Discovery

A MCP server implementation that aggregates tools from DVMs across the Nostr network and makes them available through a single interface.

## Features

- Discovers MCP tools from DVMs across the Nostr network
- Provides a unified interface to access tools from multiple DVMs
- Tool execution handling and status tracking
- Configurable DVM whitelist

## Configuration

You can run the configuration wizard directly using `npx`, more details below, or run `bun setup` in the package directory, or create your configuration file by copying `config.example.yml` and replacing the values of the fields

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
