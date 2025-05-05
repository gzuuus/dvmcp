# Detailed Refactoring Plan: dvmcp-commons & dvmcp-bridge (Spec 2025-03-26)

## Overall Goal

Refactor `dvmcp-commons` and `dvmcp-bridge` to align with the DVMCP Specification `2025-03-26`, focusing on Public Discovery mechanisms and standardized interactions using `@modelcontextprotocol/sdk`.

---

## Package: `packages/dvmcp-commons`

**Goal:** Update shared constants and types to align with DVMCP Specification `2025-03-26`.

**Tasks:**

1.  **Update `packages/dvmcp-commons/constants.ts`**
    *   **Action:** Modify file content.
    *   **Details:**
        *   Remove deprecated kind constants:
            ```typescript
            // Remove these lines:
            // export const DVM_ANNOUNCEMENT_KIND = 31990;
            // export const DVM_NOTICE_KIND = 7000;
            // export const TOOL_REQUEST_KIND = 5910;
            // export const TOOL_RESPONSE_KIND = 6910;
            ```
        *   Add new DVMCP Event Kind constants (Spec lines 118-126):
            ```typescript
            export const SERVER_ANNOUNCEMENT_KIND = 31316; // Addressable: Server Announcement
            export const TOOLS_LIST_KIND = 31317;         // Addressable: Tools List
            export const RESOURCES_LIST_KIND = 31318;     // Addressable: Resources List
            export const PROMPTS_LIST_KIND = 31319;       // Addressable: Prompts List
            export const REQUEST_KIND = 25910;            // Ephemeral: Client Requests
            export const RESPONSE_KIND = 26910;           // Ephemeral: Server Responses
            export const NOTIFICATION_KIND = 21316;       // Ephemeral: Feedback/Notifications
            ```
        *   Add common DVMCP Tag constants (Spec lines 80-87, etc.):
            ```typescript
            // Common Tags for DVMCP Events
            export const TAG_UNIQUE_IDENTIFIER = 'd';    // Unique identifier (addressable events) or Server ID (init response)
            export const TAG_SERVER_IDENTIFIER = 's';    // Target Server identifier (requests, list announcements)
            export const TAG_PUBKEY = 'p';               // Target Public key (requests, notifications)
            export const TAG_EVENT_ID = 'e';             // Related Event ID (responses, some notifications)
            export const TAG_METHOD = 'method';          // MCP method/notification type
            export const TAG_CAPABILITY = 'cap';         // Capability name (list announcements)
            export const TAG_KIND = 'k';                 // Accepted request kind (server announcement)
            export const TAG_STATUS = 'status';          // Nostr-specific notification status (e.g., 'payment-required')
            export const TAG_AMOUNT = 'amount';          // Nostr-specific notification amount/invoice
            ```

