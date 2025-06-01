import { nip19 } from 'nostr-tools';
import { SERVER_ANNOUNCEMENT_KIND } from '@dvmcp/commons/core';
import type { AddressPointer, ProfilePointer } from 'nostr-tools/nip19';

/**
 * Decodes an nprofile NIP-19 entity
 * @param nprofileEntity The bech32-encoded nprofile string
 * @returns The decoded nprofile data or null if invalid
 */
export function decodeNprofile(nprofileEntity: string): ProfilePointer | null {
  try {
    const { type, data } = nip19.decode(nprofileEntity);
    if (type !== 'nprofile') {
      console.error(`Expected nprofile, got ${type}`);
      return null;
    }

    const profileData = data as ProfilePointer;
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
export function decodeNaddr(naddrEntity: string): AddressPointer | null {
  try {
    const { type, data } = nip19.decode(naddrEntity);
    if (type !== 'naddr') {
      console.error(`Expected naddr, got ${type}`);
      return null;
    }

    if (data.kind !== SERVER_ANNOUNCEMENT_KIND) {
      console.error(
        `Expected kind ${SERVER_ANNOUNCEMENT_KIND}, got ${data.kind}`
      );
      return null;
    }

    const addrData = data as AddressPointer;
    return addrData;
  } catch (error) {
    console.error(`Failed to decode naddr: ${error}`);
    return null;
  }
}

/**
 * Creates a unique identifier for a capability based on its name and provider's public key
 * @param capabilityName - The name of the capability
 * @param pubkey - The public key of the provider
 * @returns A unique identifier for the capability
 */
export function createCapabilityId(
  capabilityName: string,
  pubkey: string
): string {
  return `${capabilityName}_${pubkey.slice(0, 4)}`;
}

/**
 * Converts a string to a URL-friendly slug
 * @param input - The string to convert
 * @returns A URL-friendly slug
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
