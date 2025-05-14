# Enhanced Refactoring Plan: packages/dvmcp-discovery

**Date:** 2025-05-14  
**Version:** 2.0  
**Author:** Roo, AI Technical Leader

## 1. Introduction

This document presents a revised and enhanced refactoring plan for the `packages/dvmcp-discovery` package. The primary goal is to align this package with the DVMCP specification dated 2025-03-26, specifically focusing on its role as a client-side implementation for discovering and interacting with DVMs (Data Vending Machines) that expose MCP (Model Context Protocol) capabilities via Nostr. This refactor follows the completion of `packages/dvmcp-bridge` and leverages the updated `packages/dvmcp-commons` and the `@modelcontextprotocol/sdk`.

## 2. Current State Analysis

Based on the analysis of the existing codebase, the current `dvmcp-discovery` package has the following structure and components:

### 2.1. Core Components

1. **DiscoveryServer** (`src/discovery-server.ts`)
   - Central orchestration class managing tool discovery and execution
   - Currently uses older event kinds (`DVM_ANNOUNCEMENT_KIND`) 
   - Relies on a `RelayHandler` for Nostr communication
   - Manages a `ToolRegistry` and `ToolExecutor`

2. **ToolRegistry** (`src/tool-registry.ts`)
   - Stores discovered tools using a Map data structure
   - Registers tools with MCP server
   - Provides query methods to find tools by ID

3. **ToolExecutor** (`src/tool-executor.ts`)
   - Creates and sends tool execution requests
   - Handles responses and notifications
   - Uses older event kinds (`TOOL_REQUEST_KIND`, `TOOL_RESPONSE_KIND`, etc.)

4. **NWCPaymentHandler** (`src/nwc-payment.ts`)
   - Handles payment processing via Nostr Wallet Connect
   - Processes payment-related events

5. **Configuration** (`src/config.ts`)
   - Loads and merges configuration from multiple sources
   - Manages defaults, validation, and in-memory configuration

### 2.2. Key Issues Identified

1. **Event Kind Alignment**
   - The package uses deprecated event kinds like `DVM_ANNOUNCEMENT_KIND` (31990) instead of new ones defined in spec (31316-31319)
   - Tool request/response handling uses deprecated kinds 5910/6910 instead of new 25910/26910

2. **Tag Structure**
   - Current implementation doesn't properly utilize tags like `d`, `s`, `method`, and `cap` as required in the new spec

3. **Message Structure**
   - Current implementation doesn't consistently parse content as stringified MCP JSON-RPC messages
   - Doesn't leverage SDK types for message payloads

4. **Notifications**
   - Doesn't handle unified kind 21316 for MCP-compliant notifications and Nostr-specific notifications

5. **Resource and Prompt Support**
   - Limited focus on tools without proper structures for resources and prompts lists

## 3. Key Specification Adherence Requirements

The refactored `packages/dvmcp-discovery` must adhere to the following core principles and mechanisms outlined in the DVMCP specification:

### 3.1. Event Kinds

- Consume and properly process new kinds for:
  - Server announcements (`31316`)
  - Tools lists (`31317`)
  - Resources lists (`31318`)
  - Prompts lists (`31319`)
- Send requests using kind `25910`
- Process responses using kind `26910`
- Handle notifications using kind `21316`

### 3.2. Message Structure

- Parse Nostr event `content` as stringified MCP JSON-RPC messages using types from the SDK
- Utilize Nostr event `tags` for metadata (`d`, `s`, `p`, `e`, `method`, `cap`)

### 3.3. Public Discovery

- Subscribe to and process server and capability announcements
- Correlate capability lists with their servers using the `s` tag

### 3.4. Capability Operations

- Format and send properly structured requests for standard MCP methods
- Handle responses with results and standardized errors

### 3.5. Notification Handling

- Process MCP-compliant notifications (with `method` tag and JSON-RPC content)
- Process Nostr-specific notifications (with specific tags and empty content)
- Implement notification cancellation

## 4. Detailed Refactoring Tasks

### 4.1. Update Constants and Types (PRIORITY: HIGH)

**Affected files:** `src/constants.ts`