2.  **Create `packages/dvmcp-commons/src/types-dvmcp-nostr.ts`**
    *   **Action:** Create a new file with the specified content.
    *   **Content:**
        ```typescript
        // packages/dvmcp-commons/src/types-dvmcp-nostr.ts
        import type { Event as NostrEvent, Tag } from 'nostr-tools';
        // Import relevant MCP types from the SDK for content field hints
        import type { InitializeResult, ListToolsResult, ListResourcesResult, ListPromptsResult, /* ... other SDK types */ } from '@modelcontextprotocol/sdk/types.js';
        import {
          SERVER_ANNOUNCEMENT_KIND,
          TOOLS_LIST_KIND,
          RESOURCES_LIST_KIND,
          PROMPTS_LIST_KIND,
          REQUEST_KIND,
          RESPONSE_KIND,
          NOTIFICATION_KIND,
          TAG_UNIQUE_IDENTIFIER,
          TAG_KIND,
          TAG_SERVER_IDENTIFIER,
          TAG_CAPABILITY,
          TAG_EVENT_ID,
          TAG_PUBKEY,
          TAG_METHOD,
          TAG_STATUS,
          TAG_AMOUNT,
        } from '../constants'; // Adjust path if needed

        /**
         * Base interface for DVMCP Nostr events.
         * The 'content' field holds a stringified JSON-RPC message conforming to MCP specs.
         * Use types from '@modelcontextprotocol/sdk/types.js' to structure/parse the 'content'.
         */
        // --- Announcement Events (Addressable, kinds 31316-31319) ---

        export interface DvmcpServerAnnouncementEvent extends NostrEvent {
          kind: typeof SERVER_ANNOUNCEMENT_KIND;
          tags: (
            | [typeof TAG_UNIQUE_IDENTIFIER, string] // Server's unique ID
            | [typeof TAG_KIND, `${typeof REQUEST_KIND}`] // Accepted request kind
            // Optional NIP-89 tags: ['name', string], ['about', string], ['picture', string], ['website', string] etc.
            | Tag // Allow other standard tags like NIP-89
          )[];
          /** content: string; // Stringified InitializeResult-like object from SDK */
        }

        export interface DvmcpToolsListEvent extends NostrEvent {
          kind: typeof TOOLS_LIST_KIND;
          tags: (
            | [typeof TAG_UNIQUE_IDENTIFIER, string] // Unique ID for this list event
            | [typeof TAG_SERVER_IDENTIFIER, string] // Server ID ('d' tag from announcement)
            | [typeof TAG_CAPABILITY, string] // Tool name
          )[];
           /** content: string; // Stringified ListToolsResult from SDK */
        }

        export interface DvmcpResourcesListEvent extends NostrEvent {
          kind: typeof RESOURCES_LIST_KIND;
          tags: (
            | [typeof TAG_UNIQUE_IDENTIFIER, string] // Unique ID for this list event
            | [typeof TAG_SERVER_IDENTIFIER, string] // Server ID ('d' tag from announcement)
            | [typeof TAG_CAPABILITY, string] // Optional: Resource name/URI path
          )[];
           /** content: string; // Stringified ListResourcesResult from SDK */
        }

        export interface DvmcpPromptsListEvent extends NostrEvent {
          kind: typeof PROMPTS_LIST_KIND;
          tags: (
            | [typeof TAG_UNIQUE_IDENTIFIER, string] // Unique ID for this list event
            | [typeof TAG_SERVER_IDENTIFIER, string] // Server ID ('d' tag from announcement)
            | [typeof TAG_CAPABILITY, string] // Optional: Prompt name
          )[];
           /** content: string; // Stringified ListPromptsResult from SDK */
        }

        // --- Interaction Events (Ephemeral, kinds 25910, 26910, 21316) ---

        export interface DvmcpRequestEvent extends NostrEvent {
          kind: typeof REQUEST_KIND;
          id: string; // Request event ID used for response correlation via 'e' tag
          tags: (
            | [typeof TAG_PUBKEY, string] // Target Provider pubkey
            | [typeof TAG_SERVER_IDENTIFIER, string] // Target Server ID ('d' tag from announcement/init response)
            | [typeof TAG_METHOD, string] // MCP method (e.g., "tools/call", "initialize")
          )[];
          /** content: string; // Stringified JSON-RPC Request (params depend on method, use SDK types) */
        }

        export interface DvmcpResponseEvent extends NostrEvent {
          kind: typeof RESPONSE_KIND;
          tags: (
            | [typeof TAG_EVENT_ID, string] // ID of the DvmcpRequestEvent
            | [typeof TAG_PUBKEY, string] // Target Client pubkey
            // | [typeof TAG_UNIQUE_IDENTIFIER, string] // Optional: Server's unique 'd' tag if needed
          )[];
          /** content: string; // Stringified JSON-RPC Response (result or error, use SDK types) */
        }

        /** MCP-compliant notification (e.g., progress, list_changed) */
        export interface DvmcpMcpNotificationEvent extends NostrEvent {
          kind: typeof NOTIFICATION_KIND;
          tags: (
            | [typeof TAG_PUBKEY, string] // Target pubkey (recipient)
            | [typeof TAG_METHOD, `notifications/${string}`] // Notification type
            | [typeof TAG_SERVER_IDENTIFIER, string?] // Optional: Originating/Target Server ID
            | [typeof TAG_EVENT_ID, string?] // Optional: Related request ID (e.g., for progress/cancel)
          )[];
          /** content: string; // Stringified JSON-RPC Notification (use SDK types) */
        }

        /** Nostr-specific notification (e.g., payment required) */
        export interface DvmcpNostrNotificationEvent extends NostrEvent {
            kind: typeof NOTIFICATION_KIND;
            tags: (
                | [typeof TAG_STATUS, 'payment-required']
                | [typeof TAG_AMOUNT, string, string?] // Sats, optional Bolt11 invoice
                | [typeof TAG_EVENT_ID, string] // Related job request ID
                | [typeof TAG_PUBKEY, string] // Target Client pubkey
            )[];
            content: ''; // Content MUST be empty
        }

        export type DvmcpNotificationEvent = DvmcpMcpNotificationEvent | DvmcpNostrNotificationEvent;
        ```

