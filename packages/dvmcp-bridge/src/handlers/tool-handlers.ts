import { loggerBridge } from '@dvmcp/commons/core';
import { TAG_EVENT_ID, TAG_PUBKEY, RESPONSE_KIND } from '@dvmcp/commons/core';
import type { MCPPool } from '../mcp-pool';
import type { DvmcpBridgeConfig } from '../config-schema.js';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { NostrEvent } from 'nostr-tools';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { PaymentProcessor } from './payment-processor';
import { createProtocolErrorResponse } from '../utils.js';
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
 * Handles the tools/list method request
 */
export async function handleToolsList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
): Promise<void> {
  const { success, error } = ListToolsRequestSchema.safeParse(
    JSON.parse(event.content)
  );
  if (!success) {
    loggerBridge('tools list request error', error);
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
    const toolsResult = await mcpPool.listTools();
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(toolsResult),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    loggerBridge('tools list response', response);
    await publishResponse(response, responseContext);
  } catch (err) {
    const errorResp = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        error: {
          code: -32000,
          message: 'Failed to list tools',
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
 * Handles the tools/call method request
 */
export async function handleToolsCall(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  config: DvmcpBridgeConfig,
  responseContext: ResponseContext
): Promise<void> {
  const {
    success,
    data: jobRequest,
    error,
  } = CallToolRequestSchema.safeParse(JSON.parse(event.content));
  if (!success) {
    loggerBridge('tools call request error', error);
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

  // Processing notification will be sent by the payment processor

  // Create payment processor
  const paymentProcessor = new PaymentProcessor(
    config,
    keyManager,
    relayHandler
  );

  try {
    // Check if tool requires payment
    const pricing = mcpPool.getToolPricing(jobRequest.params.name);

    // Process payment if required
    const paymentSuccessful = await paymentProcessor.processPaymentIfRequired(
      pricing,
      jobRequest.params.name,
      'tool',
      id,
      pubkey
    );

    if (!paymentSuccessful) {
      // Payment failed, exit early
      return;
    }

    // Call the tool
    const result: CallToolResult | undefined = await mcpPool.callTool(
      jobRequest.params.name,
      jobRequest.params.arguments!
    );

    // Send success notification
    await paymentProcessor.sendSuccessNotification(id, pubkey);

    // Send response
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(result),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await publishResponse(response, responseContext);
  } catch (error) {
    // Send error notification
    await paymentProcessor.sendErrorNotification(
      id,
      pubkey,
      error instanceof Error ? error.message : String(error)
    );

    // Send error response
    const errorResp = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Execution error',
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
