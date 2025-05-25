# DVMCP Commons

Shared utilities for DVMCP packages, organized into tree-shakable modules for better performance and maintainability.

## Structure

The package is organized into three main modules:

### Core Module

```typescript
import { constants, logger, utils } from '@dvmcp/commons/core';
```

Provides essential utilities and constants used across the DVMCP ecosystem:

- Constants: DVMCP event kinds, tag names, and other shared constants
- Logger: Debug logging utilities for different DVMCP components
- Utils: General utility functions for working with DVMCP data
- Mock Server: Testing utilities for DVMCP servers

### Config Module

```typescript
import { makeConfigLoader, ConfigSchema } from '@dvmcp/commons/config';
```

Provides a reusable configuration system that can be used across multiple DVMCP packages:

- Config Types: TypeScript interfaces for configuration objects
- Config Utils: Utilities for working with configuration
- Config Loader: Functions for loading and validating configuration
- Config Generator: Tools for generating configuration files

### Nostr Module

```typescript
import { createKeyManager, RelayHandler } from '@dvmcp/commons/nostr';
```

Provides Nostr-related functionality for the DVMCP ecosystem:

- Key Manager: Utilities for managing Nostr keys and signing events
- Relay Handler: Functions for connecting to and interacting with Nostr relays
- Mock Relay: Testing utilities for Nostr relays

## Usage

To take advantage of tree-shaking, import only what you need from the specific modules:

```typescript
// Good - only imports what you need
import { logger } from '@dvmcp/commons/core';
import { createKeyManager } from '@dvmcp/commons/nostr';

// Avoid - imports everything
import { core, nostr } from '@dvmcp/commons';
const { logger } = core;
const { createKeyManager } = nostr;
```

This ensures that only the code you actually use is included in your bundle.