3.  **Review `packages/dvmcp-commons/nostr/relay-handler.ts`**
    *   **Action:** Modify file content.
    *   **Details:**
        *   Update import statements to use new constants if old ones were used directly.
        *   Review the `subscribeToRequests` method. Ensure it correctly applies the `Filter[]` provided by the caller. Consider making the default filter less specific or removing it, as the bridge/discovery packages will define precise filters.

---

## Package: `packages/dvmcp-bridge`

**Goal:** Implement public capability announcements (`31316-31319`), handle standard DVMCP requests/responses/notifications (`25910`/`26910`/`21316`), and leverage SDK types.

**Tasks:**

1.  **Dependencies:**
    *   **Action:** Update `package.json` and import statements across relevant files (`*.ts` in `src/`).
    *   **Details:** Ensure `@dvmcp/commons` version reflects changes. Import new constants and types from commons. Import necessary types from `@modelcontextprotocol/sdk/types.js` for MCP payloads.

2.  **Announcements (`src/announcer.ts`):**
    *   **Action:** Modify file content.
    *   **Details:**
        *   Update constant imports.
        *   Remove `announceRelayList`.
        *   Refactor `announceService` (rename to e.g., `announceCapabilities`):
            *   Publish Kind 31316 (Server):
                *   `content`: Stringified JSON object based on MCP `InitializeResult` (or relevant parts: `protocolVersion`, `capabilities`, `serverInfo`, using SDK types). `protocolVersion` = "2025-03-26".
                *   **Server Identifier Generation:** Calculate the SHA256 hash of the **stringified `content`** defined above. This hash will be the unique `serverId`. (A utility function for SHA256 hashing might be needed, potentially in `dvmcp-commons`).
                *   `tags`: Include `[TAG_UNIQUE_IDENTIFIER, serverId]` (using the generated hash), `[TAG_KIND, \`${REQUEST_KIND}\`]`, and potentially NIP-89 tags (`name`, `about`, `picture`, etc.) from `CONFIG.mcp`.
            *   Publish Kind 31317 (Tools):
                *   Get tools via `mcpPool.listTools()`.
                *   `content`: Stringified `ListToolsResult` using SDK types.
                *   `tags`: `[TAG_UNIQUE_IDENTIFIER, uniqueListId]`, `[TAG_SERVER_IDENTIFIER, serverId]` (using the *same hash* generated for Kind 31316), multiple `[TAG_CAPABILITY, toolName]` tags.
            *   Publish Kind 31318 (Resources - if applicable):
                *   Implement `listResources` in pool/client.
                *   `content`: Stringified `ListResourcesResult` using SDK types.
                *   `tags`: `[TAG_UNIQUE_IDENTIFIER, uniqueListId]`, `[TAG_SERVER_IDENTIFIER, serverId]` (using the Kind 31316 hash), optional `[TAG_CAPABILITY, resourceName]` tags.
            *   Publish Kind 31319 (Prompts - if applicable):
                *   Implement `listPrompts` in pool/client.
                *   `content`: Stringified `ListPromptsResult` using SDK types.
                *   `tags`: `[TAG_UNIQUE_IDENTIFIER, uniqueListId]`, `[TAG_SERVER_IDENTIFIER, serverId]` (using the Kind 31316 hash), optional `[TAG_CAPABILITY, promptName]` tags.
        *   Remove old tool tag generation with pricing.
        *   Update `updateAnnouncement`.
        *   Update `deleteAnnouncement`: Target `SERVER_ANNOUNCEMENT_KIND` in filter and the correct `[TAG_UNIQUE_IDENTIFIER, serverId]` tag.

