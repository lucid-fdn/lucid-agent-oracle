/**
 * Solana Identity — barrel export for the pluggable Solana identity system.
 */

export type { SolanaIdentityProvider, StagingEvent, SolanaIdentityIndexerConfig } from './types.js'
export { Sol8004Provider } from './sol8004-provider.js'
export { startSolanaIdentityIndexer, indexSolanaIdentityEvents } from './indexer.js'
