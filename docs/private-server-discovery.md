# Private Server Discovery

This document explains how to use the private server discovery feature in DVMCP, which allows discovery clients to connect directly to private MCP servers without requiring public announcements.

## Overview

Private server discovery enables direct connections between DVMCP discovery clients and MCP servers that choose not to publicly announce their capabilities.

## How It Works

Private server discovery follows a four-phase handshake protocol:

1. **Initialize Request**: Discovery client sends an initialization request directly to the private server
2. **Initialize Response**: Private server responds with a summary of its capabilities (tools, resources, prompts)
3. **Capabilities Listing**: Discovery client requests the detailed lists using the standard `<capability>/list` RPC methods (`tools/list`, `resources/list`, `prompts/list`, you can find all available methods in the commons package core `constants.ts`) and receives the corresponding responses
4. **Initialized Notification**: Discovery client confirms successful registration _after_ it has fetched all capability lists

This handshake follows the MCP initialization protocol but is transported over Nostr events rather than standard MCP transport.

## Event Structure

### Initialize Request (Kind 25910)

```json
{
  "kind": 25910,
  "content": "{\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{\"roots\":{\"listChanged\":true},\"sampling\":{}},\"clientInfo\":{\"name\":\"DVMCP Discovery\",\"version\":\"1.0.0\"}}}",
  "tags": [
    ["p", "<provider_pubkey>"],
    ["method", "initialize"],
    ["s", "<server_id>"] // Optional: only if targeting specific server
  ]
}
```

### Initialize Response (Kind 26910)

```json
{
  "kind": 26910,
  "content": "{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{\"tools\":{},\"resources\":{},\"prompts\":{}},\"serverInfo\":{\"name\":\"My Private Server\",\"version\":\"1.0.0\"}}",
  "tags": [
    ["p", "<discovery_client_pubkey>"],
    ["u", "<unique_server_identifier>"],
    ["e", "<original_request_event_id>"],
    ["support_encryption", "true"] // Optional: indicates encryption support
  ]
}
```

### Capability List Request (`<capability>/list`, Kind 25910)

```json
{
  "kind": 25910,
  "content": "{\"method\":\"tools/list\"}",
  "tags": [
    ["p", "<provider_pubkey>"],
    ["method", "tools/list"],
    ["s", "<server_id>"]
  ]
}
```

### Capability List Response (`<capability>/list`, Kind 26910)

```json
{
  "kind": 26910,
  "content": "{\"result\":{\"tools\":{\"myTool\":{\"title\":\"My Tool\"}}}}",
  "tags": [["e", "<original_request_event_id>"]]
}
```

### Initialized Notification (Kind 21316)

```json
{
  "kind": 21316,
  "content": "{\"method\":\"notifications/initialized\"}",
  "tags": [
    ["p", "<provider_pubkey>"],
    ["s", "<server_id>"],
    ["method", "notifications/initialized"]
  ]
}
```

## Security Considerations

### Encryption

- Both packages support encryption through configuration, handshake and initialization during private server discovery should be aware of it to preform the handshake and initialization.
- Private servers can indicate encryption support via the `support_encryption` tag

## Related Documentation

- [DVMCP Protocol Specification](./dvmcp-spec-2025-03-26.md)
- [Encryption Guide](./encryption.md)
