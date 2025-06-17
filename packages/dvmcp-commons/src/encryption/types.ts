/**
 * Encryption mode enumeration for clear configuration semantics
 */
export enum EncryptionMode {
  /** Encryption is disabled - only unencrypted communication */
  DISABLED = 'disabled',
  /** Encryption is optional - mirrors the format of received messages (encrypted->encrypted, unencrypted->unencrypted) */
  OPTIONAL = 'optional',
  /** Encryption is required - reject unencrypted communication */
  REQUIRED = 'required',
}

/**
 * Encryption configuration interface for NIP-17/NIP-59 support
 */
export interface EncryptionConfig {
  /**
   * Encryption mode - determines how encryption is handled
   * @default EncryptionMode.OPTIONAL
   */
  mode?: EncryptionMode;
}
