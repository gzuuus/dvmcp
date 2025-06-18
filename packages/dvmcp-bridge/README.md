# DVMCP Bridge

A bridge implementation that connects Model Context Protocol (MCP) servers to Nostr's Data Vending Machine (DVM) ecosystem.

## Features

- Connect and manage multiple MCP servers through a single DVM instance
- Automatic service announcement using NIP-89
- Tool discovery and execution through DVM kind:5910/6910 events
- Job status updates and payment handling via kind:7000 events
- Service announcement deletion using NIP-09
- Encrypted communication support using NIP-17/NIP-59
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

// TODO: Improve docs, add env variables

### Command-Line Arguments

You can also configure the bridge using command-line arguments, which have the highest priority:

// TODO: Add command line arguments

Shorthand flags are available for some options:

...

### Viewing Configuration

Use the `--verbose` or `-v` flag to display the current configuration:

```bash
npx @dvmcp/bridge --verbose
```

## Encryption Support

The DVMCP Bridge supports a flexible encryption system to secure communication. It offers three distinct modes:

- **DISABLED**: No encryption is used for communication.
- **OPTIONAL**: (Default) Encrypted and unencrypted messages are accepted, and responses mirror the format of the incoming message. This provides maximum compatibility.
- **REQUIRED**: Only encrypted communication is accepted and generated, ensuring high security.

For a detailed explanation of the available encryption modes and their behavior, including configuration examples, please refer to the [DVMCP Encryption Configuration Guide](../dvmcp-commons/src/encryption/README.md).

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
