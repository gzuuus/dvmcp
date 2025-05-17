import { serve, type ServerWebSocket } from 'bun';
import {
  finalizeEvent,
  generateSecretKey,
  type Filter,
  type NostrEvent,
  type UnsignedEvent,
} from 'nostr-tools';
import {
  SERVER_ANNOUNCEMENT_KIND,
  TOOLS_LIST_KIND,
  REQUEST_KIND,
  RESPONSE_KIND,
  TAG_METHOD,
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_CAPABILITY,
  TAG_UNIQUE_IDENTIFIER,
} from '../constants';

const relayPort = 3334;
let mockEvents: NostrEvent[] = [];

// Server announcement event according to DVMCP 2025-03-26
const mockServerAnnouncement = {
  kind: SERVER_ANNOUNCEMENT_KIND,
  content: JSON.stringify({
    protocolVersion: '2025-03-26',
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
    serverInfo: {
      name: 'Test DVM',
      version: '1.0.0',
    },
  }),
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    [TAG_UNIQUE_IDENTIFIER, 'test-server-id'],
    ['k', `${REQUEST_KIND}`],
    ['name', 'Test DVM'],
    ['about', 'A test DVM for DVMCP testing'],
  ],
} as UnsignedEvent;

// Tools list event according to DVMCP 2025-03-26
const mockToolsList = {
  kind: TOOLS_LIST_KIND,
  content: JSON.stringify({
    tools: [
      {
        name: 'test-echo',
        description: 'Echo test tool',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
      },
    ],
  }),
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    [TAG_UNIQUE_IDENTIFIER, 'tools-list-id'],
    ['s', 'test-server-id'],
    [TAG_CAPABILITY, 'test-echo'],
  ],
} as UnsignedEvent;

// Generate and add the server announcement event
const serverSecretKey = generateSecretKey();
const finalizedServerEvent = finalizeEvent(
  mockServerAnnouncement,
  serverSecretKey
);
mockEvents.push(finalizedServerEvent);

// Generate and add the tools list event
const finalizedToolsEvent = finalizeEvent(mockToolsList, serverSecretKey);
mockEvents.push(finalizedToolsEvent);

const handleToolExecution = (event: NostrEvent) => {
  if (event.kind === REQUEST_KIND) {
    // Check for tools/call method
    const methodTag = event.tags.find((tag) => tag[0] === TAG_METHOD);
    if (methodTag && methodTag[1] === 'tools/call') {
      try {
        const request = JSON.parse(event.content);
        console.log('Processing execution request:', request);

        // Extract the parameters from the request
        const params = request.params || {};
        const args = params.arguments || {};

        const responseEvent = {
          kind: RESPONSE_KIND,
          content: JSON.stringify({
            content: [
              {
                type: 'text',
                text: `[test] ${args.text}`,
              },
            ],
          }),
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            [TAG_EVENT_ID, event.id],
            [TAG_PUBKEY, event.pubkey],
          ],
        } as UnsignedEvent;

        console.log('Created response event:', responseEvent);
        const finalizedResponse = finalizeEvent(responseEvent, serverSecretKey);
        mockEvents.push(finalizedResponse);
        return finalizedResponse;
      } catch (error) {
        console.error('Error processing tool execution:', error);
      }
    }
  }
  return null;
};

const server = serve({
  port: relayPort,
  fetch(req, server) {
    if (server.upgrade(req)) {
      return;
    }
    return new Response('Upgrade failed', { status: 500 });
  },
  websocket: {
    message(ws, message: string | Buffer) {
      try {
        const data = JSON.parse(message as string);
        console.log('Received message:', data);

        if (data[0] === 'REQ') {
          const subscriptionId = data[1];
          const filter = data[2] as Filter;

          activeSubscriptions.set(subscriptionId, { ws, filter });

          const filteredEvents = mockEvents.filter((event) => {
            let matches = true;

            if (filter.kinds && !filter.kinds.includes(event.kind)) {
              matches = false;
            }

            if (filter.since && event.created_at < filter.since) {
              matches = false;
            }

            return matches;
          });

          console.log(
            `Sending ${filteredEvents.length} filtered events for subscription ${subscriptionId}`
          );

          filteredEvents.forEach((event) => {
            ws.send(JSON.stringify(['EVENT', subscriptionId, event]));
          });

          ws.send(JSON.stringify(['EOSE', subscriptionId]));
        } else if (data[0] === 'EVENT') {
          const event: NostrEvent = data[1];
          mockEvents.push(event);

          const response = handleToolExecution(event);
          if (response) {
            console.log('Created response event:', response);
            mockEvents.push(response);

            for (const [subId, sub] of activeSubscriptions) {
              if (
                !sub.filter.kinds ||
                sub.filter.kinds.includes(response.kind)
              ) {
                if (
                  !sub.filter.since ||
                  response.created_at >= sub.filter.since
                ) {
                  console.log(`Sending response to subscription ${subId}`);
                  sub.ws.send(JSON.stringify(['EVENT', subId, response]));
                }
              }
            }
          }

          ws.send(JSON.stringify(['OK', event.id, true, '']));
        } else if (data[0] === 'CLOSE') {
          const subscriptionId = data[1];
          activeSubscriptions.delete(subscriptionId);
          console.log(`Subscription closed: ${subscriptionId}`);
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    },
    open() {
      console.log('Client connected');
    },
    close() {
      console.log('Client disconnected');
    },
  },
});

console.log(`Mock Nostr Relay started on port ${relayPort}`);

const activeSubscriptions = new Map<
  string,
  {
    ws: ServerWebSocket<unknown>;
    filter: Filter;
  }
>();

const stop = async () => {
  for (const [_, sub] of activeSubscriptions) {
    try {
      sub.ws.close();
    } catch (e) {
      console.debug('Warning during subscription cleanup:', e);
    }
  }
  activeSubscriptions.clear();
  // Reset the mockEvents array
  mockEvents.length = 0;
  server.stop();
};

export { server, mockEvents, stop };
