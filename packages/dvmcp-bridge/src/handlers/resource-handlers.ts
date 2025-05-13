import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  RESPONSE_KIND,
} from '@dvmcp/commons/constants';
import type { MCPPool } from '../mcp-pool';
import type { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { KeyManager } from '@dvmcp/commons/nostr/key-manager';
import type { NostrEvent } from 'nostr-tools';
import {
  type ReadResourceResult,
  type ListResourcesResult,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createProtocolErrorResponse } from '../utils';
import { loggerBridge } from '@dvmcp/commons/logger';

/**
 * Handles the resources/list method request
 */
export async function handleResourcesList(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler
): Promise<void> {
  const { success, error } = ListResourcesRequestSchema.safeParse(
    JSON.parse(event.content)
  );
  if (!success) {
    loggerBridge('resources list request error', error);
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
    const resourcesResult: ListResourcesResult = await mcpPool.listResources();
    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(resourcesResult),
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
          message: 'Failed to list resources',
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
 * Handles the resources/read method request
 */
export async function handleResourcesRead(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler
): Promise<void> {
  const {
    success,
    data: readParams,
    error,
  } = ReadResourceRequestSchema.safeParse(JSON.parse(event.content));
  if (!success) {
    loggerBridge('resources read request error', error);
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
    if (!readParams.params.uri) {
      throw new Error('Resource URI is required');
    }

    const resourceUri = readParams.params.uri;
    const resourceResult: ReadResourceResult | undefined =
      await mcpPool.readResource(resourceUri);

    if (!resourceResult) {
      throw new Error(`Resource not found: ${resourceUri}`);
    }

    const response = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify(resourceResult),
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
          message: 'Failed to read resource',
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
