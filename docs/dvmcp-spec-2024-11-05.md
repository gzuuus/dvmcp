# DVMCP

### Data Vending Machine Context Protocol

#### MCP Integration for Data Vending Machines

`draft` `mcp:2024-11-05` `rev1`

This document defines how Data Vending Machines can expose Model Context Protocol (MCP) server capabilities through the Nostr network, enabling standardized access to computational tools for machines and humans.

## Introduction

The [Model Context Protocol](https://modelcontextprotocol.io/introduction) provides a robust framework for exposing AI capabilities and tools, while Nostr's Data Vending Machines offer a decentralized marketplace for computational services. This document defines how to bridge these protocols, allowing MCP servers to advertise and provide their services through the Nostr network.

## Motivation

While DVMs already provide a framework for computational services, and MCP offers a standardized way to expose AI capabilities, there hasn't been a standardized way to bridge these protocols. This specification aims to:

1. Enable discovery of MCP services through Nostr's decentralized network
2. Standardize how MCP tools can be exposed as DVM services
3. Provide a consistent experience for users accessing AI capabilities
4. Maintain compatibility with both protocols while preserving their security models

## Protocol Overview

There are three main actors in this workflow:
- Service providers: Entities running MCP servers that expose tools and capabilities
- DVMs: Bridge components that translate between Nostr and MCP protocols
- Customers: Nostr clients that discover and utilize the exposed capabilities

The protocol consists of tree main phases:

1. Tool Discovery: Finding available MCP-enabled, and retrieving available tools from them
2. Job Execution: Requesting tool execution and receiving results
3. Job Feedback: Handling payment and status updates

## Event Kinds

This specification defines these event kinds:

| Kind  | Description                           |
| ----- | ------------------------------------- |
| 31990 | DVM Service Announcement (via NIP-89) |
| 5910  | DVMCP Bridge Requests                 |
| 6910  | DVMCP Bridge Responses                |
| 7000  | Job Feedback                          |

Operations are differentiated using the `c` tag, which specifies the command being executed:
| Command Value         | Type     | Kind | Description                               |
| --------------------- | -------- | ---- | ----------------------------------------- |
| list-tools            | Request  | 5910 | Request available tools catalog           |
| list-tools-response   | Response | 6910 | Returns available tools and their schemas |
| execute-tool          | Request  | 5910 | Request execution of a specific tool      |
| execute-tool-response | Response | 6910 | Returns the results of tool execution     |

# Tool Discovery

DVMCP provides two methods for tool discovery:

- Discovery through NIP-89 announcements
- Direct discovery through NIP-90 requests

Clients MAY use either method or both depending on their needs. Each method has its own advantages and use cases.

## Discovery via NIP-89 Announcements

You can query relays by creating a filter for events with kind `31990`, and `t` tag `mcp`. DVMs MUST include their available tools directly in their kind:31990 announcement events. This enables immediate tool discovery and execution without requiring an additional request/response cycle. Here's an example of a complete announcement:

Example announcement:
```json
{
  "kind": 31990,
  "pubkey": "<dvm-pubkey>",
  "content": {
    "name": "MCP Tools DVM",
    "about": "AI and computational tools via MCP",
    "tools": [
      {
        "name": "summarize",
        "description": "Summarizes text input",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "description": "Text to summarize"
            }
          }
        }
      }
    ]
  },
  "tags": [
    ["d", "<dvm-announcement/random-id>"],
    ["k", "5910"],
    ["capabilities", "mcp-1.0"],
    ["t", "mcp"],
    ["t", "summarize"],
    ["t", "translate"]
  ]
}
```
### Tool Listing Content

Each tool in the `tools` array MUST include:

- `name`: The unique identifier for the tool
- `description`: A brief description of the tool's functionality
- `tools`: The tools present in the MCP server

### Required Tags

- `d`: A unique identifier for this announcement that should be maintained consistently for announcement updates
- `k`: The event kind this DVM supports (5910 for MCP bridge requests)
- `capabilities`: Must include "mcp-1.0" to indicate MCP protocol support
- `t`: Should include "mcp", and also tool names, to aid in discovery

## Discovery via Direct Request

Following NIP-90's model, clients MAY discover tools by publishing a request event and receiving responses from available DVMs. This method allows for discovery of DVMs that may not publish NIP-89 announcements.
Another way to do discovery using the previous list tools request is to query relays with a filter for events with type `5910` and `c` tag `list-tools-response`.

### List Tools Request

```json
{
  "kind": 5910,
  "content": "",
  "tags": [
    ["c", "list-tools"],
    ["output", "application/json"]
  ]
}
```

The request MAY include a `p` tag to target a specific provider:

```json
["p", "<provider-pubkey>"]
```

### List Tools Response

DVMs MUST respond with a kind 6910 event containing complete tool specifications:

```json
{
  "kind": 6910,
  "content": {
    "tools": [
      {
        "name": "<tool-name>",
        "description": "<tool-description>",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": {
              "type": "string",
              "description": "Input text to process",
              "minLength": 1,
              "maxLength": 10000
            },
            "max_tokens": {
              "type": "integer",
              "description": "Maximum tokens to generate",
              "minimum": 1,
              "maximum": 2048
            }
          },
          "required": ["text"],
          "additionalProperties": false,
          "$schema": "http://json-schema.org/draft-07/schema#"
        }
      }
    ]
  },
  "tags": [
    ["c", "list-tools-response"],
    ["e", "<tool-discovery-req-event-id>"]
  ]
}
```

### Implementation Requirements

DVMs MUST:

1. Respond to list-tools requests with complete tool specifications
2. Maintain consistency between NIP-89 listings (if published) and available tools
3. Return appropriate error status if any tool becomes unavailable

Clients MUST:

1. Obtain complete tool specifications before attempting tool execution
2. Handle cases where tools may be unavailable or specifications may have changed

DVMs that publish NIP-89 announcements SHOULD:
1. Keep announcements lightweight by omitting full schemas
2. Maintain announcement accuracy by updating when tool availability changes
3. Include all announced tools in list-tools responses

## Job Execution

Tools are executed through request/response pairs using kinds 5910/6910.

### Job Request

```json
{
  "kind": 5910,
  "content": {
    "name": "<tool-name>",
    "parameters": {
      "text": "The input text to be processed",
      "max_tokens": 1024
    }
  },
  "tags": [
    ["c", "execute-tool"],
    ["p", "<provider-pubkey>"],
    ["output", "application/json"]
  ]
}
```

The content object MUST include:

- `name`: The name of the tool to execute
- `parameters`: An object matching the tool's inputSchema

The content object MAY include:

- `timeout`: Maximum execution time in milliseconds
- `metadata`: Additional execution context

### Job Response

```json
{
  "kind": 6910,
  "content": {
    "content": [
      {
        "type": "text",
        "text": "Primary response text"
      },
      {
        "type": "text",
        "text": "Secondary response text"
      },
      {
        "type": "image/svg+xml",
        "text": "<svg>...</svg>"
      }
    ],
    "isError": false,
    "metadata": {
      "processing_time": 1.23,
      "token_count": 150
    }
  },
  "tags": [
    ["c", "execute-tool-response"],
    ["e", "<job-request-id>"],
    ["status", "success"]
  ]
}
```

## Job Feedback
Following NIP-90, DVMs use kind 7000 events to provide updates about job status and payment requirements:

```json
{
  "kind": 7000,
  "content": "",
  "tags": [
    ["status", "<status>", "<extra-info>"],
    ["amount", "<sat-amount>", "<optional-bolt11>"],
    ["e", "<job-request-id>", "<relay-hint>"],
    ["p", "<customer's-pubkey>"]
  ]
}
```

### Status Values

The `status` tag MUST use one of these values:

- `payment-required`: Payment needed before execution
- `processing`: Job is being processed
- `error`: Job failed to process
- `success`: Job completed successfully
- `partial`: Job partially completed

### Payment Flow

A typical payment flow proceeds as follows:

1. Client submits job request (kind:5910)
2. DVM responds with payment requirement (kind:7000)
3. Client pays the invoice
4. DVM indicates processing (kind:7000)
5. DVM returns results (kind:6910)

## Error Handling

DVMs MUST handle both protocol and execution errors:

### Protocol Errors

- Invalid request format
- Missing required parameters
- Parameter validation failures
- Unknown tool requests

### Execution Errors

- MCP server connection failures
- Tool execution timeouts
- Resource exhaustion
- Internal errors

For any error, DVMs MUST:

1. Send a kind:7000 event with status "error"
2. Set isError=true in the kind:6910 response
3. Include relevant error details

## Complete Protocol Flow

```mermaid
sequenceDiagram
    participant Client as Nostr Client
    participant Relay as Nostr Relay
    participant DVM as DVMCP-Bridge
    participant Server as MCP Server

    rect rgb(240, 240, 240)
        Note over Client,Server: Discovery Path A: NIP-89
        Client->>Relay: Query kind:31990 (NIP-89)
        Relay-->>Client: DVM handler info with tool listing
    end

    rect rgb(240, 240, 240)
        Note over Client,Server: Discovery Path B: Direct Request
        Client->>DVM: kind:5910, c:list-tools
        DVM->>Server: Initialize + Get Tools
        Server-->>DVM: Tool Definitions
        DVM-->>Client: kind:6910, c:list-tools-response
    end

    Note over Client,Server: Tool Execution (Same for both paths)
    Client->>DVM: kind:5910, c:execute-tool
    DVM-->>Client: kind:7000 (payment-required)
    Client->>DVM: Payment
    DVM-->>Client: kind:7000 (processing)
    DVM->>Server: Execute Tool
    Server-->>DVM: Results
    DVM-->>Client: kind:7000 (success)
    DVM-->>Client: kind:6910, c:execute-tool-response
```

## Future Extensions

Additional commands can be added to support new MCP capabilities by defining new values for the `c` tag. This allows the protocol to evolve without requiring new event kinds. Future commands might include:

- Resource operations (list-resources, read-resource, etc.)
- Prompt operations (list-prompts, execute-prompt, etc.)
- Advanced tool operations (cancel-execution, batch-execute, etc.)

All such extensions MUST maintain the request/response kind relationship defined in NIP-90 (response kind = request kind + 1000) and use kind:7000 for job feedback.
