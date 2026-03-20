/**
 * Token Balance Enricher — polls Moralis for wallet token balances with USD pricing.
 *
 * Uses Moralis `getWalletTokenBalancesPrice` API to fetch current token balances
 * for agent wallets, then upserts into oracle_wallet_balances.
 *
 * Runs every 5 minutes, processing 20 wallets per cycle.
 * Advisory-locked to prevent concurrent execution across replicas.
 */
import type pg from 'pg'
import { withAdvisoryLock, fetchMoralis, startEnricherLoop } from './enricher-utils.js'
import { EVM_CHAINS, getMoralisChainParam } from './chains.js'

export interface BalanceEnricherConfig {
  apiKey: string
  intervalMs: number
  walletsPerCycle: number
}

const DEFAULT_CONFIG: BalanceEnricherConfig = {
  apiKey: '',
  intervalMs: 5 * 60_000, // 5 minutes
  walletsPerCycle: 20,
}

interface MoralisTokenBalance {
  token_address: string
  symbol: string
  name: string
  decimals: number
  balance: string
  usd_price: number | null
  usd_value: number | null
}

/** SQL IN-list for EVM chain IDs */
const EVM_CHAIN_IN = EVM_CHAINS.map(c => `'${c.id}'`).join(',')

/**
 * Fetch and store token balances for a batch of active agent wallets.
 */
export async function enrichWalletBalances(
  pool: pg.Pool,
  config: BalanceEnricherConfig,
): Promise<number> {
  if (!config.apiKey) return 0

  const result = await withAdvisoryLock(pool, 'balance_enricher', async (client) => {
    let enriched = 0

    // Select wallets that haven't been enriched recently (or ever)
    // Prioritise wallets with no balance data, then oldest updated
    const wallets = await client.query(
      `SELECT wm.agent_entity, wm.chain, wm.address
       FROM oracle_wallet_mappings wm
       LEFT JOIN oracle_wallet_balances wb
         ON wb.chain = wm.chain AND wb.wallet_address = LOWER(wm.address)
       WHERE wm.removed_at IS NULL
         AND wm.chain IN (${EVM_CHAIN_IN})
       GROUP BY wm.agent_entity, wm.chain, wm.address
       ORDER BY MIN(wb.updated_at) ASC NULLS FIRST
       LIMIT $1::int`,
      [config.walletsPerCycle],
    )

    for (const wallet of wallets.rows) {
      try {
        const address = (wallet.address as string).toLowerCase()
        const chain = wallet.chain as string
        const agentEntity = wallet.agent_entity as string

        const balances = await fetchMoralisBalances(config.apiKey, address, chain)

        for (const token of balances) {
          const balanceUsd = token.usd_value ?? 0

          await client.query(
            `INSERT INTO oracle_wallet_balances
             (agent_entity, chain, wallet_address, token_address, token_symbol, token_decimals, balance_raw, balance_usd, updated_at)
             VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::int, $7::text, $8::numeric, now())
             ON CONFLICT (chain, wallet_address, token_address) DO UPDATE
             SET agent_entity = EXCLUDED.agent_entity,
                 token_symbol = COALESCE(EXCLUDED.token_symbol, oracle_wallet_balances.token_symbol),
                 token_decimals = COALESCE(EXCLUDED.token_decimals, oracle_wallet_balances.token_decimals),
                 balance_raw = EXCLUDED.balance_raw,
                 balance_usd = EXCLUDED.balance_usd,
                 updated_at = now()`,
            [agentEntity, chain, address, token.token_address.toLowerCase(), token.symbol, token.decimals, token.balance, balanceUsd],
          )
          enriched++
        }

        // Rate limit: 250ms between wallets
        await new Promise((r) => setTimeout(r, 250))
      } catch (err) {
        console.error(`[balance-enricher] Error enriching ${(wallet.address as string).slice(0, 10)}:`, (err as Error).message)
      }
    }

    return enriched
  })

  return result ?? 0
}

async function fetchMoralisBalances(
  apiKey: string,
  address: string,
  chain: string,
): Promise<MoralisTokenBalance[]> {
  const chainParam = getMoralisChainParam(chain)
  const data = await fetchMoralis(`/wallets/${address}/tokens?chain=${chainParam}`, apiKey)
  if (!data) return []
  return (data as { result?: MoralisTokenBalance[] }).result ?? []
}

/**
 * Start the balance enricher on a timer.
 */
export function startBalanceEnricher(
  pool: pg.Pool,
  config: Partial<BalanceEnricherConfig> & { apiKey: string },
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  return startEnricherLoop(
    'balance-enricher',
    fullConfig.intervalMs,
    async () => {
      const n = await enrichWalletBalances(pool, fullConfig)
      return n > 0 ? n : null
    },
  )
}
