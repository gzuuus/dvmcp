/**
 * Encryption configuration interface for NIP-17/NIP-59 support
 */
export interface EncryptionConfig {
  /** Whether encryption is supported by this server/client */
  supportEncryption: boolean;
  /** Whether to force encrypted communication. If true, clear text requests will be rejected. */
  forceEncryption?: boolean;
}
// TODO: move this kinds to constants
/**
 * NIP-17 constants
 */
export const SEALED_DIRECT_MESSAGE_KIND = 13;
export const PRIVATE_DIRECT_MESSAGE_KIND = 14;
