/**
 * DeFi Position Enricher — polls Moralis for LP, staking, lending, farming positions.
 *
 * Uses Moralis `getDefiPositionsSummary` API to fetch DeFi positions
 * for agent wallets on Base, then upserts into oracle_defi_positions.
 *
 * Runs every 30 minutes, processing 10 wallets per cycle.
 * Advisory-locked to prevent concurrent execution across replicas.
 */
import type pg from 'pg'
import { withAdvisoryLock, fetchMoralis, startEnricherLoop } from './enricher-utils.js'
import { getMoralisChainParam } from './chains.js'

export interface DefiEnricherConfig {
  apiKey: string
  intervalMs: number
  batchSize: number
}

const DEFAULT_CONFIG: DefiEnricherConfig = {
  apiKey: '',
  intervalMs: 30 * 60_000, // 30 minutes
  batchSize: 10,
}

interface MoralisDefiToken {
  symbol: string
  address: string
  balance_formatted: string
  usd_value: number | null
}

interface MoralisDefiPosition {
  protocol_name: string
  protocol_id: string
  position: {
    label: string
    tokens: MoralisDefiToken[]
    total_usd_value: number | null
  }
}

/**
 * Map Moralis position label to a normalised position_type.
 */
function mapPositionType(label: string): string {
  const lower = label.toLowerCase()
  if (lower === 'liquidity pool' || lower === 'lp') return 'lp'
  if (lower === 'staking' || lower === 'staked') return 'staking'
  if (lower === 'lending' || lower === 'supply') return 'lending'
  if (lower === 'borrowing' || lower === 'borrow') return 'borrowing'
  if (lower === 'farming' || lower === 'farm') return 'farming'
  return 'lp'
}

/**
 * Fetch and store DeFi positions for a batch of active agent wallets on Base.
 */
export async function enrichDefiPositions(
  pool: pg.Pool,
  config: DefiEnricherConfig,
): Promise<number> {
  if (!config.apiKey) return 0

  const result = await withAdvisoryLock(pool, 'defi_enricher', async (client) => {
    let enriched = 0

    const wallets = await client.query(
      `SELECT wm.agent_entity, wm.chain, wm.address
       FROM oracle_wallet_mappings wm
       WHERE wm.removed_at IS NULL
         AND wm.chain = 'base'
       ORDER BY wm.created_at ASC
       LIMIT $1::int`,
      [config.batchSize],
    )

    for (const wallet of wallets.rows) {
      try {
        const address = (wallet.address as string).toLowerCase()
        const chain = wallet.chain as string
        const agentEntity = wallet.agent_entity as string

        const positions = await fetchMoralisDefiPositions(config.apiKey, address)

        for (const pos of positions) {
          const positionType = mapPositionType(pos.position.label)

          for (const token of pos.position.tokens) {
            await client.query(
              `INSERT INTO oracle_defi_positions
               (agent_entity, chain, wallet_address, protocol_name, position_type, token_address, token_symbol, balance_raw, balance_usd, apy, updated_at)
               VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::numeric, $10::numeric, now())
               ON CONFLICT (chain, wallet_address, protocol_name, position_type, token_address) DO UPDATE
               SET agent_entity = EXCLUDED.agent_entity,
                   token_symbol = COALESCE(EXCLUDED.token_symbol, oracle_defi_positions.token_symbol),
                   balance_raw = EXCLUDED.balance_raw,
                   balance_usd = EXCLUDED.balance_usd,
                   apy = EXCLUDED.apy,
                   updated_at = now()`,
              [
                agentEntity,
                chain,
                address,
                pos.protocol_name,
                positionType,
                token.address.toLowerCase(),
                token.symbol,
                token.balance_formatted,
                token.usd_value ?? 0,
                null, // apy not provided by this endpoint
              ],
            )
            enriched++
          }
        }

        // Rate limit: 300ms between wallets
        await new Promise((r) => setTimeout(r, 300))
      } catch (err) {
        console.error(`[defi-enricher] Error enriching ${(wallet.address as string).slice(0, 10)}:`, (err as Error).message)
      }
    }

    return enriched
  })

  return result ?? 0
}

async function fetchMoralisDefiPositions(
  apiKey: string,
  address: string,
): Promise<MoralisDefiPosition[]> {
  const chainParam = getMoralisChainParam('base')
  const data = await fetchMoralis(`/wallets/${address}/defi/positions?chain=${chainParam}`, apiKey)
  if (!data) return []
  return (data as { result?: MoralisDefiPosition[] }).result ?? []
}

/**
 * Start the DeFi position enricher on a timer.
 */
export function startDefiEnricher(
  pool: pg.Pool,
  config: Partial<DefiEnricherConfig> & { apiKey: string },
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  return startEnricherLoop(
    'defi-enricher',
    fullConfig.intervalMs,
    async () => {
      const n = await enrichDefiPositions(pool, fullConfig)
      return n > 0 ? n : null
    },
  )
}
