import { describe, it, expect } from 'bun:test';
import { EncryptionManager } from './encryption-manager';
import { EncryptionMode } from './types';
import type { EncryptionConfig } from './types';

describe('EncryptionManager', () => {
  describe('Mode Configuration', () => {
    it('should use explicit mode when provided', () => {
      const config: EncryptionConfig = { mode: EncryptionMode.REQUIRED };
      const manager = new EncryptionManager(config);

      expect(manager.getEncryptionMode()).toBe(EncryptionMode.REQUIRED);
      expect(manager.isEncryptionRequired()).toBe(true);
      expect(manager.shouldAttemptEncryption()).toBe(true);
      expect(manager.canAcceptUnencrypted()).toBe(false);
    });

    it('should default to OPTIONAL when no config provided', () => {
      const manager = new EncryptionManager({});

      expect(manager.getEncryptionMode()).toBe(EncryptionMode.OPTIONAL);
      expect(manager.isEncryptionEnabled()).toBe(true);
      expect(manager.isEncryptionRequired()).toBe(false);
      expect(manager.shouldAttemptEncryption()).toBe(false);
      expect(manager.canAcceptUnencrypted()).toBe(true);
    });
  });

  describe('Encryption Modes', () => {
    it('should handle DISABLED mode correctly', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.DISABLED });

      expect(manager.isEncryptionEnabled()).toBe(false);
      expect(manager.isEncryptionRequired()).toBe(false);
      expect(manager.shouldAttemptEncryption()).toBe(false);
      expect(manager.canAcceptUnencrypted()).toBe(true);

      // Should never encrypt responses regardless of incoming format
      expect(manager.shouldEncryptResponse(true)).toBe(false);
      expect(manager.shouldEncryptResponse(false)).toBe(false);
    });

    it('should handle OPTIONAL mode correctly', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.OPTIONAL });

      expect(manager.isEncryptionEnabled()).toBe(true);
      expect(manager.isEncryptionRequired()).toBe(false);
      expect(manager.shouldAttemptEncryption()).toBe(false);
      expect(manager.canAcceptUnencrypted()).toBe(true);

      // Should mirror incoming message format
      expect(manager.shouldEncryptResponse(true)).toBe(true);
      expect(manager.shouldEncryptResponse(false)).toBe(false);
    });

    it('should handle REQUIRED mode correctly', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.REQUIRED });

      expect(manager.isEncryptionEnabled()).toBe(true);
      expect(manager.isEncryptionRequired()).toBe(true);
      expect(manager.shouldAttemptEncryption()).toBe(true);
      expect(manager.canAcceptUnencrypted()).toBe(false);

      // Should always encrypt responses regardless of incoming format
      expect(manager.shouldEncryptResponse(true)).toBe(true);
      expect(manager.shouldEncryptResponse(false)).toBe(true);
    });
  });

  describe('Message Format Mirroring', () => {
    it('should mirror encrypted incoming messages in OPTIONAL mode', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.OPTIONAL });

      // If we receive an encrypted message, respond with encrypted
      expect(manager.shouldEncryptResponse(true)).toBe(true);
    });

    it('should mirror unencrypted incoming messages in OPTIONAL mode', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.OPTIONAL });

      // If we receive an unencrypted message, respond with unencrypted
      expect(manager.shouldEncryptResponse(false)).toBe(false);
    });

    it('should always encrypt in REQUIRED mode regardless of incoming format', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.REQUIRED });

      expect(manager.shouldEncryptResponse(true)).toBe(true);
      expect(manager.shouldEncryptResponse(false)).toBe(true);
    });

    it('should never encrypt in DISABLED mode regardless of incoming format', () => {
      const manager = new EncryptionManager({ mode: EncryptionMode.DISABLED });

      expect(manager.shouldEncryptResponse(true)).toBe(false);
      expect(manager.shouldEncryptResponse(false)).toBe(false);
    });
  });
});
