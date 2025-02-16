# DVMCP: Data Vending Machine Context Protocol

A monorepo containing packages that bridge Model Context Protocol (MCP) servers with Nostr's Data Vending Machine (DVM) ecosystem, enabling AI and computational tools to be discovered and utilized via Nostr's decentralized network.

## Packages

This monorepo contains the following packages:

### [@dvmcp-bridge](./packages/dvmcp-bridge)
The bridge implementation let's you connect MCP servers to Nostr's DVM ecosystem. Handles tool announcement, execution, and status updates.

### [@dvmcp-discovery](./packages/dvmcp-discovery)
A MCP server, discovery service that aggregates MCP tools from DVMs, and make their tools available

### [@commons](./packages/commons)
Shared utilities and components used across DVMCP packages.

## Getting Started

1. Install dependencies:
```bash
bun install
```

2. Set up configurations:
```bash
# For the bridge
cp packages/dvmcp-bridge/config.example.yml packages/dvmcp-bridge/config.yml

# For the discovery service
cp packages/dvmcp-discovery/config.example.yml packages/dvmcp-discovery/config.yml
```

3. Edit the configuration files according to your needs.

## Development

```bash
# Start the bridge in development mode
bun run dev --cwd packages/dvmcp-bridge

# Start the discovery service in development mode
bun run dev --cwd packages/dvmcp-discovery
```

## Production

```bash
# Start the bridge
bun run start --cwd packages/dvmcp-bridge

# Start the discovery service
bun run start --cwd packages/dvmcp-discovery
```

## Documentation

- [DVMCP Specification](./docs/dvmcp-spec.md)
- [Bridge Package](./packages/dvmcp-bridge/README.md)
- [Discovery Package](./packages/dvmcp-discovery/README.md)
- [Commons Package](./packages/commons/README.md)

## Contributing

Contributions are welcome! Please feel free to submit pull requests or create issues.

## License

[MIT License](LICENSE)

## Related Projects

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Nostr Protocol](https://github.com/nostr-protocol/nips)