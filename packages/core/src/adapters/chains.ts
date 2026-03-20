/**
 * Chain Configuration — centralised chain definitions for all enrichers.
 *
 * Replaces hardcoded chain strings ('0x2105', '0x1') and chain filters
 * across enricher modules with a single source of truth.
 */

export interface ChainConfig {
  id: string                    // 'base', 'solana', 'eth'
  name: string                  // 'Base', 'Solana', 'Ethereum'
  type: 'evm' | 'solana'
  moralisChainParam: string | null  // '0x2105' for base, '0x1' for eth, null for solana
  explorerUrl: string
}

export const CHAINS: Record<string, ChainConfig> = {
  base: { id: 'base', name: 'Base', type: 'evm', moralisChainParam: '0x2105', explorerUrl: 'https://basescan.org' },
  eth: { id: 'eth', name: 'Ethereum', type: 'evm', moralisChainParam: '0x1', explorerUrl: 'https://etherscan.io' },
  solana: { id: 'solana', name: 'Solana', type: 'solana', moralisChainParam: null, explorerUrl: 'https://solscan.io' },
}

export const EVM_CHAINS = Object.values(CHAINS).filter(c => c.type === 'evm')
export const ALL_CHAIN_IDS = Object.keys(CHAINS)

export function getMoralisChainParam(chain: string): string {
  return CHAINS[chain]?.moralisChainParam ?? chain
}
