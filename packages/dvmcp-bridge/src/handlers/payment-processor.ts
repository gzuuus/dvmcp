import { loggerBridge } from '@dvmcp/commons/core';
import {
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_STATUS,
  TAG_METHOD,
  NOTIFICATION_KIND,
} from '@dvmcp/commons/core';
import type { DvmcpBridgeConfig, MCPPricingConfig } from '../config-schema.js';
import type { RelayHandler } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import { handlePaymentFlow } from './payment-handler';

const DEFAULT_PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;

// TODO: handle variable price payment. Price definition should be a range '100-1000' then get the price based in the request. To get the price, we can add a basic function based on the length of the request. For more advanced pricing, we can use a separate mcp server configured to get the price by capability name and request
export class PaymentProcessor {
  constructor(
    private config: DvmcpBridgeConfig,
    private keyManager: KeyManager,
    private relayHandler: RelayHandler,
    private paymentTimeoutMs: number = DEFAULT_PAYMENT_TIMEOUT_MS
  ) {}

  /**
   * Process payment for a capability if required
   *
   * @param pricing The pricing information for the capability
   * @param capabilityName The name or identifier of the capability
   * @param capabilityType The type of capability (tool, prompt, resource)
   * @param eventId The original event ID that triggered this payment flow
   * @param pubkey The public key of the user making the request
   * @returns A boolean indicating whether payment was successful or not required
   */
  async processPaymentIfRequired(
    pricing: MCPPricingConfig | undefined,
    capabilityName: string,
    capabilityType: 'tool' | 'prompt' | 'resource',
    eventId: string,
    pubkey: string
  ): Promise<boolean> {
    await this.sendProcessingNotification(eventId, pubkey);
    const capabilityId = `${capabilityType}: ${capabilityName}`;

    if (!pricing?.price) {
      loggerBridge(`No payment required for ${capabilityId}`);
      return true;
    }

    // Handle payment flow with timeout
    try {
      return await Promise.race([
        handlePaymentFlow(
          pricing.price,
          capabilityId,
          eventId,
          pubkey,
          this.config,
          this.keyManager,
          this.relayHandler,
          pricing.unit || 'sats',
          this.paymentTimeoutMs
        ),
        this.createPaymentTimeout(capabilityId),
      ]);
    } catch (error) {
      loggerBridge(`Payment error for ${capabilityId} - ${error}`);
      await this.sendErrorNotification(
        eventId,
        pubkey,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  private async sendProcessingNotification(
    eventId: string,
    pubkey: string
  ): Promise<void> {
    const processingStatus = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(NOTIFICATION_KIND),
      content: JSON.stringify({
        method: 'notifications/progress',
        params: { message: 'processing' },
      }),
      tags: [
        [TAG_PUBKEY, pubkey],
        [TAG_EVENT_ID, eventId],
        [TAG_METHOD, 'notifications/progress'],
      ],
    });
    await this.relayHandler.publishEvent(processingStatus);
  }

  /**
   * Send a success notification to the client
   */
  async sendSuccessNotification(
    eventId: string,
    pubkey: string
  ): Promise<void> {
    const successStatus = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(NOTIFICATION_KIND),
      tags: [
        [TAG_STATUS, 'success'],
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await this.relayHandler.publishEvent(successStatus);
  }

  /**
   * Send an error notification to the client
   */
  async sendErrorNotification(
    eventId: string,
    pubkey: string,
    reason?: string
  ): Promise<void> {
    const errorStatus = this.keyManager.signEvent({
      ...this.keyManager.createEventTemplate(NOTIFICATION_KIND),
      content: reason || 'Unknown error',
      tags: [
        [TAG_STATUS, 'error'],
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await this.relayHandler.publishEvent(errorStatus);
  }

  private createPaymentTimeout(capabilityId: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        loggerBridge(
          `Payment timeout for ${capabilityId} after ${this.paymentTimeoutMs}ms`
        );
        resolve(false);
      }, this.paymentTimeoutMs);
    });
  }
}
