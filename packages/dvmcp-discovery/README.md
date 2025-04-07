# DVMCP Discovery

A MCP server implementation that aggregates tools from DVMs across the Nostr network and makes them available through a single interface.

## Features

- Discovers MCP tools from DVMs across the Nostr network
- Provides a unified interface to access tools from multiple DVMs
- Tool execution handling and status tracking
- Automatic payment for paid tools using Nostr Wallet Connect (NWC)
- Configurable DVM whitelist
- Direct connection to specific providers or servers

## Configuration

DVMCP Discovery supports multiple configuration methods with a clear priority order: default < file < environment variables < CLI arguments.

### Configuration File

When the package is run for the first time, it will use sensible defaults. You can create a configuration file by copying `config.example.yml` and modifying it:

```bash
cp config.example.yml config.dvmcp.yml
nano config.dvmcp.yml
```

You can also run the configuration wizard to create a configuration file interactively:

```bash
npx dvmcp-discovery --configure
```

To specify a custom configuration file path:

```bash
npx dvmcp-discovery --config-path /path/to/custom/config.dvmcp.yml
```

### CLI Arguments

You can add configuration settings using command-line arguments:

```bash
# Set Nostr relay URLs
npx dvmcp-discovery -r wss://relay1.com,wss://relay2.com
# or
npx dvmcp-discovery --nostr-relay-urls wss://relay1.com,wss://relay2.com

# Set Nostr private key
npx dvmcp-discovery --nostr-private-key <hex-private-key>

# Set MCP service details
npx dvmcp-discovery --mcp-name "My DVMCP Service" --mcp-version "1.2.0"

# Limit the number of DVMs to discover
npx dvmcp-discovery --discovery-limit 5

# Enable verbose output
npx dvmcp-discovery -v
# or
npx dvmcp-discovery --verbose
```

### Environment Variables

You can also configure the service using environment variables:

```bash
# Set Nostr configuration
export DVMCP_NOSTR_PRIVATE_KEY=<hex-private-key>
export DVMCP_NOSTR_RELAY_URLS=wss://relay1.com,wss://relay2.com

# Set MCP service details
export DVMCP_MCP_NAME="My DVMCP Service"
export DVMCP_MCP_VERSION="1.2.0"
export DVMCP_MCP_ABOUT="Custom description"

# Set NWC configuration
export DVMCP_NWC_CONNECTION_STRING="nostr+walletconnect:..."

# Limit the number of DVMs to discover
export DVMCP_DISCOVERY_LIMIT=5

# Run the service
npx dvmcp-discovery
```

### NWC Payment Configuration

To enable automatic payment for tools that require payment, add the NWC (Nostr Wallet Connect) configuration to your `config.dvmcp.yml` file:

```yaml
nwc:
  # Your NWC connection string
  # Format: nostr+walletconnect:<pubkey>?relay=<relay_url>&secret=<secret>
  connectionString: 'nostr+walletconnect:your_wallet_pubkey_here?relay=wss%3A%2F%2Frelay.example.com&secret=your_secret_here'
```

You can obtain an NWC connection string from compatible wallets like Alby or Coinos. When a tool requires payment, the discovery server will automatically pay the invoice using the configured NWC wallet.

## Usage

**Prerequisite:** Ensure you have [Bun](https://bun.sh/) installed.

You can run this package directly using `npx`:

```bash
npx @dvmcp/discovery
```

Alternatively, for development:

```bash
bun run dev
```

For production:

```bash
bun run start
```

### Direct Connection Options

You can connect directly to a specific provider or server without a configuration file:

#### Connect to a Provider

Use the `--provider` flag followed by an nprofile entity to discover and register all tools from a specific provider:

```bash
bun run start --provider nprofile1...
```

#### Connect to a Server

Use the `--server` flag followed by an naddr entity to register only the tools from a specific server:

```bash
bun run start --server naddr1...
```

This is useful when you want to work with a specific subset of tools rather than discovering all tools from a provider.

## Debug

You can enable debug mode by setting the `DEBUG` environment variable to `*`:

```bash
DEBUG=* npx @dvmcp/discovery
```

## Testing

Run the test suite:

```bash
bun test
```
