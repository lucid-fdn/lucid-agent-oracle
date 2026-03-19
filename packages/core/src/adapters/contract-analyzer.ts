/**
 * Contract Interaction Analyzer — tracks which contracts each agent
 * interacts with most frequently.
 *
 * Queries oracle_wallet_transactions grouped by counterparty address per agent.
 * Optionally resolves contract names via Moralis getContractMetadata.
 *
 * Runs every 15 minutes, advisory-locked.
 */
import type pg from 'pg'

export interface ContractAnalyzerConfig {
  moralisApiKey?: string
  intervalMs: number
  resolveNames: boolean
}

const DEFAULT_CONFIG: ContractAnalyzerConfig = {
  intervalMs: 15 * 60_000, // 15 minutes
  resolveNames: false,
}

export interface ContractInteraction {
  agent_entity: string
  chain: string
  contract_address: string
  contract_name: string | null
  interaction_count: number
  first_seen: string
  last_seen: string
}

/**
 * Analyze contract interactions for all agents.
 */
export async function analyzeContractInteractions(
  pool: pg.Pool,
  config: ContractAnalyzerConfig = DEFAULT_CONFIG,
): Promise<number> {
  const client = await pool.connect()
  let analyzed = 0

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext('contract_analyzer'))")
    if (!lockResult.rows[0].pg_try_advisory_lock) return 0

    // Group transactions by agent + counterparty
    const result = await client.query(
      `SELECT
         wt.agent_entity,
         wt.chain,
         wt.counterparty AS contract_address,
         COUNT(*)::int AS interaction_count,
         MIN(wt.event_timestamp) AS first_seen,
         MAX(wt.event_timestamp) AS last_seen
       FROM oracle_wallet_transactions wt
       WHERE wt.counterparty IS NOT NULL
         AND wt.counterparty != ''
       GROUP BY wt.agent_entity, wt.chain, wt.counterparty
       HAVING COUNT(*) >= 1`,
    )

    for (const row of result.rows) {
      try {
        await client.query(
          `INSERT INTO oracle_contract_interactions
           (agent_entity, chain, contract_address, interaction_count, first_seen, last_seen)
           VALUES ($1::text, $2::text, $3::text, $4::int, $5::timestamptz, $6::timestamptz)
           ON CONFLICT (agent_entity, chain, contract_address) DO UPDATE
           SET interaction_count = EXCLUDED.interaction_count,
               first_seen = LEAST(oracle_contract_interactions.first_seen, EXCLUDED.first_seen),
               last_seen = GREATEST(oracle_contract_interactions.last_seen, EXCLUDED.last_seen)`,
          [
            row.agent_entity,
            row.chain,
            row.contract_address,
            row.interaction_count,
            row.first_seen,
            row.last_seen,
          ],
        )
        analyzed++
      } catch (err) {
        console.error(`[contract-analyzer] Error upserting interaction:`, (err as Error).message)
      }
    }

    // Optionally resolve contract names via Moralis
    if (config.resolveNames && config.moralisApiKey) {
      await resolveContractNames(client, config.moralisApiKey)
    }

    await client.query("SELECT pg_advisory_unlock(hashtext('contract_analyzer'))")
  } finally {
    client.release()
  }

  return analyzed
}

/**
 * Resolve contract names for contracts that don't have names yet.
 * Limited to 10 per cycle to avoid rate limiting.
 */
async function resolveContractNames(
  client: pg.PoolClient,
  apiKey: string,
): Promise<void> {
  const unnamed = await client.query(
    `SELECT DISTINCT chain, contract_address
     FROM oracle_contract_interactions
     WHERE contract_name IS NULL
     LIMIT 10`,
  )

  for (const row of unnamed.rows) {
    try {
      const chain = row.chain as string
      const address = row.contract_address as string
      const name = await fetchContractName(apiKey, address, chain)

      if (name) {
        await client.query(
          `UPDATE oracle_contract_interactions
           SET contract_name = $1::text
           WHERE chain = $2::text AND contract_address = $3::text AND contract_name IS NULL`,
          [name, chain, address],
        )
      }

      // Rate limit: 250ms between lookups
      await new Promise((r) => setTimeout(r, 250))
    } catch (err) {
      console.error(`[contract-analyzer] Name resolve error:`, (err as Error).message)
    }
  }
}

/**
 * Fetch contract metadata from Moralis.
 */
async function fetchContractName(
  apiKey: string,
  address: string,
  chain: string,
): Promise<string | null> {
  const chainParam = chain === 'base' ? '0x2105' : chain === 'eth' ? '0x1' : chain
  const url = `https://deep-index.moralis.io/api/v2.2/erc20/metadata?chain=${chainParam}&addresses[]=${address}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'x-api-key': apiKey,
      },
      signal: controller.signal,
    })

    if (!res.ok) return null

    const data = await res.json() as Array<{ name?: string; symbol?: string }>
    if (Array.isArray(data) && data.length > 0) {
      return data[0].name ?? data[0].symbol ?? null
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Get top contract interactions for a specific agent.
 */
export async function getAgentContractInteractions(
  pool: pg.Pool,
  agentEntity: string,
  limit = 20,
): Promise<ContractInteraction[]> {
  const { rows } = await pool.query(
    `SELECT agent_entity, chain, contract_address, contract_name,
            interaction_count, first_seen, last_seen
     FROM oracle_contract_interactions
     WHERE agent_entity = $1::text
     ORDER BY interaction_count DESC
     LIMIT $2::int`,
    [agentEntity, limit],
  )

  return rows.map((r) => ({
    agent_entity: r.agent_entity as string,
    chain: r.chain as string,
    contract_address: r.contract_address as string,
    contract_name: (r.contract_name as string) ?? null,
    interaction_count: r.interaction_count as number,
    first_seen: String(r.first_seen),
    last_seen: String(r.last_seen),
  }))
}

/**
 * Start the contract analyzer on a timer.
 */
export function startContractAnalyzer(
  pool: pg.Pool,
  config: Partial<ContractAnalyzerConfig> = {},
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  let running = true

  const loop = async () => {
    while (running) {
      try {
        const n = await analyzeContractInteractions(pool, fullConfig)
        if (n > 0) console.log(`[contract-analyzer] Analyzed ${n} contract interactions`)
      } catch (err) {
        console.error('[contract-analyzer] Error:', (err as Error).message)
      }
      await new Promise((r) => setTimeout(r, fullConfig.intervalMs))
    }
  }

  loop()
  return { stop: () => { running = false } }
}