3.  **Request/Response/Notification Handling (`src/dvm-bridge.ts`):**
    *   **Action:** Modify file content significantly.
    *   **Details:**
        *   Update constant imports.
        *   Modify `start`: Update `relayHandler.subscribeToRequests` filter for `REQUEST_KIND` (#p) and `NOTIFICATION_KIND`.
        *   Modify `handleRequest`:
            *   Route based on `kind` and `method` tag (extracted from event tags, not `c` tag).
            *   Handle `NOTIFICATION_KIND` (check `method` tag for `notifications/cancel`).
            *   Handle `REQUEST_KIND`: Extract the target `serverId` from the `s` tag. Ensure requests are routed to the correct bridge instance if multiple bridges share a pubkey (though unlikely in this setup). Route based on `method` tag.
            *   Implement handlers for `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`.
            *   Parse params from `content` (stringified JSON-RPC, use SDK types). Validate against SDK schemas.
            *   Format responses (kind 26910, `content` with `result`/`error` using SDK types, `e` tag referencing request ID, `p` tag targeting client pubkey). Handle pagination (`cursor`/`nextCursor`).
            *   Handle errors (Protocol vs. Execution).
            *   Update Payment Flow: Send `payment-required` notification (kind 21316, empty `content`, tags). Await verification.
            *   Send MCP Progress/Status Notifications (kind 21316, JSON-RPC `content`, `method` tag).

4.  **Payment Handling (`src/payment-handler.ts`):**
    *   **Action:** Review/Modify file content.
    *   **Details:**
        *   Consider consolidating `RelayHandler` usage.
        *   Ensure `generateZapRequest` provides data for the tag-based notification.
        *   `verifyZapPayment` logic (kind 9735 check) seems okay.

5.  **MCP Interaction (`src/mcp-pool.ts`, `src/mcp-client.ts`):**
    *   **Action:** Modify file contents.
    *   **Details:**
        *   `mcp-client.ts`: Add methods (`listResources`, `readResource`, `listPrompts`, `getPrompt`) delegating to SDK client.
        *   `mcp-pool.ts`: Add corresponding aggregation/delegation methods.

6.  **Local Constants/Types (`src/constants.ts`, `src/types.ts`):**
    *   **Action:** Modify/Review files.
    *   **Details:** Remove definitions now in commons. Update internal types referencing commons or SDK types.

---

## Refactoring Flow

```mermaid
graph TD
    subgraph "Refactor dvmcp-commons"
        direction LR
        C1[Update constants.ts]
        C2[Create types-dvmcp-nostr.ts]
        C3[Review relay-handler.ts scope/deps]
    end

    subgraph "Refactor dvmcp-bridge"
        direction LR
        B_Deps[Update Dependencies (Commons, SDK)]
        B_Announce[Refactor announcer.ts (Kinds 31316-31319)]
        B_MCPPool[Extend mcp-pool.ts (Resources, Prompts)]
        B_MCPClient[Extend mcp-client.ts (Resources, Prompts)]
        B_BridgeCore[Refactor dvm-bridge.ts (Request Routing, Responses, Notifications - Kinds 25910, 26910, 21316)]
        B_Payment[Update payment-handler.ts (Notification format)]
        B_Types[Update Local Types/Constants]
    end

    C1 --> B_Deps
    C2 --> B_Deps
    C3 --> B_Deps

    B_Deps --> B_Announce
    B_Deps --> B_MCPPool
    B_Deps --> B_MCPClient
    B_Deps --> B_BridgeCore
    B_Deps --> B_Payment
    B_Deps --> B_Types

    B_MCPClient --> B_MCPPool
    B_MCPPool --> B_Announce
    B_MCPPool --> B_BridgeCore
    B_Payment --> B_BridgeCore
    B_Announce --> B_BridgeCore