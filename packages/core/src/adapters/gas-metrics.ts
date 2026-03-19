/**
 * Gas Metrics Computer — computes activity intensity metrics per agent
 * from transaction counts across time windows.
 *
 * NOTE: gas_used and gas_price columns exist in oracle_wallet_transactions
 * but are currently empty (TX harvester doesn't populate them yet).
 * For now, compute metrics from transaction COUNT only (activity intensity).
 *
 * Stores results in oracle_gas_metrics table (24h / 7d / 30d windows).
 * Runs every 15 minutes, advisory-locked.
 */
import type pg from 'pg'

export interface GasMetricsConfig {
  intervalMs: number
}

const DEFAULT_CONFIG: GasMetricsConfig = {
  intervalMs: 15 * 60_000, // 15 minutes
}

export interface GasMetricsResult {
  agent_entity: string
  period: string
  tx_count: number
  unique_contracts: number
  active_chains: string[]
}

/**
 * Compute and store gas/activity metrics for all agents.
 */
export async function computeGasMetrics(pool: pg.Pool): Promise<number> {
  const client = await pool.connect()
  let computed = 0

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext('gas_metrics'))")
    if (!lockResult.rows[0].pg_try_advisory_lock) return 0

    // Compute metrics for each period in a single pass per period
    const periods = [
      { key: '24h', interval: '24 hours' },
      { key: '7d', interval: '7 days' },
      { key: '30d', interval: '30 days' },
    ]

    for (const { key, interval } of periods) {
      const result = await client.query(
        `SELECT
           wt.agent_entity,
           COUNT(*)::int AS tx_count,
           COUNT(DISTINCT wt.counterparty)::int AS unique_contracts,
           ARRAY_AGG(DISTINCT wt.chain) AS active_chains
         FROM oracle_wallet_transactions wt
         WHERE wt.event_timestamp > now() - $1::text::interval
         GROUP BY wt.agent_entity`,
        [interval],
      )

      for (const row of result.rows) {
        await client.query(
          `INSERT INTO oracle_gas_metrics
           (agent_entity, period, tx_count, unique_contracts, active_chains, computed_at)
           VALUES ($1::text, $2::text, $3::int, $4::int, $5::text[], now())
           ON CONFLICT (agent_entity, period) DO UPDATE
           SET tx_count = EXCLUDED.tx_count,
               unique_contracts = EXCLUDED.unique_contracts,
               active_chains = EXCLUDED.active_chains,
               computed_at = now()`,
          [
            row.agent_entity,
            key,
            row.tx_count,
            row.unique_contracts,
            row.active_chains ?? [],
          ],
        )
        computed++
      }
    }

    await client.query("SELECT pg_advisory_unlock(hashtext('gas_metrics'))")
  } finally {
    client.release()
  }

  return computed
}

/**
 * Get gas metrics for a specific agent.
 */
export async function getAgentGasMetrics(
  pool: pg.Pool,
  agentEntity: string,
): Promise<GasMetricsResult[]> {
  const { rows } = await pool.query(
    `SELECT agent_entity, period, tx_count, unique_contracts, active_chains
     FROM oracle_gas_metrics
     WHERE agent_entity = $1::text
     ORDER BY CASE period WHEN '24h' THEN 1 WHEN '7d' THEN 2 WHEN '30d' THEN 3 END`,
    [agentEntity],
  )

  return rows.map((r) => ({
    agent_entity: r.agent_entity as string,
    period: r.period as string,
    tx_count: r.tx_count as number,
    unique_contracts: r.unique_contracts as number,
    active_chains: (r.active_chains as string[]) ?? [],
  }))
}

/**
 * Start the gas metrics computer on a timer.
 */
export function startGasMetrics(
  pool: pg.Pool,
  config?: Partial<GasMetricsConfig>,
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  let running = true

  const loop = async () => {
    while (running) {
      try {
        const n = await computeGasMetrics(pool)
        if (n > 0) console.log(`[gas-metrics] Computed ${n} agent metric rows`)
      } catch (err) {
        console.error('[gas-metrics] Error:', (err as Error).message)
      }
      await new Promise((r) => setTimeout(r, fullConfig.intervalMs))
    }
  }

  loop()
  return { stop: () => { running = false } }
}
