import { loggerBridge } from '@dvmcp/commons/core';
import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  RESPONSE_KIND,
  TAG_STATUS,
  TAG_METHOD,
} from '@dvmcp/commons/core';
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
import type { ResponseContext } from '../dvm-bridge.js';
import { getResponsePublisher } from '../utils/response-publisher';
import { createProtocolErrorResponse } from '../utils.js';

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
    loggerBridge.error('tools list request error', error);
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
    const toolsResult = await mcpPool.listTools();
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(toolsResult),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    loggerBridge.debug('tools list response', response);
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
          message: 'Failed to list tools',
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
    loggerBridge.error('tools call request error', error);
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

  // Processing notification will be sent by the payment processor

  const publisher = getResponsePublisher(
    relayHandler,
    keyManager,
    responseContext.encryptionManager
  );

  // Create payment processor
  const paymentProcessor = new PaymentProcessor(
    config,
    keyManager,
    relayHandler,
    publisher
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
      pubkey,
      responseContext.shouldEncrypt
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

    // Send response
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(result),
      tags: [
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await publisher.publishResponse(response, responseContext);
  } catch (error) {
    // Send error notification
    await publisher.publishNotification(
      error instanceof Error ? error.message : String(error),
      pubkey,
      [
        [TAG_STATUS, 'error'],
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
      responseContext.shouldEncrypt
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
    await publisher.publishResponse(errorResp, responseContext);
  }
}
