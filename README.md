[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/gzuuus-dvmcp-badge.png)](https://mseep.ai/app/gzuuus-dvmcp)

# DVMCP: Data Vending Machine Context Protocol
A monorepo containing packages that bridge Model Context Protocol (MCP) servers with Nostr's Data Vending Machine (DVM) ecosystem, enabling AI and computational tools to be discovered and utilized via Nostr's decentralized network.
## Packages
This monorepo contains the following packages:
### [@dvmcp/bridge](./packages/dvmcp-bridge)
The bridge implementation that connects MCP servers to Nostr's DVM ecosystem. Handles tool announcement, execution, and status updates.
### [@dvmcp/discovery](./packages/dvmcp-discovery)
A MCP server/discovery service that aggregates MCP tools from DVMs and makes their tools available.
### [@dvmcp/commons](./packages/dvmcp-commons)
Shared utilities and components used across DVMCP packages.
## Installation & Usage
**Prerequisite:** Ensure you have [Bun](https://bun.sh/) installed.

### Quick Start with NPX (No Installation)
You can run the packages directly using `npx` without installing them:
```bash
# Run the bridge
npx @dvmcp/bridge
# Run the discovery service
npx @dvmcp/discovery
```
The interactive CLI will guide you through configuration setup on first run.
### Global Installation
```bash
# Install the packages globally
npm install -g @dvmcp/bridge @dvmcp/discovery
# Run the commands
dvmcp-bridge
dvmcp-discovery
```
## Setting Up a Bridge
To expose your MCP server as a DVM on Nostr:
1. Navigate to the directory where you want to configure the bridge
2. Run: `npx @dvmcp/bridge`
3. Follow the interactive setup to configure:
- Your MCP server path
- Nostr private key (or generate a new one)
- Relays to connect to
4. The bridge will start and begin proxying requests between Nostr and your MCP server
## Setting Up a Discovery Service
To aggregate MCP tools from DVMs:
1. Navigate to your desired directory
2. Run: `npx @dvmcp/discovery`
3. Follow the setup to configure:
- Nostr private key
- Relays to monitor
## Development
For contributors to this repository:
```bash
# Clone the repo
git clone https://github.com/gzuuus/dvmcp.git
cd dvmcp
# Install dependencies
bun install
# Start the bridge in development mode
bun run dev --cwd packages/dvmcp-bridge
# Start the discovery service in development mode
bun run dev --cwd packages/dvmcp-discovery
```
## Documentation
- [DVMCP Specification](./docs/dvmcp-spec.md)
- [Bridge Package](./packages/dvmcp-bridge/README.md)
- [Discovery Package](./packages/dvmcp-discovery/README.md)
- [Commons Package](./packages/dvmcp-commons/README.md)
## Contributing
Contributions are welcome! Please feel free to submit pull requests or create issues.
## License
[MIT License](LICENSE)
## Related Projects
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Nostr Protocol](https://github.com/nostr-protocol/nips)