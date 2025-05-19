import {
  finalizeEvent,
  type Event,
  type VerifiedEvent,
} from 'nostr-tools/pure';
import { NWCWalletRequest, NWCWalletResponse } from 'nostr-tools/kinds';
import { hexToBytes } from '@noble/hashes/utils';
import { encrypt, decrypt } from 'nostr-tools/nip04';
import { loggerDiscovery } from '@dvmcp/commons/logger';
import type { DvmcpDiscoveryConfig } from './config-schema';
import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
// TODO: We can abstract this payment handler and the one in the bridge package to @commons
interface NWCConnection {
  pubkey: string;
  relay: string;
  secret: string;
}

interface NWCPayInvoiceRequest {
  method: 'pay_invoice';
  params: {
    invoice: string;
  };
}

interface NWCPayInvoiceResult {
  result_type: 'pay_invoice';
  error: {
    code: string;
    message: string;
  } | null;
  result: {
    preimage: string;
  } | null;
}

function parseConnectionString(connectionString: string): NWCConnection {
  if (!connectionString.startsWith('nostr+walletconnect:')) {
    throw new Error('invalid connection string');
  }

  const parts = connectionString.split('?');
  if (parts.length !== 2) {
    throw new Error('invalid connection string');
  }

  const [prefix, query] = parts;
  if (!prefix) {
    throw new Error('invalid connection string');
  }

  let pubkey = '';
  if (prefix.includes('://')) {
    const parts = prefix.split('://');
    if (parts.length > 1 && parts[1]) {
      pubkey = parts[1];
    }
  } else {
    const parts = prefix.split(':');
    if (parts.length > 1 && parts[1]) {
      pubkey = parts[1];
    }
  }

  if (!pubkey) {
    throw new Error('invalid connection string');
  }

  const params = new URLSearchParams();
  if (query) {
    query.split('&').forEach((param) => {
      const parts = param.split('=');
      if (parts.length >= 2 && parts[0]) {
        const key = parts[0];
        const value = parts[1];
        if (value) {
          params.append(key, decodeURIComponent(value));
        }
      }
    });
  }
  const relay = params.get('relay');
  const secret = params.get('secret');

  if (!relay || !secret) {
    throw new Error('invalid connection string');
  }

  return { pubkey, relay, secret };
}

/**
 * Create a NWC request event for paying an invoice
 * @param pubkey - The wallet's pubkey
 * @param secretKey - The secret for encryption
 * @param invoice - The Lightning invoice to pay
 * @returns A signed NWC request event
 */
export async function makeNwcRequestEvent(
  pubkey: string,
  secretKey: Uint8Array,
  invoice: string
): Promise<VerifiedEvent> {
  const content: NWCPayInvoiceRequest = {
    method: 'pay_invoice',
    params: {
      invoice,
    },
  };
  const encryptedContent = await encrypt(
    secretKey,
    pubkey,
    JSON.stringify(content)
  );
  const eventTemplate = {
    kind: NWCWalletRequest,
    created_at: Math.round(Date.now() / 1000),
    content: encryptedContent,
    tags: [['p', pubkey]],
  };

  return finalizeEvent(eventTemplate, secretKey);
}

/**
 * Payment handler for processing lightning invoices using NWC
 */
export class NWCPaymentHandler {
  private relayHandler: RelayHandler;
  private walletPubkey: string;
  private walletRelay: string;
  private secret: Uint8Array;

  /**
   * Create a new NWCPaymentHandler instance
   * @param config - The discovery configuration
   * @throws Error if NWC is not configured
   */
  constructor(config: DvmcpDiscoveryConfig) {
    if (!config.nwc?.connectionString) {
      throw new Error('NWC connection string not configured');
    }

    try {
      const { pubkey, relay, secret } = parseConnectionString(
        config.nwc.connectionString
      );

      this.walletPubkey = pubkey;
      this.walletRelay = relay;
      this.secret = hexToBytes(secret);

      this.relayHandler = new RelayHandler([this.walletRelay]);

      loggerDiscovery('NWC payment handler initialized successfully');
      loggerDiscovery('Using wallet pubkey:', this.walletPubkey);
      loggerDiscovery('Using wallet relay:', this.walletRelay);
    } catch (error) {
      loggerDiscovery('Failed to initialize NWC payment handler:', error);
      throw new Error(
        `Failed to initialize NWC payment handler: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Pay a Lightning invoice using NWC
   * @param invoice - The Lightning invoice to pay
   * @returns A promise that resolves to true when payment is successful
   */
  public async payInvoice(invoice: string): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      try {
        loggerDiscovery('Starting NWC payment process for invoice:', invoice);

        const paymentRequest = await makeNwcRequestEvent(
          this.walletPubkey,
          this.secret,
          invoice
        );
        loggerDiscovery('Payment request created with ID:', paymentRequest.id);

        const filter = {
          kinds: [NWCWalletResponse],
          '#e': [paymentRequest.id],
          since: Math.floor(Date.now() / 1000),
        };

        loggerDiscovery(
          'Setting up subscription to listen for payment response...'
        );

        const sub = this.relayHandler.subscribeToRequests((event: Event) => {
          loggerDiscovery('Received response event:', event.id);
          try {
            const decryptedContent = decrypt(
              this.secret,
              event.pubkey,
              event.content
            );
            const response = JSON.parse(
              decryptedContent
            ) as NWCPayInvoiceResult;

            loggerDiscovery('Payment response:', response);

            if (response.error) {
              loggerDiscovery('Payment failed:', response.error.message);
              sub.close();
              reject(new Error(response.error.message));
            } else if (response.result) {
              loggerDiscovery('Payment successful!');
              loggerDiscovery('Preimage:', response.result.preimage);
              sub.close();
              resolve(true);
            } else {
              loggerDiscovery('Unexpected response format:', response);
              sub.close();
              reject(new Error('Unexpected response format from wallet'));
            }
          } catch (error) {
            loggerDiscovery('Error decrypting response:', error);
            sub.close();
            reject(error);
          }
        }, filter);

        const timeoutId = setTimeout(() => {
          loggerDiscovery('Payment request timed out after 60 seconds');
          sub.close();
          reject(new Error('Payment request timed out'));
        }, 60000);

        loggerDiscovery('Publishing payment request to relay...');
        await this.relayHandler.publishEvent(paymentRequest);
        loggerDiscovery(
          'Payment request published successfully. Waiting for response...'
        );
      } catch (error) {
        loggerDiscovery('Error in NWC payment process:', error);
        reject(error);
      }
    });
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    this.relayHandler.cleanup();
    loggerDiscovery('NWC payment handler cleaned up');
  }
}
