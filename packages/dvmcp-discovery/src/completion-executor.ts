import { type Event as NostrEvent } from 'nostr-tools';
import { RelayHandler } from '@dvmcp/commons/nostr';
import { createKeyManager } from '@dvmcp/commons/nostr';
import { BaseExecutor } from './base-executor';
import type { ExecutionContext, Capability } from './base-interfaces';
import {
  REQUEST_KIND,
  RESPONSE_KIND,
  TAG_PUBKEY,
  TAG_METHOD,
  TAG_SERVER_IDENTIFIER,
} from '@dvmcp/commons/core';
import { PromptRegistry } from './prompt-registry';
import { ResourceRegistry } from './resource-registry';
import { ServerRegistry } from './server-registry';
import type {
  CompleteRequest,
  CompleteResult,
} from '@modelcontextprotocol/sdk/types.js';

export class CompletionExecutor extends BaseExecutor<
  Capability,
  CompleteRequest['params'],
  CompleteResult
> {
  constructor(
    relayHandler: RelayHandler,
    keyManager: ReturnType<typeof createKeyManager>,
    private promptRegistry: PromptRegistry,
    private resourceRegistry: ResourceRegistry,
    private serverRegistry: ServerRegistry
  ) {
    super(relayHandler, keyManager, promptRegistry);
  }

  /**
   * Find a resource template that matches the given URI
   * @param uri - URI to match against templates
   * @returns Template ID if found, undefined otherwise
   */
  private findResourceTemplateForUri(uri: string): string | undefined {
    const templates = this.resourceRegistry.listResourceTemplates();

    for (const template of templates) {
      const basePattern = template.uriTemplate.replace(/\{.*?\}/g, '');
      if (uri.startsWith(basePattern)) {
        return template.id;
      }
    }

    return undefined;
  }

  /**
   * Get completions for a prompt or resource argument
   * @param params - Completion request parameters
   * @returns Completion result with suggested values
   */
  public async getCompletions(
    params: CompleteRequest['params']
  ): Promise<CompleteResult> {
    const { ref } = params;
    let providerPubkey: string | undefined;
    let serverId: string | undefined;

    if (ref.type === 'ref/prompt') {
      const promptInfo = this.promptRegistry.getPromptInfo(ref.name);
      if (promptInfo) {
        providerPubkey = promptInfo.providerPubkey;
        serverId = promptInfo.serverId;
      }
    } else if (ref.type === 'ref/resource') {
      const templateId = this.findResourceTemplateForUri(ref.uri);
      if (templateId) {
        const template = this.resourceRegistry.getResourceTemplate(templateId);
        if (template) {
          const resourceInfo =
            this.resourceRegistry.getResourceTemplateInfo(templateId);
          if (resourceInfo) {
            providerPubkey = resourceInfo.providerPubkey;
            serverId = resourceInfo.serverId;
          }
        }
      } else {
        // If not a template, check regular resources
        const resourceInfo = this.resourceRegistry.getResourceInfo(ref.uri);
        if (resourceInfo) {
          providerPubkey = resourceInfo.providerPubkey;
          serverId = resourceInfo.serverId;
        }
      }
    }

    if (!providerPubkey || !serverId) {
      throw new Error(
        `Could not find provider information for reference: ${JSON.stringify(ref)}`
      );
    }

    if (!this.serverRegistry.supportsCompletions(serverId)) {
      throw new Error(`Server ${serverId} does not support completions`);
    }

    const dummyCapability: Capability = {
      id: 'completion',
      type: 'completion',
    };

    return this.execute(dummyCapability.id, dummyCapability, params);
  }

  /**
   * Create a completion request event
   * @param id - ID of the request (not used in this context)
   * @param item - Capability (not used in this context)
   * @param params - Completion request parameters
   * @returns Nostr event for the request
   */
  protected createRequest(
    id: string,
    item: Capability,
    params: CompleteRequest['params']
  ): NostrEvent {
    const { ref } = params;
    let providerPubkey: string | undefined;
    let serverId: string | undefined;

    if (ref.type === 'ref/prompt') {
      const promptInfo = this.promptRegistry.getPromptInfo(ref.name);
      if (promptInfo) {
        providerPubkey = promptInfo.providerPubkey;
        serverId = promptInfo.serverId;
        params.ref.name = promptInfo.item.name;
      }
    } else if (ref.type === 'ref/resource') {
      const templateId = this.findResourceTemplateForUri(ref.uri);
      if (templateId) {
        const template = this.resourceRegistry.getResourceTemplate(templateId);
        if (template) {
          const resourceInfo =
            this.resourceRegistry.getResourceTemplateInfo(templateId);
          if (resourceInfo) {
            providerPubkey = resourceInfo.providerPubkey;
            serverId = resourceInfo.serverId;
            params.ref.uri = ref.uri;
          }
        }
      } else {
        const resourceInfo = this.resourceRegistry.getResourceInfo(ref.uri);
        if (resourceInfo) {
          providerPubkey = resourceInfo.providerPubkey;
          serverId = resourceInfo.serverId;
          params.ref.uri = resourceInfo.item.uri;
        }
      }
    }

    if (!providerPubkey || !serverId) {
      throw new Error(
        `Could not find provider information for reference: ${JSON.stringify(ref)}`
      );
    }

    const requestTemplate = this.keyManager.createEventTemplate(REQUEST_KIND);
    const requestContent: CompleteRequest = {
      method: 'completion/complete',
      params,
    };

    requestTemplate.content = JSON.stringify(requestContent);
    requestTemplate.tags.push([TAG_METHOD, requestContent.method]);
    requestTemplate.tags.push([TAG_PUBKEY, providerPubkey]);
    requestTemplate.tags.push([TAG_SERVER_IDENTIFIER, serverId]);

    return this.keyManager.signEvent(requestTemplate);
  }

  protected async handleResponse(
    event: NostrEvent,
    context: ExecutionContext,
    resolve: (value: CompleteResult) => void,
    reject: (reason: Error) => void
  ): Promise<void> {
    if (event.kind === RESPONSE_KIND) {
      try {
        const response = JSON.parse(event.content);

        if (response.error) {
          this.cleanupExecution(context.executionId);
          reject(new Error(response.error.message || 'Unknown error'));
          return;
        }

        this.cleanupExecution(context.executionId);
        resolve(response);
      } catch (error) {
        this.cleanupExecution(context.executionId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
