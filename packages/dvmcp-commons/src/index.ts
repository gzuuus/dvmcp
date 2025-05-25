/**
 * DVMCP Commons Package
 *
 * This package provides shared utilities and functionality for the DVMCP ecosystem.
 * It is organized into tree-shakable modules for better performance and maintainability.
 */

// Re-export sub-packages for backward compatibility
// Users are encouraged to import directly from the sub-packages for better tree-shaking
export * as core from './core';
export * as config from './config';
export * as nostr from './nostr';