**Current code issues:**
```typescript
// Current constants.ts uses old event kinds
export const DVM_ANNOUNCEMENT_KIND = 31990;
export const TOOL_REQUEST_KIND = 5910;
export const TOOL_RESPONSE_KIND = 6910;
export const DVM_NOTICE_KIND = 7000;
```

**Refactoring actions:**
1. Remove deprecated constants
2. Import new constants from commons or define them locally:

```typescript
// Import from commons or define locally
import {
  SERVER_ANNOUNCEMENT_KIND,
  TOOLS_LIST_KIND,
  RESOURCES_LIST_KIND,
  PROMPTS_LIST_KIND,
  REQUEST_KIND,
  RESPONSE_KIND,
  NOTIFICATION_KIND
} from '@dvmcp/commons/constants';

// Define relevant tag constants if not in commons
export const TAG_SERVER_ID = 's';
export const TAG_METHOD = 'method';
export const TAG_CAPABILITY = 'cap';
```

### 4.2. Update Discovery Server Subscription Logic (PRIORITY: HIGH)

**Affected files:** `src/discovery-server.ts`

**Current code issues:**
```typescript
// Current implementation uses old kind constant
private async startDiscovery() {
  const filter: Filter = {
    kinds: [DVM_ANNOUNCEMENT_KIND],
    '#t': ['mcp'],
    since: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
  };
  // ...
}
```

**Refactoring actions:**
1. Update subscription filters to use new event kinds:

```typescript
private async startDiscovery() {
  const filter: Filter = {
    kinds: [
      SERVER_ANNOUNCEMENT_KIND,   // 31316
      TOOLS_LIST_KIND,           // 31317
      RESOURCES_LIST_KIND,       // 31318
      PROMPTS_LIST_KIND          // 31319
    ],
    since: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
  };
  // ...
  const events = await this.relayHandler.queryEvents(filter);
  // Group and process events by kind
  await this.processAnnouncementEvents(events);
}
```

2. Implement method to process events by kind:

```typescript
private async processAnnouncementEvents(events: Event[]) {
  // Group events by kind for processing
  const serverAnnouncements = events.filter(e => e.kind === SERVER_ANNOUNCEMENT_KIND);
  const toolsLists = events.filter(e => e.kind === TOOLS_LIST_KIND);
  const resourcesLists = events.filter(e => e.kind === RESOURCES_LIST_KIND);
  const promptsLists = events.filter(e => e.kind === PROMPTS_LIST_KIND);

  // Process server announcements first
  for (const event of serverAnnouncements) {
    await this.handleServerAnnouncement(event);
  }

  // Then process capability lists
  for (const event of toolsLists) {
    await this.handleToolsList(event);
  }
  
  for (const event of resourcesLists) {
    await this.handleResourcesList(event);
  }
  
  for (const event of promptsLists) {
    await this.handlePromptsList(event);
  }
}
```

### 4.3. Enhance ToolRegistry for Server and Capability Management (PRIORITY: HIGH)

**Affected files:** `src/tool-registry.ts`

**Current code issues:**
The current ToolRegistry only stores tools without properly tracking server information or correlating tools with servers.

**Refactoring actions:**
1. Add new data structures to store servers and capabilities:

```typescript
// New server storage
private servers: Map<
  string,  // Server ID from 'd' tag
  {
    pubkey: string;
    serverInfo: any;
    announcement: any;
    created_at: number;
  }
> = new Map();

// Enhanced tool storage with server correlation
private tools: Map<
  string,  // Tool ID
  {
    tool: Tool;
    serverId: string;  // Server ID this tool belongs to
    providerPubkey?: string;
    isBuiltIn?: boolean;
  }
> = new Map();

// Add similar maps for resources and prompts
private resources: Map<string, {...}> = new Map();
private prompts: Map<string, {...}> = new Map();
```

2. Add methods to register servers and correlate capabilities:

