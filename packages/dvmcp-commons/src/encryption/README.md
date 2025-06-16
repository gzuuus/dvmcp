# DVMCP Encryption Configuration

This document explains the simplified encryption configuration system for DVMCP packages.

## Overview

The DVMCP encryption system uses a clean `EncryptionMode` enum with three simple modes that provide clear, predictable behavior. The system follows a **message format mirroring** approach in optional mode, where responses match the encryption format of incoming messages.

## Encryption Modes

### `EncryptionMode.DISABLED`

- **Behavior**: Encryption is completely disabled
- **Use case**: Legacy systems or when encryption is not needed
- **Response behavior**: Always responds with unencrypted messages

### `EncryptionMode.OPTIONAL` (Default)

- **Behavior**: **Message format mirroring** - responds in the same format as received
- **Use case**: Most deployments - maximum compatibility and flexibility
- **Response behavior**:
  - Encrypted request → Encrypted response
  - Unencrypted request → Unencrypted response

### `EncryptionMode.REQUIRED`

- **Behavior**: Only encrypted communication is accepted
- **Use case**: High-security deployments
- **Response behavior**: Always responds with encrypted messages, rejects unencrypted requests

## Configuration

### Simple Configuration

```typescript
// Default - message format mirroring
{
  encryption: {
    mode: EncryptionMode.OPTIONAL; // or 'optional' as string
  }
}

// High security - encryption required
{
  encryption: {
    mode: EncryptionMode.REQUIRED; // or 'required' as string
  }
}

// Legacy compatibility - no encryption
{
  encryption: {
    mode: EncryptionMode.DISABLED; // or 'disabled' as string
  }
}
```

### Default Behavior

When no encryption configuration is provided, the system defaults to `EncryptionMode.OPTIONAL`, which provides the best balance of security and compatibility.
