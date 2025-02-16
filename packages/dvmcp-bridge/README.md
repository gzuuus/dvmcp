# DVMCP Bridge

A bridge implementation that connects Model Context Protocol (MCP) servers to Nostr's Data Vending Machine (DVM) ecosystem.

## Features

- Connect and manage multiple MCP servers through a single DVM instance
- Automatic service announcement using NIP-89
- Tool discovery and execution through DVM kind:5910/6910 events
- Job status updates and payment handling via kind:7000 events
- Comprehensive error handling

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
    - 'wss://relay1.com'
    - 'wss://relay2.net'

mcp:
  name: 'DVM MCP Bridge'
  about: 'MCP-enabled DVM providing AI and computational tools'
  clientName: 'DVM MCP Bridge Client'
  clientVersion: '1.0.0'
  servers:
    - name: 'server1'
      command: 'node'
      args: ['run', 'src/external-mcp-server1.ts']
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
