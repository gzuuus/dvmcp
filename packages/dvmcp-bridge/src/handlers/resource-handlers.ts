import { TAG_EVENT_ID, TAG_PUBKEY, RESPONSE_KIND } from '@dvmcp/commons/core';
import type { MCPPool } from '../mcp-pool';
import type { DvmcpBridgeConfig } from '../config-schema.js';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import type { NostrEvent } from 'nostr-tools';
import {
  type ReadResourceResult,
  type ListResourcesResult,
  type ListResourceTemplatesResult,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createProtocolErrorResponse } from '../utils';
import { loggerBridge } from '@dvmcp/commons/core';
import { PaymentProcessor } from './payment-processor';
import type { ResponseContext } from '../dvm-bridge.js';
import { getResponsePublisher } from '../utils/response-publisher';

/**
 * Handles the resources/list method request
 */
export async function handleResourcesList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
): Promise<void> {
  const { success, error } = ListResourcesRequestSchema.safeParse(
    JSON.parse(event.content)
  );
  if (!success) {
    loggerBridge('resources list request error', error);
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
    const resourcesResult: ListResourcesResult = await mcpPool.listResources();
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(resourcesResult),
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
          message: 'Failed to list resources',
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
 * Handles the resources/templates/list method request
 */
export async function handleResourceTemplatesList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext
): Promise<void> {
  const id = event.id;
  const pubkey = event.pubkey;

  try {
    const resourceTemplatesResult: ListResourceTemplatesResult =
      await mcpPool.listResourceTemplates();
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(resourceTemplatesResult),
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
          message: 'Failed to list resource templates',
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
 * Handles the resources/read method request
 */
export async function handleResourcesRead(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  config: DvmcpBridgeConfig,
  responseContext: ResponseContext
): Promise<void> {
  const {
    success,
    data: readParams,
    error,
  } = ReadResourceRequestSchema.safeParse(JSON.parse(event.content));
  if (!success) {
    loggerBridge('resources read request error', error);
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

  // Create payment processor
  const paymentProcessor = new PaymentProcessor(
    config,
    keyManager,
    relayHandler,
    undefined, // paymentTimeoutMs - use default
    responseContext.encryptionManager
  );

  try {
    if (!readParams.params.uri) {
      throw new Error('Resource URI is required');
    }

    const resourceUri = readParams.params.uri;
    // Check if resource requires payment
    const pricing = mcpPool.getResourcePricing(resourceUri);

    // Process payment if required
    const paymentSuccessful = await paymentProcessor.processPaymentIfRequired(
      pricing,
      resourceUri,
      'resource',
      id,
      pubkey,
      responseContext.shouldEncrypt
    );

    if (!paymentSuccessful) {
      // Payment failed, exit early
      return;
    }
    const resourceResult: ReadResourceResult | undefined =
      await mcpPool.readResource(resourceUri);

    if (!resourceResult) {
      throw new Error(`Resource not found: ${resourceUri}`);
    }

    // Send success notification
    await paymentProcessor.sendSuccessNotification(
      id,
      pubkey,
      responseContext.shouldEncrypt
    );

    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(resourceResult),
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
    // Send error notification
    await paymentProcessor.sendErrorNotification(
      id,
      pubkey,
      err instanceof Error ? err.message : String(err),
      responseContext.shouldEncrypt
    );

    // Send error response
    const errorResp = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        error: {
          code: -32000,
          message: 'Failed to read resource',
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
