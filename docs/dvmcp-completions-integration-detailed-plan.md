# DVMCP Completions Feature - Detailed Integration Plan

This document outlines the detailed plan for integrating the "completions" capability into the `dvmcp-discovery` and `dvmcp-bridge` packages.

## I. `dvmcp-commons`

*   **Objective**: Ensure all necessary types from the DVMCP specification regarding completions are available.
*   **Action**:
    1.  **(CONFIRMED)** The `@modelcontextprotocol/sdk` is fully compatible and includes `ServerCapabilities`, `CompleteRequestSchema`, `CompleteResult`, `PromptReference`, `ResourceReference`, etc. No SDK update or custom type definition is immediately needed.

## II. `dvmcp-discovery` Package Modifications

*   **Objective**: Enable `dvmcp-discovery` to recognize the `completions` capability of servers and provide a mechanism for clients to request completions.
*   **Files to Modify/Create**:
    *   [`packages/dvmcp-discovery/src/server-registry.ts`](packages/dvmcp-discovery/src/server-registry.ts) (and related types in [`base-interfaces.ts`](packages/dvmcp-discovery/src/base-interfaces.ts))
    *   New: `packages/dvmcp-discovery/src/completion-executor.ts`
    *   [`packages/dvmcp-discovery/src/discovery-server.ts`](packages/dvmcp-discovery/src/discovery-server.ts) (or equivalent entry point, to instantiate and expose the executor)
    *   [`packages/dvmcp-discovery/src/prompt-registry.ts`](packages/dvmcp-discovery/src/prompt-registry.ts) & [`packages/dvmcp-discovery/src/resource-registry.ts`](packages/dvmcp-discovery/src/resource-registry.ts) (to ensure they store `providerPubkey` and `serverId`).

*   **Plan**:
    1.  **Update Capability Definitions**:
        *   In [`packages/dvmcp-discovery/src/base-interfaces.ts`](packages/dvmcp-discovery/src/base-interfaces.ts), ensure the interface for server capabilities includes an optional `completions: Record<string, never> | boolean;` field.
        *   Modify [`packages/dvmcp-discovery/src/server-registry.ts`](packages/dvmcp-discovery/src/server-registry.ts) to store and expose this `completions` capability.

    2.  **Create `CompletionExecutor`**:
        *   Create `packages/dvmcp-discovery/src/completion-executor.ts`.
        *   Extends `BaseExecutor<Capability, CompleteRequest['params'], CompleteResult>`.
        *   **Constructor**: Takes `RelayHandler`, `KeyManager`, `PromptRegistry`, `ResourceRegistry`.
        *   **`getCompletions(params: CompleteRequest['params']): Promise<CompleteResult>` (Public Method)**:
            *   Extracts `ref`, looks up item in `PromptRegistry` or `ResourceRegistry` for `providerPubkey` and `serverId`.
            *   Calls inherited `execute()`.
        *   **`createRequest(id: string, targetServerInfo: {providerPubkey, serverId}, params: CompleteRequest['params']): NostrEvent` (Protected Method)**:
            *   Creates Nostr event (Kind `25910`), `content: JSON.stringify({ method: "completion/complete", params: params })`, adds tags (`p`, `s`, `method`).
        *   **`handleResponse(event: NostrEvent, context: ExecutionContext, resolve, reject): Promise<void>` (Protected Method)**:
            *   Parses `event.content` into `CompleteResult`, handles errors, resolves/rejects.

    3.  **Integrate `CompletionExecutor`**:
        *   In [`packages/dvmcp-discovery/src/discovery-server.ts`](packages/dvmcp-discovery/src/discovery-server.ts), instantiate and expose `CompletionExecutor`.

## III. `dvmcp-bridge` Package Modifications

*   **Objective**: Enable `dvmcp-bridge` to announce `completions` capability, handle incoming DVMCP `completion/complete` requests, route them via `MCPPool`, and return responses.
*   **Files to Modify/Create**:
    *   [`packages/dvmcp-bridge/src/dvm-bridge.ts`](packages/dvmcp-bridge/src/dvm-bridge.ts)
    *   New: `packages/dvmcp-bridge/src/handlers/completion-handlers.ts`
    *   [`packages/dvmcp-bridge/src/mcp-pool.ts`](packages/dvmcp-bridge/src/mcp-pool.ts)
    *   [`packages/dvmcp-bridge/src/mcp-client.ts`](packages/dvmcp-bridge/src/mcp-client.ts)
    *   [`packages/dvmcp-bridge/src/announcer.ts`](packages/dvmcp-bridge/src/announcer.ts)

