import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  RESPONSE_KIND,
} from '@dvmcp/commons/constants';
import type { MCPPool } from '../mcp-pool';
import type { DvmcpBridgeConfig } from '../config-schema.js';
import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { KeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { NostrEvent } from 'nostr-tools';
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  type GetPromptResult,
  type ListPromptsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { createProtocolErrorResponse } from '../utils';
import { loggerBridge } from '@dvmcp/commons/logger';
import { PaymentProcessor } from './payment-processor';

/**
 * Handles the prompts/list method request
 */
export async function handlePromptsList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler
): Promise<void> {
  const { success, error } = ListPromptsRequestSchema.safeParse(
    JSON.parse(event.content)
  );
  if (!success) {
    loggerBridge('prompts list request error', error);
    await relayHandler.publishEvent(
      createProtocolErrorResponse(
        event.id,
        event.pubkey,
        -32700,
        JSON.stringify(error),
        keyManager,
        RESPONSE_KIND
      )
    );
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
    await relayHandler.publishEvent(response);
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
    await relayHandler.publishEvent(errorResp);
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
  config: DvmcpBridgeConfig
): Promise<void> {
  const {
    success,
    data: getParams,
    error,
  } = GetPromptRequestSchema.safeParse(JSON.parse(event.content));
  if (!success) {
    loggerBridge('prompts get request error', error);
    await relayHandler.publishEvent(
      createProtocolErrorResponse(
        event.id,
        event.pubkey,
        -32700,
        JSON.stringify(error),
        keyManager,
        RESPONSE_KIND
      )
    );
    return;
  }
  const id = event.id;
  const pubkey = event.pubkey;

  // Create payment processor
  const paymentProcessor = new PaymentProcessor(
    config,
    keyManager,
    relayHandler
  );

  try {
    if (!getParams.params.name) {
      throw new Error('Prompt name is required');
    }

    const promptName = getParams.params.name;

    // Check if prompt requires payment
    const pricing = mcpPool.getPromptPricing(promptName);

    // Process payment if required
    const paymentSuccessful = await paymentProcessor.processPaymentIfRequired(
      pricing,
      promptName,
      'prompt',
      id,
      pubkey
    );

    if (!paymentSuccessful) {
      // Payment failed, exit early
      return;
    }

    const prompt: GetPromptResult | undefined =
      await mcpPool.getPrompt(promptName);
    if (!prompt) {
      throw new Error(`Prompt not found: ${promptName}`);
    }

    // Send success notification
    await paymentProcessor.sendSuccessNotification(id, pubkey);

    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(prompt),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await relayHandler.publishEvent(response);
  } catch (err) {
    // Send error notification
    await paymentProcessor.sendErrorNotification(id, pubkey);

    // Send error response
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
    await relayHandler.publishEvent(errorResp);
  }
}
