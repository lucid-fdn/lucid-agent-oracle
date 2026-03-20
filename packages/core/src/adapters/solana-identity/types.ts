/**
 * Solana Identity Provider Interface — pluggable abstraction for Solana agent registries.
 *
 * On EVM there is one identity standard (ERC-8004). On Solana there will be many:
 *   - sol8004 (QuantuLabs 8004-solana) — first provider
 *   - Future: Metaplex-based registries, SPL-based registries, etc.
 *
 * Each provider implements this interface, and the Solana Identity Indexer
 * orchestrates them all through a common polling loop.
 */
import type { HeliusTransaction } from '../helius.js'

/** A single staging event parsed from a Solana transaction. */
export interface StagingEvent {
  /** Provider source ID (e.g. 'sol8004', 'metaplex', 'spl-registry') */
  source: string
  /** Always 'solana' for Solana identity providers */
  chain: 'solana'
  /** Normalized event type (agent_registered, uri_updated, metadata_set, etc.) */
  event_type: string
  /** Pubkey of the agent asset (base58) */
  agent_id: string
  /** Event-specific payload — varies by event_type */
  payload: Record<string, any>
  /** Transaction signature */
  tx_hash: string
  /** Slot number (Solana's equivalent of block number) */
  block_number: number
}

/**
 * Common interface for Solana identity providers.
 *
 * Each provider knows how to parse transactions from its own program(s) into
 * a common staging event format. The indexer handles the transport (Helius polling)
 * and persistence (oracle_raw_adapter_events staging table).
 */
export interface SolanaIdentityProvider {
  /** Unique provider ID — used as the `source` field on staging events */
  readonly id: string
  /** Human-readable name for logging/observability */
  readonly name: string
  /** Solana program addresses this provider watches */
  readonly programIds: string[]
  /**
   * Parse a Helius enhanced transaction into zero or more staging events.
   *
   * Returns an empty array if the transaction is not relevant to this provider
   * (e.g. it's a different instruction type, or the program call failed).
   *
   * The indexer calls this for every transaction touching the provider's programs.
   */
  parseTransaction(tx: HeliusTransaction): StagingEvent[]
}

/**
 * Configuration for the Solana Identity Indexer orchestrator.
 */
export interface SolanaIdentityIndexerConfig {
  /** Helius API key for RPC and enhanced transaction API access */
  heliusApiKey: string
  /** List of identity providers to poll */
  providers: SolanaIdentityProvider[]
  /** Polling interval in milliseconds (default: 30_000) */
  pollIntervalMs: number
  /** Maximum transactions to fetch per poll per program (default: 50) */
  batchSize: number
}
