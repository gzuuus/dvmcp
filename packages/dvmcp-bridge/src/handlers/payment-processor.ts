import { loggerBridge } from '@dvmcp/commons/core';
import type { DvmcpBridgeConfig, MCPPricingConfig } from '../config-schema.js';
import type { KeyManager } from '@dvmcp/commons/nostr'; // KeyManager might still be needed for handlePaymentFlow
import type { RelayHandler } from '@dvmcp/commons/nostr'; // RelayHandler might still be needed for handlePaymentFlow
import { handlePaymentFlow } from './payment-handler';
import type { ResponsePublisher } from '../utils/response-publisher.js';
import {
  TAG_EVENT_ID,
  TAG_METHOD,
  TAG_PUBKEY,
  TAG_STATUS,
} from '@dvmcp/commons/core';

const DEFAULT_PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;

// TODO: handle variable price payment. Price definition should be a range '100-1000' then get the price based in the request. To get the price, we can add a basic function based on the length of the request. For more advanced pricing, we can use a separate mcp server configured to get the price by capability name and request
export class PaymentProcessor {
  constructor(
    private config: DvmcpBridgeConfig,
    private keyManager: KeyManager,
    private relayHandler: RelayHandler,
    private notificationPublisher: ResponsePublisher,
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
   * @param shouldEncrypt Whether to encrypt notifications
   * @returns A boolean indicating whether payment was successful or not required
   */
  async processPaymentIfRequired(
    pricing: MCPPricingConfig | undefined,
    capabilityName: string,
    capabilityType: 'tool' | 'prompt' | 'resource',
    eventId: string,
    pubkey: string,
    shouldEncrypt: boolean = false
  ): Promise<boolean> {
    const capabilityId = `${capabilityType}:${capabilityName}`;

    if (!pricing?.price) {
      loggerBridge(`No payment required for ${capabilityId}`);
      return true;
    }

    await this.notificationPublisher.publishNotification(
      JSON.stringify({
        method: 'notifications/progress',
        params: { message: 'processing payment' },
      }),
      pubkey,
      [
        [TAG_PUBKEY, pubkey],
        [TAG_EVENT_ID, eventId],
        [TAG_METHOD, 'notifications/progress'],
      ],
      shouldEncrypt
    );

    // Handle payment flow with timeout
    try {
      const paymentSuccessful = await Promise.race([
        handlePaymentFlow(
          pricing.price,
          capabilityId,
          eventId,
          pubkey,
          this.config,
          this.keyManager,
          this.relayHandler,
          pricing.unit || 'sats',
          this.paymentTimeoutMs,
          shouldEncrypt
        ),
        this.createPaymentTimeout(capabilityId),
      ]);

      if (!paymentSuccessful) {
        loggerBridge(`Payment failed or timed out for ${capabilityId}`);
        await this.notificationPublisher.publishNotification(
          'Payment failed or timed out',
          pubkey,
          [
            [TAG_STATUS, 'error'],
            [TAG_EVENT_ID, eventId],
            [TAG_PUBKEY, pubkey],
          ],
          shouldEncrypt
        );
        return false;
      }
      return true;
    } catch (error) {
      loggerBridge(`Payment error for ${capabilityId} - ${error}`);
      await this.notificationPublisher.publishNotification(
        error instanceof Error ? error.message : String(error),
        pubkey,
        [
          [TAG_STATUS, 'error'],
          [TAG_EVENT_ID, eventId],
          [TAG_PUBKEY, pubkey],
        ],
        shouldEncrypt
      );
      return false;
    }
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
