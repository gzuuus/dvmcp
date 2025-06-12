import { TAG_EVENT_ID, TAG_PUBKEY, RESPONSE_KIND } from '@dvmcp/commons/core';
import type { MCPPool } from '../mcp-pool';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { NostrEvent } from 'nostr-tools';
import {
  type ListPromptsResult,
  type GetPromptResult,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createProtocolErrorResponse } from '../utils';
import { loggerBridge } from '@dvmcp/commons/core';
import type { ResponseContext } from '../dvm-bridge.js';

/**
 * Helper function to publish response with encryption support
 */
async function publishResponse(
  response: NostrEvent,
  responseContext: ResponseContext
): Promise<void> {
  if (
    responseContext.shouldEncrypt &&
    responseContext.encryptionManager?.isEncryptionEnabled()
  ) {
    // Encrypt the response for the original requester
    try {
      // Convert signed event back to EventTemplate for encryption
      const eventTemplate = {
        kind: response.kind,
        content: response.content,
        tags: response.tags,
        created_at: response.created_at,
      };

      const encryptedEvent =
        await responseContext.encryptionManager.encryptMessage(
          responseContext.keyManager.getPrivateKey(),
          responseContext.recipientPubkey,
          eventTemplate
        );

      if (encryptedEvent) {
        await responseContext.relayHandler.publishEvent(encryptedEvent);
      } else {
        await responseContext.relayHandler.publishEvent(response);
      }
    } catch (error) {
      await responseContext.relayHandler.publishEvent(response);
    }
  } else {
    // Publish unencrypted response
    await responseContext.relayHandler.publishEvent(response);
  }
}

/**
 * Handles the prompts/list method request
 */
export async function handlePromptsList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
): Promise<void> {
  const { success, error } = ListPromptsRequestSchema.safeParse(
    JSON.parse(event.content)
  );
  if (!success) {
    loggerBridge('prompts list request error', error);
    const errorResponse = createProtocolErrorResponse(
      event.id,
      event.pubkey,
      -32700,
      JSON.stringify(error),
      keyManager,
      RESPONSE_KIND
    );
    await publishResponse(errorResponse, responseContext);
    return;
  }
  const id = event.id;
  const pubkey = event.pubkey;

  try {
    const promptsResult: ListPromptsResult = await mcpPool.listPrompts();
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(promptsResult),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await publishResponse(response, responseContext);
  } catch (err) {
    const errorResp = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        error: {
          code: -32000,
          message: 'Failed to list prompts',
          data: err instanceof Error ? err.message : String(err),
        },
      }),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await publishResponse(errorResp, responseContext);
  }
}

/**
 * Handles the prompts/get method request
 */
export async function handlePromptsGet(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
): Promise<void> {
  const {
    success,
    data: getParams,
    error,
  } = GetPromptRequestSchema.safeParse(JSON.parse(event.content));
  if (!success) {
    loggerBridge('prompts get request error', error);
    const errorResponse = createProtocolErrorResponse(
      event.id,
      event.pubkey,
      -32700,
      JSON.stringify(error),
      keyManager,
      RESPONSE_KIND
    );
    await publishResponse(errorResponse, responseContext);
    return;
  }
  const id = event.id;
  const pubkey = event.pubkey;

  try {
    if (!getParams.params.name) {
      throw new Error('Prompt name is required');
    }

    const promptResult = await mcpPool.getPrompt(
      getParams.params.name,
      getParams.params.arguments
    );
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(promptResult),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await publishResponse(response, responseContext);
  } catch (err) {
    const errorResp = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        error: {
          code: -32000,
          message: 'Failed to get prompt',
          data: err instanceof Error ? err.message : String(err),
        },
      }),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await publishResponse(errorResp, responseContext);
  }
}
