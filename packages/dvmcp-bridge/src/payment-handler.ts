import { LightningAddress } from '@getalby/lightning-tools';
import { loggerBridge } from '@dvmcp/commons/logger';
import type { Event } from 'nostr-tools/pure';
import type { SubCloser } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools';
import {
  createNostrProvider,
  type KeyManager,
} from '@dvmcp/commons/nostr/key-manager';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { DvmcpBridgeConfig } from './config-schema';

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
