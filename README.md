# DVMCP: Data Vending Machine Context Protocol

DVMCP is a bridge implementation that connects Model Context Protocol (MCP) servers to Nostr's Data Vending Machine (DVM) ecosystem. This bridge enables AI and computational tools exposed through MCP to be discovered and utilized via Nostr's decentralized network.

## Overview

The Model Context Protocol provides a standardized way for applications to expose AI capabilities and tools, while Nostr's Data Vending Machines offer a decentralized marketplace for computational services. This bridge brings these two worlds together, allowing:

- MCP servers to announce their capabilities on the Nostr network
- Nostr clients to discover available MCP tools
- Seamless execution of MCP tools through Nostr's DVM protocol
- Support for multiple MCP servers in a single DVM instance

## Features

- **MCP Server Pool**: Connect and manage multiple MCP servers through a single DVM
- **Service Discovery**: Automatically announces MCP services using NIP-89
- **Tool Discovery and Execution**: Exposes and executes MCP tools through DVM kind:5910/6910 events
- **Status Updates**: Provides job status and payment handling via kind:7000 events
- **Error Handling**: Comprehensive error handling and status reporting

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.2.2 or later)
- One or more MCP servers
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
cp config.example.yml config.yml
```

4. Edit `config.yml` with your settings:

```yaml
nostr:
  privateKey: 'your_private_key_here'
  relayUrls:
    - 'wss://relay1.com'
    - 'wss://relay2.net'

mcp:
  name: 'DVM MCP Bridge'
  about: 'MCP-enabled DVM providing AI and computational tools'
  servers:
    - name: 'server1'
      command: 'node'
      args: ['run', 'src/external-mcp-server1.ts']
    - name: 'server2'
      command: 'python'
      args: ['src/external-mcp-server2.py']
```

You can find all the configurations in the `config.example.yml` file

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

2. **Tool Operations**:

   - Receives kind:5910 requests from clients for tool listing or execution
   - Processes requests based on the 'c' tag command
   - Responds with kind:6910 events containing tool catalog or execution results
   - Provides status updates via kind:7000 events

3. **Payment Processing**:
   - Handles payment requirements through kind:7000 events
   - Supports Lightning Network payments
   - Provides execution status updates

## Example Commands

List available tools:

```bash
nak event -k 5910 -c '' --tag 'c=list-tools' --tag 'output=application/json' wss://relay.com
```

Execute a tool:

```bash
nak event -k 5910 -c '{"name":"extract","parameters":{"url":"https://nostr.how"}}' --tag 'c=execute-tool' wss://relay.com
```

Monitor results:

```bash
nak req --stream -k 6910 -k 7000 -s "$(date +%s)" wss://relay.com | jq --stream "fromstream(0|truncate_stream(inputs))"
```

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