```typescript
/**
 * Register a server from an announcement
 */
public registerServer(serverId: string, pubkey: string, serverInfo: any, announcement: any, created_at: number): void {
  this.servers.set(serverId, {
    pubkey,
    serverInfo,
    announcement,
    created_at
  });
  loggerDiscovery(`Registered server ${serverId} from provider ${pubkey}`);
}

/**
 * Register a tool with server correlation
 */
public registerTool(
  toolId: string,
  tool: Tool,
  serverId: string,
  providerPubkey: string
): void {
  try {
    ToolSchema.parse(tool);
    this.tools.set(toolId, { 
      tool, 
      serverId,
      providerPubkey 
    });
    this.registerWithMcp(toolId, tool);
  } catch (error) {
    console.error(`Invalid MCP tool format for ${toolId}:`, error);
    throw error;
  }
}

/**
 * Get tools for a specific server
 */
public getToolsForServer(serverId: string): Tool[] {
  const result: Tool[] = [];
  for (const [id, info] of this.tools.entries()) {
    if (info.serverId === serverId) {
      result.push(info.tool);
    }
  }
  return result;
}

// Similar methods for resources and prompts
```

### 4.4. Update ToolExecutor for New Request/Response Format (PRIORITY: HIGH)

**Affected files:** `src/tool-executor.ts`

**Current code issues:**
```typescript
// Current implementation uses old kinds and doesn't properly use method tags
private createToolRequest(
  toolId: string,
  tool: Tool,
  params: unknown
): Event {
  const request = this.keyManager.createEventTemplate(TOOL_REQUEST_KIND);
  // ...
  request.tags.push(['c', 'execute-tool']);
  // ...
}
```

**Refactoring actions:**
1. Update request formatting to use new kind and proper tags:

```typescript
private createToolRequest(
  toolId: string,
  tool: Tool,
  params: unknown,
  serverId: string  // Add server ID parameter
): Event {
  // Use the new request kind
  const request = this.keyManager.createEventTemplate(REQUEST_KIND); // 25910
  
  const toolInfo = this.toolRegistry.getToolInfo(toolId);
  if (!toolInfo) throw new Error(`Tool ${toolId} not found`);
  
  // Format content as MCP JSON-RPC
  request.content = JSON.stringify({
    method: "tools/call",
    params: {
      name: tool.name,
      parameters: params
    }
  });
  
  // Add required tags
  request.tags.push(['method', 'tools/call']);  // Add method tag
  request.tags.push(['s', serverId]);           // Add server ID tag
  request.tags.push(['p', toolInfo.providerPubkey]);
  
  return this.keyManager.signEvent(request);
}
```

2. Update response handling to process new kind and format:

```typescript
private async handleToolResponse(
  event: Event,
  context: ExecutionContext,
  resolve: (value: unknown) => void,
  reject: (reason: Error) => void
): Promise<void> {
  if (event.kind === RESPONSE_KIND) { // 26910
    try {
      const responseData = JSON.parse(event.content);
      
      // Check for protocol error
      if (responseData.error) {
        clearTimeout(context.timeoutId);
        context.cleanup();
        reject(new Error(`Protocol error: ${responseData.error.message}`));
        return;
      }
      
      // Check for execution error
      if (responseData.result && responseData.result.isError === true) {
        clearTimeout(context.timeoutId);
        context.cleanup();
        reject(new Error(`Execution error: ${responseData.result.content?.text || 'Unknown error'}`));
        return;
      }
      
      // Handle successful result
      clearTimeout(context.timeoutId);
      context.cleanup();
      resolve(responseData.result.content || responseData.result);
    } catch (error) {
      clearTimeout(context.timeoutId);
      context.cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  } else if (event.kind === NOTIFICATION_KIND) { // 21316
    await this.handleNotification(event, context, resolve, reject);
  }
}
```

3. Add notification handling method:

