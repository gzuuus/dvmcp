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
import { getResponsePublisher } from '../utils/response-publisher-factory';

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
    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(errorResponse, responseContext);
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
    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(response, responseContext);
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
    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(errorResp, responseContext);
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
    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(errorResponse, responseContext);
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
    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(response, responseContext);
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
    const publisher = getResponsePublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await publisher.publishResponse(errorResp, responseContext);
  }
}
