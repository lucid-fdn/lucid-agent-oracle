// wallet-activity.ts — USDC transfer indexer
//
// DISABLED: BaseUSDC contract removed from ponder.config.ts because indexing
// all USDC transfers is too expensive when the watchlist is empty.
// Re-enable when agent wallets exist in oracle_wallet_mappings.
//
// To re-enable:
// 1. Uncomment BaseUSDC in ponder.config.ts
// 2. Uncomment the handler below

// import { ponder } from '@/generated'
// import { writeWalletEvent } from './adapter-sink.js'
// import { computeEventId } from '@lucid/oracle-core'
//
// See git history for full implementation.
