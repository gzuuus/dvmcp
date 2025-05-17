export function createCapabilityId(
  capabilityName: string,
  pubkey: string
): string {
  return `${capabilityName}_${pubkey.slice(0, 4)}`;
}
