# DVMCP: Data Vending Machine Context Protocol

DVMCP is a bridge implementation that connects Model Context Protocol (MCP) servers to Nostr's Data Vending Machine (DVM) ecosystem. This bridge enables AI and computational tools exposed through MCP to be discovered and utilized via Nostr's decentralized network.

## Overview

The Model Context Protocol provides a standardized way for applications to expose AI capabilities and tools, while Nostr's Data Vending Machines offer a decentralized marketplace for computational services. This bridge brings these two worlds together, allowing:

- MCP servers to announce their capabilities on the Nostr network
- Nostr clients to discover available MCP tools
- Seamless execution of MCP tools through Nostr's DVM protocol
- Standardized payment handling

## Features

- **Service Discovery**: Automatically announces MCP services using NIP-89
- **Tool Discovery**: Exposes MCP tools through DVM kind:5600/6600 events
- **Tool Execution**: Handles tool execution requests via kind:5601/6601 events
- **Status Updates**: Provides job status and payment handling via kind:7000 events
- **Error Handling**: Comprehensive error handling and status reporting
- **Payment Flow**: Built-in support for Lightning payment processing

## Protocol Specification

For detailed information about the DVMCP, see the [specification document](docs/dvmcp-spec.md).

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.2.2 or later)
- A running MCP server
- Access to Nostr relays

### Installation

1. Clone the repository:

```bash
git clone https://github.com/gzuuus/dvmcp.git
cd dvmcp
```

2. Install dependencies:

```bash
bun install
```

3. Create your configuration:

```bash
cp .env.example .env
```

4. Edit `.env` with your settings:

### Running the Bridge

Development mode with auto-reload:

```bash
bun run dev
```

Production mode:

```bash
bun run start
```

## How It Works

The bridge operates in several stages:

1. **Initialization**:

   - Connects to the specified MCP server
   - Announces service availability on Nostr network
   - Begins listening for DVM requests

2. **Tool Discovery**:

   - Receives kind:5600 requests from clients
   - Queries available tools from MCP server
   - Responds with kind:6600 tool catalog

3. **Tool Execution**:

   - Receives kind:5601 execution requests
   - Validates parameters against tool schema
   - Executes tool via MCP server
   - Returns results via kind:6601 events
   - Provides status updates via kind:7000 events

4. **Payment Processing**:
   - Handles payment requirements through kind:7000 events
   - Supports Lightning Network payments
   - Provides execution status updates

## Contributing

Contributions are welcome! Please feel free to submit pull requests, or issues. For major changes, please open an issue first to discuss what you would like to change.

## License

[MIT License](LICENSE)

## Acknowledgments

This project builds on several excellent open-source projects:

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Nostr Protocol](https://github.com/nostr-protocol/nips)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Nostr Tools](https://github.com/nbd-wtf/nostr-tools)
