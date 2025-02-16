import { serve, type ServerWebSocket } from 'bun';
import {
  finalizeEvent,
  generateSecretKey,
  type Filter,
  type NostrEvent,
  type UnsignedEvent,
} from 'nostr-tools';
import {
  DVM_ANNOUNCEMENT_KIND,
  TOOL_REQUEST_KIND,
  TOOL_RESPONSE_KIND,
} from '../constants';

const relayPort = 3334;
let mockEvents: NostrEvent[] = [];

const mockDVMAnnouncement = {
  kind: DVM_ANNOUNCEMENT_KIND,
  content: JSON.stringify({
    name: 'Test DVM',
    about: 'A test DVM instance',
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
    ['d', 'dvm-announcement'],
    ['k', `${TOOL_REQUEST_KIND}`],
    ['capabilities', 'mcp-1.0'],
    ['t', 'mcp'],
    ['t', 'test-echo'],
  ],
} as UnsignedEvent;

const finalizedEvent = finalizeEvent(mockDVMAnnouncement, generateSecretKey());
mockEvents.push(finalizedEvent);

const handleToolExecution = (event: NostrEvent) => {
  if (event.kind === TOOL_REQUEST_KIND) {
    const commandTag = event.tags.find((tag) => tag[0] === 'c');
    if (commandTag && commandTag[1] === 'execute-tool') {
      const request = JSON.parse(event.content);
      console.log('Processing execution request:', request);

      const responseEvent = {
        kind: TOOL_RESPONSE_KIND,
        content: JSON.stringify({
          content: [
            {
              type: 'text',
              text: `[test] ${request.parameters.text}`,
            },
          ],
        }),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', event.id],
          ['p', event.pubkey],
          ['c', 'execute-tool-response'],
        ],
      } as UnsignedEvent;

      console.log('Created response event:', responseEvent);
      const finalizedResponse = finalizeEvent(
        responseEvent,
        generateSecretKey()
      );
      mockEvents.push(finalizedResponse);
      return finalizedResponse;
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
  mockEvents = [];
  server.stop();
};

export { server, mockEvents, stop };
