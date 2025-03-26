import { nip19 } from 'nostr-tools';
import { DVM_ANNOUNCEMENT_KIND } from '@dvmcp/commons/constants';
import { loggerDiscovery } from '@dvmcp/commons/logger';

// Default fallback relay when no relay hints are provided
export const DEFAULT_FALLBACK_RELAY = 'wss://relay.dvmcp.fun';

export interface NprofileData {
  pubkey: string;
  relays: string[];
}

export interface NaddrData {
  identifier: string;
  pubkey: string;
  kind: number;
  relays: string[];
}

/**
 * Decodes an nprofile NIP-19 entity
 * @param nprofileEntity The bech32-encoded nprofile string
 * @returns The decoded nprofile data or null if invalid
 */
export function decodeNprofile(nprofileEntity: string): NprofileData | null {
  try {
    const { type, data } = nip19.decode(nprofileEntity);
    if (type !== 'nprofile') {
      console.error(`Expected nprofile, got ${type}`);
      return null;
    }

    // Ensure we have at least one relay by using the fallback if necessary
    const profileData = data as NprofileData;
    if (!profileData.relays || profileData.relays.length === 0) {
      loggerDiscovery(
        `No relay hints in nprofile, using fallback relay: ${DEFAULT_FALLBACK_RELAY}`
      );
      profileData.relays = [DEFAULT_FALLBACK_RELAY];
    }

    return profileData;
  } catch (error) {
    console.error(`Failed to decode nprofile: ${error}`);
    return null;
  }
}

/**
 * Decodes an naddr NIP-19 entity
 * @param naddrEntity The bech32-encoded naddr string
 * @returns The decoded naddr data or null if invalid
 */
export function decodeNaddr(naddrEntity: string): NaddrData | null {
  try {
    const { type, data } = nip19.decode(naddrEntity);
    if (type !== 'naddr') {
      console.error(`Expected naddr, got ${type}`);
      return null;
    }

    // Validate that the kind is a DVM announcement
    if (data.kind !== DVM_ANNOUNCEMENT_KIND) {
      console.error(`Expected kind ${DVM_ANNOUNCEMENT_KIND}, got ${data.kind}`);
      return null;
    }

    // Ensure we have at least one relay by using the fallback if necessary
    const addrData = data as NaddrData;
    if (!addrData.relays || addrData.relays.length === 0) {
      loggerDiscovery(
        `No relay hints in naddr, using fallback relay: ${DEFAULT_FALLBACK_RELAY}`
      );
      addrData.relays = [DEFAULT_FALLBACK_RELAY];
    }

    return addrData;
  } catch (error) {
    console.error(`Failed to decode naddr: ${error}`);
    return null;
  }
}
