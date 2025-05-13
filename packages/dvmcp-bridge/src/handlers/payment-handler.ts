import { loggerBridge } from '@dvmcp/commons/logger';
import {
  TAG_AMOUNT,
  TAG_EVENT_ID,
  TAG_PUBKEY,
  TAG_STATUS,
  NOTIFICATION_KIND,
} from '@dvmcp/commons/constants';
import type { DvmcpBridgeConfig } from '../config-schema.js';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import type { KeyManager } from '@dvmcp/commons/nostr/key-manager';
import { LightningAddress } from '@getalby/lightning-tools';
import type { Event } from 'nostr-tools/pure';
import type { SubCloser } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import { createNostrProvider } from '@dvmcp/commons/nostr/key-manager';

/**
 * Handles the payment flow for a capability that requires payment
 * @param price The price to charge for the capability
 * @param capabilityName The name of the capability being paid for
 * @param eventId The original event ID that triggered this payment flow
 * @param pubkey The public key of the user making the request
 * @param config The bridge configuration
 * @param keyManager The key manager instance
 * @param relayHandler The relay handler instance
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
  unit: string = 'sats'
): Promise<boolean> {
  try {
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

    // Send payment required notification
    const paymentRequiredStatus = keyManager.signEvent({
      ...keyManager.createEventTemplate(NOTIFICATION_KIND),
      tags: [
        [TAG_STATUS, 'payment-required'],
        [TAG_AMOUNT, price, unit],
        ['invoice', zapRequest.paymentRequest],
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await relayHandler.publishEvent(paymentRequiredStatus);

    // Verify payment
    const paymentVerified = await verifyZapPayment(
      zapRequest.relays,
      zapRequest.paymentRequest,
      config
    );

    if (!paymentVerified) {
      // Send payment failed notification
      const paymentFailedStatus = keyManager.signEvent({
        ...keyManager.createEventTemplate(NOTIFICATION_KIND),
        tags: [
          [TAG_STATUS, 'error'],
          [TAG_EVENT_ID, eventId],
          [TAG_PUBKEY, pubkey],
        ],
      });
      await relayHandler.publishEvent(paymentFailedStatus);
      return false;
    }

    // Send payment accepted notification
    const paymentAcceptedStatus = keyManager.signEvent({
      ...keyManager.createEventTemplate(NOTIFICATION_KIND),
      tags: [
        [TAG_STATUS, 'payment-accepted'],
        [TAG_EVENT_ID, eventId],
        [TAG_PUBKEY, pubkey],
      ],
    });
    await relayHandler.publishEvent(paymentAcceptedStatus);

    return true;
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
  toolName: string,
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
    if (!config.lightning?.address) {
      loggerBridge(
        'No Lightning Address configured. Cannot generate zap request.'
      );
      return undefined;
    }

    const ln = new LightningAddress(config.lightning.address);
    await ln.fetch();

    if (!ln.nostrPubkey) {
      loggerBridge(
        'Lightning Address does not have a nostr pubkey. Cannot create zap request.'
      );
      return undefined;
    }
    loggerBridge(`Lightning Address found: ${ln.nostrPubkey}`);
    const relays = config.lightning?.zapRelays?.length
      ? config.lightning.zapRelays
      : config.nostr.relayUrls;

    const zapArgs = {
      satoshi: parseInt(amount, 10),
      comment: `Payment for ${toolName} tool`,
      relays: relays,
      e: eventId,
      p: recipientPubkey,
    };

    const zapOptions = {
      nostr: createNostrProvider(keyManager),
    };

    const invoice = (await ln.zapInvoice(
      zapArgs,
      zapOptions
    )) as ZapInvoiceResponse;

    const zapRequestId = invoice.id || invoice.paymentHash;
    loggerBridge(
      `Generated zap request with ID: ${zapRequestId}, and invoice: ${invoice.paymentRequest}`
    );

    return {
      paymentRequest: invoice.paymentRequest,
      zapRequestId: zapRequestId,
      relays: relays,
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
  config: DvmcpBridgeConfig
): Promise<boolean> {
  return new Promise((resolve) => {
    const filter: Filter = {
      kinds: [9735],
      since: Math.floor(Date.now() / 1000) - 10,
    };
    const zapRelays =
      relays.length > 0
        ? relays
        : config.lightning?.zapRelays?.length
          ? config.lightning.zapRelays
          : config.nostr.relayUrls;

    loggerBridge(
      `Subscribing to zap receipts on relays: ${zapRelays.join(', ')}`
    );

    const subscription = subscribeToRelays(
      config,
      zapRelays,
      (event: Event) => {
        try {
          if (event.kind === 9735) {
            const bolt11Tag = event.tags.find(
              (tag) => tag[0] === 'bolt11'
            )?.[1];

            if (bolt11Tag) {
              if (bolt11Tag === paymentRequest) {
                loggerBridge(
                  `Found matching bolt11 tag in zap receipt: ${bolt11Tag.slice(0, 20)}...`
                );
                subscription.close();
                resolve(true);
                return;
              }
            }
          }
        } catch (error) {
          loggerBridge('Error processing zap receipt:', error);
        }
      },
      filter
    );
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
