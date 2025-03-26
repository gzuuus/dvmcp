import type { Event, Filter } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { DVM_ANNOUNCEMENT_KIND } from '@dvmcp/commons/constants';
import type { NaddrData, NprofileData } from './nip19-utils';
import logger from './logger';

export interface DVMAnnouncement {
  name: string;
  about: string;
  tools: any[];
}

async function fetchAnnouncement(
  relays: string[],
  filter: Filter,
  errorMessage: string
): Promise<Event | null> {
  // Create a new relay handler with the provided relays
  const relayHandler = new RelayHandler(relays);

  try {
    // Query for the announcement event
    logger('Querying for announcement event:', filter);
    const events = await relayHandler.queryEvents(filter);

    if (events.length === 0) {
      console.error(errorMessage);
      return null;
    }

    return events[0];
  } catch (error) {
    console.error(`Failed to fetch announcement: ${error}`);
    return null;
  } finally {
    relayHandler.cleanup();
  }
}

export async function fetchProviderAnnouncement(
  providerData: NprofileData
): Promise<Event | null> {
  // Query for the provider's DVM announcement
  const filter: Filter = {
    kinds: [DVM_ANNOUNCEMENT_KIND],
    authors: [providerData.pubkey],
    '#t': ['mcp'],
  };

  const events = await fetchAnnouncement(
    providerData.relays,
    filter,
    'No DVM announcement found for provider'
  );

  if (!events) return null;

  // If we have multiple events, sort by created_at to get the most recent announcement
  if (Array.isArray(events)) {
    events.sort((a, b) => b.created_at - a.created_at);
    return events[0];
  }

  return events;
}

export async function fetchServerAnnouncement(
  addrData: NaddrData
): Promise<Event | null> {
  // Query for the specific announcement event
  const filter: Filter = {
    kinds: [addrData.kind],
    authors: [addrData.pubkey],
    '#d': addrData.identifier ? [addrData.identifier] : undefined,
  };

  return fetchAnnouncement(
    addrData.relays,
    filter,
    'No DVM announcement found for the specified coordinates'
  );
}

export function parseAnnouncement(event: Event): DVMAnnouncement | null {
  try {
    return JSON.parse(event.content);
  } catch (error) {
    console.error(`Failed to parse announcement: ${error}`);
    return null;
  }
}
