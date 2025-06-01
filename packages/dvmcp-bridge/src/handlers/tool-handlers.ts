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

/**
 * Handles the tools/list method request
 */
export async function handleToolsList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler
): Promise<void> {
  const { success, error } = ListToolsRequestSchema.safeParse(
    JSON.parse(event.content)
  );
  if (!success) {
    loggerBridge('tools list request error', error);
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
    await relayHandler.publishEvent(response);
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
    await relayHandler.publishEvent(errorResp);
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
  config: DvmcpBridgeConfig
): Promise<void> {
  const {
    success,
    data: jobRequest,
    error,
  } = CallToolRequestSchema.safeParse(JSON.parse(event.content));
  if (!success) {
    loggerBridge('tools call request error', error);
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
    await relayHandler.publishEvent(response);
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
    await relayHandler.publishEvent(errorResp);
  }
}