```typescript
private async handleNotification(
  event: Event,
  context: ExecutionContext,
  resolve: (value: unknown) => void,
  reject: (reason: Error) => void
): Promise<void> {
  // Get method tag if present
  const methodTag = event.tags.find(t => t[0] === 'method')?.[1];
  
  // Check if this is a payment notification by checking status tag
  const statusTag = event.tags.find(t => t[0] === 'status')?.[1];
  if (statusTag === 'payment-required') {
    try {
      // Extract payment details and handle payment
      const invoice = event.tags.find(t => t[0] === 'invoice')?.[1];
      if (!invoice) {
        throw new Error('No invoice found in payment-required event');
      }
      
      if (!this.nwcPaymentHandler) {
        throw new Error('NWC payment handler not configured');
      }
      
      await this.nwcPaymentHandler.payInvoice(invoice);
      // Continue waiting for response after payment
    } catch (error) {
      clearTimeout(context.timeoutId);
      context.cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    return;
  }
  
  // Handle MCP-compliant notifications
  if (methodTag && event.content) {
    try {
      const notificationData = JSON.parse(event.content);
      
      // Handle progress notifications
      if (methodTag === 'progress') {
        // Process progress updates
        // Don't resolve/reject yet
        return;
      }
      
      // Handle other notification types as needed
    } catch (error) {
      loggerDiscovery(`Error parsing notification content: ${error}`);
    }
  }
}
```

### 4.5. Update NWC Payment Handler (PRIORITY: MEDIUM)

**Affected files:** `src/nwc-payment.ts`

**Refactoring actions:**
1. Update to handle notifications with kind 21316:

```typescript
// Update the filter to listen for notification kind
const filter = {
  kinds: [NOTIFICATION_KIND], // 21316
  '#e': [paymentRequest.id],
  since: Math.floor(Date.now() / 1000),
};
```

### 4.6. Implement Resource and Prompt Handling (PRIORITY: MEDIUM)

**Affected files:** New files or expanded functionality in existing files

**Refactoring actions:**
1. Implement resource list handling:

```typescript
/**
 * Handle a resources list announcement
 * @param event - Resources list event (kind 31318)
 */
private async handleResourcesList(event: Event): Promise<void> {
  try {
    // Extract server ID from s tag
    const serverId = event.tags.find(t => t[0] === 's')?.[1];
    if (!serverId) {
      loggerDiscovery('Resources list missing server ID (s tag)');
      return;
    }
    
    // Check if we know about this server
    if (!this.toolRegistry.hasServer(serverId)) {
      loggerDiscovery(`Unknown server ID in resources list: ${serverId}`);
      return;
    }
    
    // Parse resources
    const resources = JSON.parse(event.content);
    if (!Array.isArray(resources)) {
      loggerDiscovery('Invalid resources list format');
      return;
    }
    
    // Register resources with the tool registry
    for (const resource of resources) {
      const resourceId = `${resource.name || resource.uri}_${event.pubkey.slice(0, 4)}`;
      this.toolRegistry.registerResource(resourceId, resource, serverId, event.pubkey);
    }
  } catch (error) {
    console.error('Error processing resources list:', error);
  }
}
```

2. Implement similar logic for prompts list handling

### 4.7. Add Support for SDK Integration (PRIORITY: MEDIUM)

**Affected files:** Multiple

**Refactoring actions:**
1. Import and use SDK types:

```typescript
import { Tool, ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
```

2. Evaluate using SDK client components:

```typescript
// Consider using Client class from SDK to simplify request handling
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Initialize client with appropriate transport
const mcpClient = new Client();

// Use client for request/response correlation
const response = await mcpClient.call('tools/list', { cursor: null });
```

## 5. API Modifications

### 5.1. Discovery Server API Updates

1. **New Methods:**
   ```typescript
   /**
    * List all servers discovered on the network
    * @returns Array of server information objects
    */
   public async listServers(): Promise<ServerInfo[]>
   
   /**
    * List all resources for a specific server
    * @param serverId - Server identifier
    * @returns Array of resources
    */
   public async listResources(serverId: string): Promise<Resource[]>
   
   /**
    * List all prompts for a specific server
    * @param serverId - Server identifier
    * @returns Array of prompts
    */
   public async listPrompts(serverId: string): Promise<Prompt[]>
   
   /**
    * Execute a resource read operation
    * @param resourceId - Resource identifier
    * @returns Resource content
    */
   public async readResource(resourceId: string): Promise<unknown>
   ```

2. **Modified Methods:**
   ```typescript
   /**
    * Execute a tool (updated signature with serverId)
    * @param serverId - Server identifier
    * @param toolName - Tool name
    * @param params - Tool parameters
    * @returns Tool execution result
    */
   public async executeTool(
     serverId: string,
     toolName: string,
     params: unknown
   ): Promise<unknown>
   ```