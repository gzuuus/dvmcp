import { type Event as NostrEvent } from 'nostr-tools';
import { loggerBridge } from '@dvmcp/commons/core';
import { MCPPool } from '../mcp-pool';
import { RESPONSE_KIND, TAG_EVENT_ID } from '@dvmcp/commons/core';
import type {
  CompleteRequest,
  CompleteResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { KeyManager } from '@dvmcp/commons/nostr';

/**
 * Create a response event for a request event
 * @param requestEvent - The request event to respond to
 * @param content - The content of the response
 * @param keyManager - The key manager to sign the event
 * @returns The response event
 */
function createResponseEvent(
  requestEvent: NostrEvent,
  content: CompleteResult,
  keyManager: KeyManager
): NostrEvent {
  const responseTemplate = keyManager.createEventTemplate(RESPONSE_KIND);
  responseTemplate.content = JSON.stringify(content);
  responseTemplate.tags.push([TAG_EVENT_ID, requestEvent.id]);
  return keyManager.signEvent(responseTemplate);
}

/**
 * Handle a completion/complete request from a client
 * @param event - The Nostr event containing the request
 * @param mcpPool - The MCP pool to route the request to
 * @param keyManager - The key manager to sign the response
 * @returns A promise that resolves to a Nostr event containing the response
 */
export async function handleCompletionComplete(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager
): Promise<NostrEvent | undefined> {
  try {
    // Parse the request content
    const request: CompleteRequest = JSON.parse(event.content);

    // Call the complete method on the MCP pool
    const result: CompleteResult | undefined = await mcpPool.complete(
      request.params
    );

    if (!result) {
      // If no result, it means the server doesn't support completions or the reference wasn't found
      return undefined;
    }

    // Return the completion result
    return createResponseEvent(event, result, keyManager);
  } catch (error) {
    loggerBridge('[handleCompletionComplete] Error:', error);
    return undefined;
  }
}
