import { RelayHandler } from '@dvmcp/commons/nostr/relay-handler';
import { CONFIG } from './config';

export const relayHandler = new RelayHandler(CONFIG.nostr.relayUrls);
