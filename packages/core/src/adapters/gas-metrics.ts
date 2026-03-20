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
import { withAdvisoryLock, startEnricherLoop } from './enricher-utils.js'

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
  const result = await withAdvisoryLock(pool, 'gas_metrics', async (client) => {
    let computed = 0

    // Compute metrics for each period in a single pass per period
    const periods = [
      { key: '24h', interval: '24 hours' },
      { key: '7d', interval: '7 days' },
      { key: '30d', interval: '30 days' },
    ]

    for (const { key, interval } of periods) {
      const periodResult = await client.query(
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

      for (const row of periodResult.rows) {
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

    return computed
  })

  return result ?? 0
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
  return startEnricherLoop(
    'gas-metrics',
    fullConfig.intervalMs,
    async () => {
      const n = await computeGasMetrics(pool)
      return n > 0 ? n : null
    },
  )
}
