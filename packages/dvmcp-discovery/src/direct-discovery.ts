import type { Event, Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr';

import {
  loggerDiscovery,
  PROMPTS_LIST_KIND,
  RESOURCES_LIST_KIND,
  SERVER_ANNOUNCEMENT_KIND,
  TAG_UNIQUE_IDENTIFIER,
  TOOLS_LIST_KIND,
} from '@dvmcp/commons/core';
import type { AddressPointer, ProfilePointer } from 'nostr-tools/nip19';
import type {
  InitializeResult,
  ListToolsResult,
  ListPromptsResult,
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
} from '@modelcontextprotocol/sdk/types.js';
import { DEFAULT_VALUES } from './config-schema';

async function fetchEvents(
  relays: string[],
  filter: Filter,
  errorMessage: string
): Promise<Event[]> {
  if (!relays || relays.length === 0) {
    relays = [DEFAULT_VALUES.DEFAULT_RELAY_URL];
  }
  const relayHandler = new RelayHandler(relays);
  try {
    loggerDiscovery('Querying for events:', filter);
    const events = await relayHandler.queryEvents(filter);
    if (events.length === 0) {
      loggerDiscovery(errorMessage);
      return [];
    }

    return events;
  } catch (error) {
    console.error(`Failed to fetch events: ${error}`);
    return [];
  } finally {
    relayHandler.cleanup();
  }
}

export async function fetchProviderAnnouncement(
  providerData: ProfilePointer
): Promise<Event | null> {
  const filter: Filter = {
    kinds: [SERVER_ANNOUNCEMENT_KIND],
    authors: [providerData.pubkey],
  };

  const events = await fetchEvents(
    providerData.relays || [],
    filter,
    'No server announcement found for provider'
  );

  if (events.length === 0) return null;

  // Sort by created_at to get the most recent announcement
  events.sort((a, b) => b.created_at - a.created_at);
  return events[0];
}

export async function fetchServerAnnouncement(
  addrData: AddressPointer
): Promise<Event | null> {
  const filter: Filter = {
    kinds: [addrData.kind],
    authors: [addrData.pubkey],
    '#d': addrData.identifier ? [addrData.identifier] : undefined,
  };

  const events = await fetchEvents(
    addrData.relays || [],
    filter,
    'No server announcement found for the specified coordinates'
  );

  if (events.length === 0) return null;
  return events[0];
}

export interface FetchedServerCapabilities {
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
}

export async function fetchServerCapabilities(
  relays: string[],
  pubkey: string,
  serverId: string
): Promise<FetchedServerCapabilities> {
  const result: FetchedServerCapabilities = {
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
  };

  const filters = [
    {
      kind: TOOLS_LIST_KIND,
      errorMessage: `No tools list found for server ${serverId}`,
    },
    {
      kind: RESOURCES_LIST_KIND,
      errorMessage: `No resources list found for server ${serverId}`,
    },
    {
      kind: PROMPTS_LIST_KIND,
      errorMessage: `No prompts list found for server ${serverId}`,
    },
  ];

  const eventFilters = filters.map(({ kind, errorMessage }) => ({
    filter: {
      kinds: [kind],
      authors: [pubkey],
      '#s': [serverId],
    },
    errorMessage,
  }));

  const [toolsEvents, resourcesEvents, promptsEvents] = await Promise.all(
    eventFilters.map(({ filter, errorMessage }) =>
      fetchEvents(relays, filter, errorMessage)
    )
  );

  const processEvents = <T>(
    events: Event[],
    extractFn: (content: any) => T[] | undefined,
    type: string
  ): T[] => {
    const items: T[] = [];

    for (const event of events) {
      try {
        const content = JSON.parse(event.content);
        const extractedItems = extractFn(content);

        if (extractedItems && Array.isArray(extractedItems)) {
          items.push(...extractedItems);
          loggerDiscovery(
            `Found ${extractedItems.length} ${type} for server ${serverId}`
          );
        }
      } catch (error) {
        console.error(`Failed to parse ${type} list: ${error}`);
      }
    }

    return items;
  };

  result.tools = processEvents<Tool>(
    toolsEvents,
    (content: ListToolsResult) => content.tools,
    'tools'
  );

  const processResourceEvents = () => {
    const resources: Resource[] = [];
    const resourceTemplates: ResourceTemplate[] = [];

    for (const event of resourcesEvents) {
      try {
        const content = JSON.parse(event.content);
        const uniqueId = event.tags.find(
          (tag) => tag[0] === TAG_UNIQUE_IDENTIFIER
        )?.[1];
        const isTemplateList = uniqueId?.includes('resources/templates/list');

        if (
          isTemplateList &&
          content.resourceTemplates &&
          Array.isArray(content.resourceTemplates)
        ) {
          resourceTemplates.push(...content.resourceTemplates);
          loggerDiscovery(
            `Found ${content.resourceTemplates.length} resource templates for server ${serverId}`
          );
        } else if (
          !isTemplateList &&
          'resources' in content &&
          Array.isArray(content.resources)
        ) {
          resources.push(...content.resources);
          loggerDiscovery(
            `Found ${content.resources.length} resources for server ${serverId}`
          );
        }
      } catch (error) {
        console.error(`Failed to parse resources list: ${error}`);
      }
    }

    return { resources, resourceTemplates };
  };

  const resourceResults = processResourceEvents();
  result.resources = resourceResults.resources;
  result.resourceTemplates = resourceResults.resourceTemplates;
  result.prompts = processEvents<Prompt>(
    promptsEvents,
    (content: ListPromptsResult) => content.prompts,
    'prompts'
  );

  return result;
}

export function parseAnnouncement(event: Event): {
  result: InitializeResult | null;
  serverId: string | undefined;
} {
  try {
    if (event.kind === SERVER_ANNOUNCEMENT_KIND) {
      const content: InitializeResult = JSON.parse(event.content);

      loggerDiscovery(
        `Parsed server announcement with capabilities: ${Object.keys(content.capabilities || {}).join(', ')}`
      );

      const serverId = event.tags.find(
        (tag) => tag[0] === TAG_UNIQUE_IDENTIFIER
      )?.[1];
      if (!serverId) {
        loggerDiscovery('Server announcement missing server ID');
      }

      return { result: content, serverId };
    } else {
      console.error(
        `Unsupported event kind for parsing announcement: ${event.kind}`
      );
      return { result: null, serverId: undefined };
    }
  } catch (error) {
    console.error(`Failed to parse announcement: ${error}`);
    return { result: null, serverId: undefined };
  }
}
