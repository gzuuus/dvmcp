import { expect, test, describe } from 'bun:test';
import { createKeyManager } from '@dvmcp/commons/nostr/key-manager';

describe('KeyManager', () => {
  const testPrivateKey =
    'd4d4d7aae7857054596c4c0976b22a73acac3a10d30bf56db35ee038bbf0dd44';
  const keyManager = createKeyManager(testPrivateKey);

  test('should create valid event template', () => {
    const template = keyManager.createEventTemplate(1);
    expect(template.kind).toBe(1);
    expect(template.pubkey).toBeDefined();
    expect(template.created_at).toBeNumber();
    expect(template.tags).toBeArray();
    expect(template.content).toBe('');
  });

  test('should sign events correctly', () => {
    const template = keyManager.createEventTemplate(1);
    const signedEvent = keyManager.signEvent(template);
    expect(signedEvent.id).toBeDefined();
    expect(signedEvent.sig).toBeDefined();
    expect(signedEvent.pubkey).toBe(keyManager.pubkey);
  });
});
