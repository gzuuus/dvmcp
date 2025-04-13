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

The DVMCP Bridge supports a flexible configuration system with multiple configuration sources:

1. Default values
2. Configuration file
3. Environment variables
4. Command-line arguments

### Configuration File

When the package is run for the first time, it will detect if the `'config.dvmcp.yml'` file exists, and if not, it will launch a configuration wizard to help you create the configuration file. You can also create your configuration file by copying `config.example.yml` and changing the values of the fields:

```bash
cp config.example.yml config.dvmcp.yml
nano config.dvmcp.yml
```

You can specify a custom configuration file path using the `--config-path` flag:

```bash
npx dvmcp-bridge --config-path /path/to/custom/config.yml
```

### Environment Variables

You can configure the bridge using environment variables. The following variables are supported:

```
DVMCP_NOSTR_PRIVATE_KEY=<hex-private-key>
DVMCP_NOSTR_RELAY_URLS=wss://relay1.com,wss://relay2.com
DVMCP_MCP_NAME="My DVM Bridge"
DVMCP_MCP_ABOUT="My custom DVM bridge description"
DVMCP_MCP_CLIENT_NAME="My Client"
DVMCP_MCP_CLIENT_VERSION="1.0.0"
DVMCP_MCP_PICTURE="https://example.com/picture.jpg"
DVMCP_MCP_WEBSITE="https://example.com"
DVMCP_MCP_BANNER="https://example.com/banner.jpg"
DVMCP_WHITELIST_ALLOWED_PUBKEYS=pubkey1,pubkey2
DVMCP_LIGHTNING_ADDRESS="your-lightning-address@provider.com"
DVMCP_LIGHTNING_ZAP_RELAYS=wss://relay1.com,wss://relay2.com
```

### Command-Line Arguments

You can also configure the bridge using command-line arguments, which have the highest priority:

```bash
npx @dvmcp/bridge \
  --nostr-private-key <hex-private-key> \
  --nostr-relay-urls wss://relay1.com,wss://relay2.com \
  --mcp-name "My DVM Bridge" \
  --mcp-about "My custom DVM bridge description" \
  --mcp-client-name "My Client" \
  --mcp-client-version "1.0.0" \
  --mcp-picture "https://example.com/picture.jpg" \
  --mcp-website "https://example.com" \
  --mcp-banner "https://example.com/banner.jpg" \
  --whitelist-allowed-pubkeys pubkey1,pubkey2 \
  --lightning-address "your-lightning-address@provider.com" \
  --lightning-zap-relays wss://relay1.com,wss://relay2.com
```

Shorthand flags are available for some options:

- `-c` for `--config-path`
- `-r` for `--nostr-relay-urls`
- `-v` for `--verbose`
- `-h` for `--help`

### Configuration Priority

When multiple configuration sources provide values for the same setting, the priority order is:

1. Command-line arguments (highest priority)
2. Environment variables
3. Configuration file
4. Default values (lowest priority)

This means that command-line arguments will override environment variables, which will override values from the configuration file, which will override default values.

### Viewing Configuration

Use the `--verbose` or `-v` flag to display the current configuration:

```bash
npx @dvmcp/bridge --verbose
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