*   **Plan**:
    1.  **Update `MCPClientHandler` ([`mcp-client.ts`](packages/dvmcp-bridge/src/mcp-client.ts))**:
        *   Add `async complete(params: CompleteRequest['params']): Promise<CompleteResult | undefined>`. Checks local server capability for completions, then calls `this.client.request('completion/complete', params)`.
    2.  **Update `MCPPool` ([`mcp-pool.ts`](packages/dvmcp-bridge/src/mcp-pool.ts))**:
        *   Add `async complete(params: CompleteRequest['params']): Promise<CompleteResult | undefined>`. Finds correct `MCPClientHandler` based on `params.ref` (from `promptRegistry` or `resourceRegistry`) and calls its `complete` method.
    3.  **Create `completion-handlers.ts`**:
        *   Add `export async function handleCompletionComplete(...)`. Parses Nostr event, calls `mcpPool.complete()`, formats/sends Nostr response.
    4.  **Update `DVMBridge` ([`dvm-bridge.ts`](packages/dvmcp-bridge/src/dvm-bridge.ts))**:
        *   Import and use `handleCompletionComplete` in `handleRequest` for `"completion/complete"` method.
    5.  **Update `NostrAnnouncer` ([`announcer.ts`](packages/dvmcp-bridge/src/announcer.ts))**:
        *   Add `completions: {}` to announced capabilities if any underlying MCP servers support it.

## IV. Testing Strategy

1.  **Unit Tests**:
    *   `CompletionExecutor`: Test `createRequest` formatting, `handleResponse` parsing, registry interaction.
    *   `handleCompletionComplete` (dvmcp-bridge): Test request parsing, error handling, response formatting, `MCPPool` interaction.
    *   `MCPPool.complete`: Test routing to `MCPClientHandler`.
    *   `MCPClientHandler.complete`: Test interaction with mock MCP client SDK.
2.  **Integration Tests**:
    *   `dvmcp-discovery` <-> Mock DVM (Nostr level).
    *   `dvmcp-bridge` <-> Mock MCP Server.
    *   End-to-End: `dvmcp-discovery` -> Nostr -> `dvmcp-bridge` -> Mock MCP Server -> back.

## V. Documentation

*   Update `README.md` for `dvmcp-discovery` and `dvmcp-bridge`.
*   Add JSDoc/TSDoc for new public members.
*   Review/update architectural documents if implementation details diverge/clarify spec.

## VI. Message Flow Diagram

```mermaid
sequenceDiagram
    participant ClientApp as Client App (using dvmcp-discovery)
    participant DiscoveryCompletionExec as dvmcp-discovery.CompletionExecutor
    participant DiscoveryPromptRegistry as dvmcp-discovery.PromptRegistry
    participant NostrRelay as Nostr Relay
    participant BridgeMain as dvmcp-bridge.DVMBridge
    participant BridgeCompletionHandler as dvmcp-bridge.handleCompletionComplete
    participant BridgeMCPPool as dvmcp-bridge.MCPPool
    participant BridgeMCPClient as dvmcp-bridge.MCPClientHandler (for target server)
    participant UnderlyingMCPServer as Actual MCP Server

    ClientApp->>+DiscoveryCompletionExec: getCompletions({ref: {type:"prompt", name:"P1"}, arg:{...}})
    DiscoveryCompletionExec->>+DiscoveryPromptRegistry: getPromptInfo("P1")
    DiscoveryPromptRegistry-->>-DiscoveryCompletionExec: {providerPubkey, serverId} (for BridgeMain)
    DiscoveryCompletionExec->>+NostrRelay: Publish Kind 25910 (To: BridgeMain, method: "completion/complete", params: {ref, arg})
    NostrRelay-->>-BridgeMain: Deliver Kind 25910
    BridgeMain->>+BridgeCompletionHandler: handleRequest(event)
    BridgeCompletionHandler->>+BridgeMCPPool: complete({ref, arg})
    BridgeMCPPool->>+DiscoveryPromptRegistry: (Internal) findHandlerForPrompt("P1")
    DiscoveryPromptRegistry-->>-BridgeMCPPool: (Returns BridgeMCPClient instance)
    BridgeMCPPool->>+BridgeMCPClient: complete({ref, arg})
    BridgeMCPClient->>+UnderlyingMCPServer: JSON-RPC: {method:"completion/complete", params:{ref, arg}}
    UnderlyingMCPServer-->>-BridgeMCPClient: JSON-RPC Response: {completion:{values:[...]}}
    BridgeMCPClient-->>-BridgeMCPPool: {completion:{values:[...]}}
    BridgeMCPPool-->>-BridgeCompletionHandler: {completion:{values:[...]}}
    BridgeCompletionHandler->>+NostrRelay: Publish Kind 26910 (To: DiscoveryCompletionExec, content:{completion})
    NostrRelay-->>-DiscoveryCompletionExec: Deliver Kind 26910
    DiscoveryCompletionExec-->>-ClientApp: {completion:{values:[...]}}