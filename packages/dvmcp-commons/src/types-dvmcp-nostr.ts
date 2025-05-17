import type { Event as NostrEvent } from 'nostr-tools';
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
} from '../constants';

/**
 * Tags that can appear multiple times per event
 */
export type MultipleTag =
  | [typeof TAG_KIND, string] // 'k' - Kind
  | [typeof TAG_CAPABILITY, string] // 'cap' - Capability name
  | string[]; // Any other custom tag format

export interface DvmcpServerAnnouncementEvent extends NostrEvent {
  kind: typeof SERVER_ANNOUNCEMENT_KIND;
  tags: (
    | [typeof TAG_UNIQUE_IDENTIFIER, string] // 'd' - Server's unique ID (required)
    | [typeof TAG_KIND, string] // 'k' - Accepted request kind (required)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified InitializeResult-like object from SDK */
}

export interface DvmcpToolsListEvent extends NostrEvent {
  kind: typeof TOOLS_LIST_KIND;
  tags: (
    | [typeof TAG_UNIQUE_IDENTIFIER, string] // 'd' - Unique ID for this list event (required)
    | [typeof TAG_SERVER_IDENTIFIER, string] // 's' - Server ID (required)
    | [typeof TAG_CAPABILITY, string] // 'cap' - Tool name (can appear multiple times)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified ListToolsResult from SDK */
}

export interface DvmcpResourcesListEvent extends NostrEvent {
  kind: typeof RESOURCES_LIST_KIND;
  tags: (
    | [typeof TAG_UNIQUE_IDENTIFIER, string] // 'd' - Unique ID for this list event (required)
    | [typeof TAG_SERVER_IDENTIFIER, string] // 's' - Server ID (required)
    | [typeof TAG_CAPABILITY, string] // 'cap' - Resource name (can appear multiple times)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified ListResourcesResult from SDK */
}

export interface DvmcpPromptsListEvent extends NostrEvent {
  kind: typeof PROMPTS_LIST_KIND;
  tags: (
    | [typeof TAG_UNIQUE_IDENTIFIER, string] // 'd' - Unique ID for this list event (required)
    | [typeof TAG_SERVER_IDENTIFIER, string] // 's' - Server ID (required)
    | [typeof TAG_CAPABILITY, string] // 'cap' - Prompt name (can appear multiple times)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified ListPromptsResult from SDK */
}

// --- Interaction Events (Ephemeral, kinds 25910, 26910, 21316) ---

export interface DvmcpRequestEvent extends NostrEvent {
  kind: typeof REQUEST_KIND;
  tags: (
    | [typeof TAG_PUBKEY, string] // 'p' - Target Provider pubkey (required)
    | [typeof TAG_SERVER_IDENTIFIER, string] // 's' - Target Server ID (required)
    | [typeof TAG_METHOD, string] // 'method' - MCP method (required)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified JSON-RPC Request (params depend on method, use SDK types) */
}

export interface DvmcpResponseEvent extends NostrEvent {
  kind: typeof RESPONSE_KIND;
  tags: (
    | [typeof TAG_EVENT_ID, string] // 'e' - ID of the DvmcpRequestEvent (required)
    | [typeof TAG_PUBKEY, string] // 'p' - Target Client pubkey (required)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified JSON-RPC Response (result or error, use SDK types) */
}

/** notification */
export interface DvmcpNotificationEvent extends NostrEvent {
  kind: typeof NOTIFICATION_KIND;
  tags: (
    | [typeof TAG_PUBKEY, string] // 'p' - Target pubkey (recipient) (required)
    | [typeof TAG_METHOD, string] // 'method' - MCP Notification type (optional)
    | [typeof TAG_STATUS, string] // 'status' - Nostr notification type (optional)
    | [typeof TAG_EVENT_ID, string] // 'e' - Related request ID (optional)
    | MultipleTag // Other tags that can appear multiple times
  )[];
  /** content: string; // Stringified JSON-RPC Notification (use SDK types) */
}
