# DVMCP Discovery

A MCP server implementation that aggregates tools from DVMs across the Nostr network and makes them available through a single interface.

## Features

- Discovers MCP tools from DVMs across the Nostr network
- Provides a unified interface to access tools from multiple DVMs
- Tool execution handling and status tracking
- Configurable DVM whitelist

## Configuration

Create your configuration file by copying the example:

```bash
cp config.example.yml config.yml
```

Example configuration:

```yaml
nostr:
  privateKey: 'your_private_key_here'
  relayUrls:
    - 'wss://relay.damus.io'
    - 'wss://relay.nostr.band'

mcp:
  name: 'DVMCP Discovery'
  version: '1.0.0'
  about: 'DVMCP Discovery Server for aggregating MCP tools from DVMs'
# Optional: whitelist specific DVMs
# whitelist:
#   allowedDVMs:
#     - 'pubkey1'
#     - 'pubkey2'
```

## Usage

Development mode:

```bash
bun run dev
```

Production mode:

```bash
bun run start
```

## Testing

Run the test suite:

```bash
bun test
```
