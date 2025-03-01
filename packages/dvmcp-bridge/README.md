# DVMCP Bridge

A bridge implementation that connects Model Context Protocol (MCP) servers to Nostr's Data Vending Machine (DVM) ecosystem.

## Features

- Connect and manage multiple MCP servers through a single DVM instance
- Automatic service announcement using NIP-89
- Tool discovery and execution through DVM kind:5910/6910 events
- Job status updates and payment handling via kind:7000 events
- Comprehensive error handling

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
npx @dvmcp/bridge
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
