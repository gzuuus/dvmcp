import { type NostrEvent } from 'nostr-tools';
import { type KeyManager } from '@dvmcp/commons/nostr';
import { type RelayHandler } from '@dvmcp/commons/nostr';
import {
  loggerBridge,
  MCPMETHODS,
  RESPONSE_KIND,
  TAG_UNIQUE_IDENTIFIER,
} from '@dvmcp/commons/core';
import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_SERVER_IDENTIFIER,
} from '@dvmcp/commons/core';
import {
  type InitializeResult,
  type Implementation,
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/sdk/types.js';
import { MCPPool } from '../mcp-pool';
import { type ResponseContext } from '../dvm-bridge';
import { EventPublisher } from '@dvmcp/commons/nostr';
import type { DvmcpBridgeConfig } from '../config-schema';

/**
 * Handles the 'initialize' MCP method request from a client.
 * This function constructs and sends the server's initialization information back to the client.
 *
 * @param event The Nostr event representing the initialize request.
 * @param mcpPool The MCPPool instance to access MCP server capabilities.
 * @param keyManager The KeyManager instance for signing events.
 * @param relayHandler The RelayHandler instance for publishing events.
 * @param responseContext The ResponseContext for publishing the response.
 * @param config The DvmcpBridgeConfig for server information and instructions.
 */
export async function handleInitialize(
  event: NostrEvent,
  mcpPool: MCPPool,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  responseContext: ResponseContext,
  config: DvmcpBridgeConfig,
  actualServerId: string
): Promise<void> {
  loggerBridge.info(`Handling MCP Method: ${MCPMETHODS.initialize}`);

  const eventTags = event.tags;
  const eventId = event.id;
  const senderPubkey = event.pubkey; // This is the original sender's pubkey
  const serverIdentifierTag = eventTags.find(
    (tag) => tag[0] === TAG_SERVER_IDENTIFIER
  );
  const requestedServerId = serverIdentifierTag
    ? serverIdentifierTag[1]
    : undefined;

  // If a specific server ID was requested and it does not match this bridge's server ID do not respond
  if (requestedServerId && requestedServerId !== actualServerId) {
    loggerBridge.debug(
      `Initialize request for server ID '${requestedServerId}' does not match ` +
        `this bridge's server ID '${actualServerId}'. Not responding.`
    );
    return;
  }

  const mainClient = mcpPool.getDefaultClient();
  if (!mainClient) {
    loggerBridge.error(
      'No MCP server client available to handle initialize request.'
    );
    // Respond with an error if no MCP client is available
    const errorEvent = keyManager.signEvent({
      ...keyManager.createEventTemplate(RESPONSE_KIND),
      content: JSON.stringify({
        error: {
          code: -32000,
          message: 'Internal error: No MCP client available',
        },
      }),
      tags: [
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, senderPubkey],
      ],
    });
    const eventPublisher = new EventPublisher(
      relayHandler,
      keyManager,
      responseContext.encryptionManager
    );
    await eventPublisher.publishResponse(
      errorEvent,
      senderPubkey,
      responseContext.shouldEncrypt
    );
    return;
  }

  const serverInfo: Implementation = {
    name: config.mcp.name,
    version: config.mcp.clientVersion,
  };

  const initializationResponse: InitializeResult = {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: mainClient.getServerCapabilities(),
    serverInfo: serverInfo,
    instructions: config.mcp.instructions,
  };

  const responseContent = JSON.stringify(initializationResponse);

  const tags: string[][] = [
    [TAG_EVENT_ID, eventId], // Reference the original request event ID
    [TAG_PUBKEY, senderPubkey], // Target the client's public key
  ];

  // Add supporting encryption tag
  if (config.encryption?.mode && config.encryption.mode !== 'disabled') {
    tags.push(['support_encryption', 'true']);
  }

  // Add the server identifier to the response
  tags.push([TAG_UNIQUE_IDENTIFIER, actualServerId]);

  const responseEvent = keyManager.signEvent({
    ...keyManager.createEventTemplate(RESPONSE_KIND),
    content: responseContent,
    tags,
  });

  const eventPublisher = new EventPublisher(
    relayHandler,
    keyManager,
    responseContext.encryptionManager
  );
  await eventPublisher.publishResponse(
    responseEvent,
    senderPubkey,
    responseContext.shouldEncrypt
  );
  loggerBridge.info(`Sent initialize response to ${senderPubkey}`);
}
