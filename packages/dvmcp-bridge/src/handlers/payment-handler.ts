import { loggerBridge, TAG_INVOICE } from '@dvmcp/commons/core';
import {
  TAG_AMOUNT,
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_STATUS,
} from '@dvmcp/commons/core';
import type { DvmcpBridgeConfig } from '../config-schema.js';
import { RelayHandler, EventPublisher } from '@dvmcp/commons/nostr';
import type { KeyManager } from '@dvmcp/commons/nostr';
import { LightningAddress } from '@getalby/lightning-tools';
import type { Event } from 'nostr-tools/pure';
import type { SubCloser } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import { createNostrProvider } from '@dvmcp/commons/nostr';

/**
 * Handles the payment flow for a capability that requires payment
 * @param price The price to charge for the capability
 * @param capabilityName The name of the capability being paid for
 * @param eventId The original event ID that triggered this payment flow
 * @param pubkey The public key of the user making the request
 * @param config The bridge configuration
 * @param keyManager The key manager instance
 * @param relayHandler The relay handler instance
 * @param unit The payment unit (default: 'sats')
 * @param timeoutMs Payment timeout in milliseconds
 * @param shouldEncrypt Whether to encrypt notifications
 * @returns A boolean indicating whether payment was successful
 */
export async function handlePaymentFlow(
  price: string,
  capabilityName: string,
  eventId: string,
  pubkey: string,
  config: DvmcpBridgeConfig,
  keyManager: KeyManager,
  relayHandler: RelayHandler,
  unit: string = 'sats',
  timeoutMs?: number,
  shouldEncrypt: boolean = false
): Promise<boolean> {
  try {
    const eventPublisher = new EventPublisher(relayHandler, keyManager);

    // Generate zap request
    const zapRequest = await generateZapRequest(
      price,
      capabilityName,
      eventId,
      pubkey,
      config,
      keyManager
    );

    if (!zapRequest) {
      loggerBridge(`Failed to generate zap request for ${capabilityName}`);
      return false;
    }

    // Send payment required notification using centralized event publisher
    await eventPublisher.publishNotification(
      '',
      pubkey,
      [
        [TAG_STATUS, 'payment-required'],
        [TAG_AMOUNT, price, unit],
        [TAG_INVOICE, zapRequest.paymentRequest],
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, pubkey],
      ],
      shouldEncrypt
    );

    // Verify payment with timeout
    const paymentVerified = await verifyZapPayment(
      zapRequest.relays,
      zapRequest.paymentRequest,
      config,
      timeoutMs
    );

    // Send appropriate notification based on payment status using centralized event publisher
    const status = paymentVerified ? 'payment-accepted' : 'error';
    await eventPublisher.publishNotification(
      '',
      pubkey,
      [
        [TAG_STATUS, status],
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, pubkey],
      ],
      shouldEncrypt
    );

    return paymentVerified;
  } catch (error) {
    loggerBridge(
      `Payment flow error: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

interface ZapInvoiceResponse {
  paymentRequest: string;
  paymentHash: string;
  id?: string;
}

function subscribeToRelays(
  config: DvmcpBridgeConfig,
  relays: string[],
  onEvent: (event: Event) => void,
  filter: Filter
): SubCloser {
  const relayUrls = relays.length > 0 ? relays : config.nostr.relayUrls;
  const relayHandler = new RelayHandler(relayUrls);

  loggerBridge(`Setting up subscription on relays: ${relayUrls.join(', ')}`);

  const sub = relayHandler.subscribeToRequests((event) => {
    loggerBridge(
      `Event received(${event.kind}) from relay, id: ${event.id.slice(0, 12)}`
    );
    onEvent(event);
  }, filter);

  return {
    close: () => {
      sub.close();
      relayHandler.cleanup();
    },
  };
}

export async function generateZapRequest(
  amount: string,
  capabilityName: string,
  eventId: string,
  recipientPubkey: string,
  config: DvmcpBridgeConfig,
  keyManager: KeyManager
): Promise<
  | {
      paymentRequest: string;
      zapRequestId: string;
      relays: string[];
      nostrPubkey?: string;
    }
  | undefined
> {
  try {
    // Validate lightning configuration
    if (!config.lightning?.address) {
      loggerBridge(
        'No Lightning Address configured. Cannot generate zap request.'
      );
      return undefined;
    }

    // Fetch lightning address information
    const ln = new LightningAddress(config.lightning.address);
    await ln.fetch();

    // Verify nostr pubkey is available
    if (!ln.nostrPubkey) {
      loggerBridge(
        'Lightning Address does not have a nostr pubkey. Cannot create zap request.'
      );
      return undefined;
    }

    // Use dedicated zap relays if available, otherwise use default relays
    const relays = config.lightning?.zapRelays?.length
      ? config.lightning.zapRelays
      : config.nostr.relayUrls;

    // Generate invoice using Alby lightning tools
    const invoice = (await ln.zapInvoice(
      {
        satoshi: parseInt(amount, 10),
        comment: `Payment for ${capabilityName}`,
        relays,
        e: eventId,
        p: recipientPubkey,
      },
      { nostr: createNostrProvider(keyManager) }
    )) as ZapInvoiceResponse;

    const zapRequestId = invoice.id || invoice.paymentHash;
    loggerBridge(
      `Generated zap request: ${zapRequestId.slice(0, 10)}..., invoice: ${invoice.paymentRequest.slice(0, 15)}...`
    );

    return {
      paymentRequest: invoice.paymentRequest,
      zapRequestId,
      relays,
      nostrPubkey: ln.nostrPubkey,
    };
  } catch (error) {
    loggerBridge('Error generating zap request:', error);
    return undefined;
  }
}

export async function verifyZapPayment(
  relays: string[],
  paymentRequest: string,
  config: DvmcpBridgeConfig,
  timeoutMs: number = 5 * 60 * 1000 // Default to 5 minutes if not specified
): Promise<boolean> {
  return new Promise((resolve) => {
    // Use effective relays based on availability
    const zapRelays =
      relays.length > 0
        ? relays
        : config.lightning?.zapRelays?.length
          ? config.lightning.zapRelays
          : config.nostr.relayUrls;

    loggerBridge(
      `Subscribing to zap receipts on relays: ${zapRelays.join(', ')}`
    );

    // Track state to prevent multiple resolutions
    let isResolved = false;

    // Setup subscription to listen for zap receipts
    const subscription = subscribeToRelays(
      config,
      zapRelays,
      (event: Event) => {
        // Only process if not already resolved
        if (isResolved) return;

        try {
          // Check for matching bolt11 tag in zap receipt
          if (event.kind === 9735) {
            const bolt11Tag = event.tags.find(
              (tag) => tag[0] === 'bolt11'
            )?.[1];

            if (bolt11Tag === paymentRequest) {
              loggerBridge(`Payment verified: ${bolt11Tag.slice(0, 20)}...`);
              cleanup(true);
            }
          }
        } catch (error) {
          loggerBridge('Error processing zap receipt:', error);
        }
      },
      { kinds: [9735], since: Math.floor(Date.now() / 1000) - 10 }
    );

    // Set up timeout for automatic cleanup
    const timeoutId = setTimeout(() => {
      loggerBridge('Payment verification timeout reached');
      cleanup(false);
    }, timeoutMs);

    // Helper function to clean up resources and resolve
    function cleanup(success: boolean) {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeoutId);
      subscription.close();
      resolve(success);
    }
  });
}

export async function generateInvoice(
  config: DvmcpBridgeConfig,
  amount: string,
  description?: string
): Promise<
  | {
      paymentRequest: string;
      paymentHash: string;
    }
  | undefined
> {
  try {
    if (!config.lightning?.address) {
      loggerBridge('No Lightning Address configured. Cannot generate invoice.');
      return undefined;
    }

    const ln = new LightningAddress(config.lightning.address);
    await ln.fetch();

    const invoice = await ln.requestInvoice({
      satoshi: parseInt(amount, 10),
      comment: description || 'Payment for DVMCP',
    });

    return {
      paymentRequest: invoice.paymentRequest,
      paymentHash: invoice.paymentHash,
    };
  } catch (error) {
    loggerBridge('Error generating invoice:', error);
    return undefined;
  }
}
