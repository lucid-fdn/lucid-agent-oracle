/**
 * Token Registry — in-memory cache backed by oracle_token_registry table.
 * Resolves token metadata (symbol, decimals, USD price) for ERC-20 transfers.
 */
import type pg from 'pg'

export interface TokenInfo {
  chain: string
  address: string
  symbol: string
  decimals: number
  isStablecoin: boolean
  isBaseAsset: boolean
  lastKnownUsdPrice: number | null
}

export class TokenRegistry {
  private cache = new Map<string, TokenInfo>()
  private pendingResolution = new Set<string>()

  private key(chain: string, address: string): string {
    return `${chain}:${address.toLowerCase()}`
  }

  async loadFromDb(pool: pg.Pool): Promise<void> {
    const result = await pool.query(
      'SELECT chain, token_address, symbol, decimals, is_stablecoin, is_base_asset, last_known_usd_price FROM oracle_token_registry',
    )
    for (const row of result.rows) {
      this.cache.set(this.key(row.chain, row.token_address), {
        chain: row.chain,
        address: row.token_address,
        symbol: row.symbol ?? row.token_address.slice(0, 8),
        decimals: row.decimals ?? 18,
        isStablecoin: row.is_stablecoin ?? false,
        isBaseAsset: row.is_base_asset ?? false,
        lastKnownUsdPrice: row.last_known_usd_price ? Number(row.last_known_usd_price) : null,
      })
    }
  }

  lookup(chain: string, address: string): TokenInfo | null {
    return this.cache.get(this.key(chain, address)) ?? null
  }

  /**
   * Get USD value for an amount. Returns null if pricing unavailable.
   */
  getUsdValue(chain: string, address: string, rawAmount: string): number | null {
    const token = this.lookup(chain, address)
    if (!token) return null

    const amount = Number(rawAmount) / Math.pow(10, token.decimals)
    if (token.isStablecoin) return amount
    if (token.lastKnownUsdPrice) return amount * token.lastKnownUsdPrice
    return null
  }

  /**
   * Queue an unknown token for resolution. Does not block.
   */
  queueResolution(chain: string, address: string): void {
    const k = this.key(chain, address)
    if (!this.cache.has(k)) this.pendingResolution.add(k)
  }

  /**
   * Resolve all pending tokens via on-chain multicall (EVM only).
   * For each unknown token, calls symbol() and decimals().
   */
  async resolveEvmPending(pool: pg.Pool, rpcUrl: string): Promise<number> {
    const pending = Array.from(this.pendingResolution).filter((k) => k.startsWith('base:'))
    if (pending.length === 0) return 0

    let resolved = 0
    for (const k of pending.slice(0, 20)) {
      const [chain, address] = k.split(':')
      try {
        const { symbol, decimals } = await resolveEvmToken(rpcUrl, address)
        await pool.query(
          `INSERT INTO oracle_token_registry (chain, token_address, symbol, decimals)
           VALUES ($1, $2, $3, $4) ON CONFLICT (chain, token_address) DO UPDATE SET symbol = $3, decimals = $4`,
          [chain, address, symbol, decimals],
        )
        this.cache.set(k, {
          chain, address, symbol, decimals,
          isStablecoin: false, isBaseAsset: false, lastKnownUsdPrice: null,
        })
        this.pendingResolution.delete(k)
        resolved++
      } catch {
        // Skip — will retry next cycle
      }
    }
    return resolved
  }

  /**
   * Add or update a Solana token from Helius response data.
   */
  async upsertSolanaToken(pool: pg.Pool, mint: string, symbol: string, decimals: number): Promise<void> {
    const k = this.key('solana', mint)
    if (this.cache.has(k)) return

    await pool.query(
      `INSERT INTO oracle_token_registry (chain, token_address, symbol, decimals)
       VALUES ('solana', $1, $2, $3) ON CONFLICT (chain, token_address) DO NOTHING`,
      [mint, symbol, decimals],
    )
    this.cache.set(k, {
      chain: 'solana', address: mint, symbol, decimals,
      isStablecoin: false, isBaseAsset: false, lastKnownUsdPrice: null,
    })
    this.pendingResolution.delete(k)
  }
}

async function resolveEvmToken(rpcUrl: string, address: string): Promise<{ symbol: string; decimals: number }> {
  // ERC-20 symbol() selector: 0x95d89b41
  // ERC-20 decimals() selector: 0x313ce567
  const calls = [
    { to: address, data: '0x95d89b41' }, // symbol()
    { to: address, data: '0x313ce567' }, // decimals()
  ]

  const results = await Promise.all(
    calls.map(async (call) => {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [call, 'latest'],
        }),
      })
      const d = await res.json() as { result?: string }
      return d.result ?? '0x'
    }),
  )

  // Decode symbol (ABI-encoded string)
  let symbol = address.slice(0, 8)
  try {
    const hex = results[0].replace(/^0x/, '')
    if (hex.length >= 128) {
      const len = parseInt(hex.slice(64, 128), 16)
      const strHex = hex.slice(128, 128 + len * 2)
      symbol = Buffer.from(strHex, 'hex').toString('utf8').trim() || symbol
    }
  } catch { /* use fallback */ }

  // Decode decimals (uint8)
  let decimals = 18
  try {
    decimals = parseInt(results[1], 16)
    if (isNaN(decimals) || decimals > 77) decimals = 18
  } catch { /* use fallback */ }

  return { symbol, decimals }
}
