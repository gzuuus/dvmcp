export const HEX_KEYS_REGEX = /^(?:[0-9a-fA-F]{64})$/;

// DVMCP Event Kind constants (Spec 2025-03-26)
export const SERVER_ANNOUNCEMENT_KIND = 31316; // Addressable: Server Announcement
export const TOOLS_LIST_KIND = 31317; // Addressable: Tools List
export const RESOURCES_LIST_KIND = 31318; // Addressable: Resources List
export const PROMPTS_LIST_KIND = 31319; // Addressable: Prompts List
export const REQUEST_KIND = 25910; // Ephemeral: Client Requests
export const RESPONSE_KIND = 26910; // Ephemeral: Server Responses
export const NOTIFICATION_KIND = 21316; // Ephemeral: Feedback/Notifications
export const GIFT_WRAP_KIND = 1059; // Gift Wrap (NIP-59): Encrypted messages

// Common Tags for DVMCP Events
export const TAG_UNIQUE_IDENTIFIER = 'd'; // Unique identifier (addressable events) or Server ID (init response)
export const TAG_SERVER_IDENTIFIER = 's'; // Target Server identifier (requests, list announcements)
export const TAG_PUBKEY = 'p'; // Target Public key (requests, notifications)
export const TAG_EVENT_ID = 'e'; // Related Event ID (responses, some notifications)
export const TAG_METHOD = 'method'; // MCP method/notification type
export const TAG_CAPABILITY = 'cap'; // Capability name (list announcements)
export const TAG_KIND = 'k'; // Accepted request kind (server announcement)
export const TAG_STATUS = 'status'; // Nostr-specific notification status (e.g., 'payment-required')
export const TAG_AMOUNT = 'amount'; // Nostr-specific notification amount/invoice
export const TAG_INVOICE = 'invoice'; // Nostr-specific notification invoice
export const MCPMETHODS = {
  toolsList: 'tools/list',
  toolsCall: 'tools/call',
  resourcesList: 'resources/list',
  resourcesRead: 'resources/read',
  promptsList: 'prompts/list',
  promptsCall: 'prompts/call',
} as const;
