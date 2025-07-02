# DVMCP: Data Vending Machine Context Protocol

DVMCP (Data Vending Machine Context Protocol) is a project that bridges the Model Context Protocol (MCP) with Nostr's Data Vending Machine (DVM) ecosystem. It enables AI and computational services running on MCP servers to be seamlessly discovered, accessed, and utilized via the decentralized Nostr network.

This integration combines MCP's standardized capability framework with Nostr's cryptographically secure and decentralized messaging, offering key advantages:

*   **Discoverability**: MCP servers and their capabilities can be found through the Nostr network without centralized registries.
*   **Verifiability**: Messages are cryptographically signed, ensuring authenticity and integrity.
*   **Decentralization**: No single point of failure for service discovery or communication.
*   **Protocol Interoperability**: Both MCP and DVMs leverage JSON-RPC patterns, facilitating smooth communication.

For a detailed technical specification, refer to the [DVMCP Specification (2025-03-26)](./docs/dvmcp-spec-2025-03-26.md).

## Event Kinds

The following Nostr event kinds are defined and used within the DVMCP:

| Kind  | Description                           |
| ----- | ------------------------------------- |
| 31316 | Server Announcement                   |
| 31317 | Tools List                            |
| 31318 | Resources List                        |
| 31319 | Prompts List                          |
| 25910 | Requests                              |
| 26910 | Responses                             |
| 21316 | Feedback/Notifications                |
| 1059  | Encrypted Messages (NIP-59 Gift Wrap) |

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

### Quick Start with Bunx (No Installation)

You can run the packages directly using `bunx` without installing them:

```bash
# Run the bridge
bunx dvmcp-bridge
# Run the discovery service
bunx dvmcp-discovery
```

The interactive CLI will guide you through configuration setup on first run.

### Global Installation

```bash
# Install the packages globally
bun install -g @dvmcp/bridge @dvmcp/discovery
# Run the commands
dvmcp-bridge
dvmcp-discovery
```

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