/**
 * Sol8004 Adapter — registers the 8004-solana agent registry with the adapter framework.
 *
 * Delegates to the same identity handler as ERC-8004 (the staging event shapes
 * are compatible), enabling Solana agent identity events to flow through
 * the same resolver pipeline.
 *
 * Events arrive in oracle_raw_adapter_events with source='sol8004' and chain='solana'.
 * The resolver poller dispatches them here based on source.
 */
import type { AdapterDefinition } from './adapter-types.js'
import { erc8004IdentityHandler } from './erc8004-adapter.js'
import { TOPICS } from '../clients/redpanda.js'

/** Sol8004 adapter — indexes Solana 8004 agent registry events */
export const sol8004Adapter: AdapterDefinition = {
  source: 'sol8004',
  version: 1,
  description: 'Solana 8004 Agent Registry (QuantuLabs)',
  topic: TOPICS.RAW_ERC8004,
  chains: ['solana'],
  identity: erc8004IdentityHandler,
}
