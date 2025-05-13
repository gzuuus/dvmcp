import { loggerBridge } from '@dvmcp/commons/logger';
import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_STATUS,
  NOTIFICATION_KIND,
  RESPONSE_KIND,
  TAG_METHOD,
} from '@dvmcp/commons/constants';
import type { MCPPool } from '../mcp-pool';
import type { DvmcpBridgeConfig } from '../config-schema.js';
import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { KeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { NostrEvent } from 'nostr-tools';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { handlePaymentFlow } from './payment-handler';
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

  // Send processing status notification
  const processingStatus = keyManager.signEvent({
    ...keyManager.createEventTemplate(NOTIFICATION_KIND),
    content: JSON.stringify({
      method: 'notifications/progress',
      params: { message: 'processing' },
    }),
    tags: [
      [TAG_PUBKEY, pubkey],
      [TAG_EVENT_ID, id],
      [TAG_METHOD, 'notifications/progress'],
    ],
  });
  await relayHandler.publishEvent(processingStatus);

  try {
    // Check if tool requires payment
    const pricing = mcpPool.getToolPricing(jobRequest.params.name);

    if (pricing?.price) {
      // Handle payment flow
      const paymentSuccessful = await handlePaymentFlow(
        pricing.price,
        jobRequest.params.name,
        id,
        pubkey,
        config,
        keyManager,
        relayHandler,
        pricing.unit || 'sats'
      );

      if (!paymentSuccessful) {
        // Payment failed, exit early
        return;
      }
    }

    // Call the tool
    const result: CallToolResult | undefined = await mcpPool.callTool(
      jobRequest.params.name,
      jobRequest.params.arguments!
    );

    // Send success notification
    const successStatus = keyManager.signEvent({
      ...keyManager.createEventTemplate(NOTIFICATION_KIND),
      tags: [
        [TAG_STATUS, 'success'],
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await relayHandler.publishEvent(successStatus);

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
    const errorStatus = keyManager.signEvent({
      ...keyManager.createEventTemplate(NOTIFICATION_KIND),
      tags: [
        [TAG_STATUS, 'error'],
        [TAG_EVENT_ID, id],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await relayHandler.publishEvent(errorStatus);

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
