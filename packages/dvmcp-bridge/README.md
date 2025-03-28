# DVMCP Bridge

A bridge implementation that connects Model Context Protocol (MCP) servers to Nostr's Data Vending Machine (DVM) ecosystem.

## Features

- Connect and manage multiple MCP servers through a single DVM instance
- Automatic service announcement using NIP-89
- Tool discovery and execution through DVM kind:5910/6910 events
- Job status updates and payment handling via kind:7000 events
- Service announcement deletion using NIP-09
- Comprehensive error handling

## Configuration

When the package is run for the first time, it will detect if the `'config.dvmcp.yml'` file exists, and if not, it will launch a configuration wizard to help you create the configuration file. You can also create your configuration file by copying `config.example.yml` and changing the values of the fields

```bash
cp config.example.yml config.dvmcp.yml
nano config.dvmcp.yml
```

You can also specify a custom configuration file path using the `--config-path` flag:

```bash
npx dvmcp-bridge --config-path /path/to/custom/config.yml
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

### Deleting Service Announcements

To remove your service announcements from relays when shutting down or taking your service offline, you can use the `--delete-announcement` flag:

```bash
bun run start --delete-announcement
```

You can also provide an optional reason for the deletion:

```bash
bun run start --delete-announcement --reason "Service maintenance in progress"
```

This will send a NIP-09 deletion event (kind 5) to all connected relays, instructing them to remove your previously published service announcements.

## Testing

Run the test suite:

```bash
bun test
```
