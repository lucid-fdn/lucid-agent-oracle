/**
 * Graph Materializer — pre-computes the agent network graph every 5 minutes.
 *
 * Produces a single JSON blob (GraphSnapshot) and stores it in:
 *   1. Redis: `oracle:graph:snapshot` with 10-minute TTL
 *   2. Postgres: `oracle_economy_snapshots.graph_snapshot_json` for persistence
 *
 * Advisory-locked to prevent concurrent execution across replicas.
 * Uses the same enricher patterns as other background jobs (withAdvisoryLock, startEnricherLoop).
 */
import type pg from 'pg'
import { withAdvisoryLock, startEnricherLoop } from './enricher-utils.js'

// ── Types ──────────────────────────────────────────────────────

export interface GraphSnapshotNode {
  id: string
  name: string | null
  chain: string
  reputation: number | null
  txCount: number
  portfolioUsd: number
}

export interface GraphSnapshotLink {
  source: string
  target: string
  value: number
  usd: number
}

export interface GraphSnapshotMeta {
  totalAgents: number
  totalConnections: number
  chainCounts: Record<string, number>
  computedAt: string
}

export interface GraphSnapshot {
  nodes: GraphSnapshotNode[]
  links: GraphSnapshotLink[]
  meta: GraphSnapshotMeta
}

export interface GraphMaterializerConfig {
  intervalMs: number
  edgeLimit: number
}

const DEFAULT_CONFIG: GraphMaterializerConfig = {
  intervalMs: 5 * 60_000, // 5 minutes
  edgeLimit: 500,
}

// ── Redis key ──────────────────────────────────────────────────

export const GRAPH_SNAPSHOT_REDIS_KEY = 'oracle:graph:snapshot'
const GRAPH_SNAPSHOT_TTL_SECONDS = 600 // 10 minutes

// ── Core computation ───────────────────────────────────────────

/**
 * Compute a full graph snapshot from the database.
 * Runs the same JOINed SQL that `getAgentGraph` uses, but with portfolio data.
 */
export async function computeGraphSnapshot(
  pool: pg.Pool,
  edgeLimit = 500,
): Promise<GraphSnapshot | null> {
  return await withAdvisoryLock(pool, 'graph_materializer', async (client) => {
    // First try agent-to-agent connections
    const { rows: agentRows } = await client.query(
      `SELECT
         wt.agent_entity AS from_agent,
         wm2.agent_entity AS to_agent,
         COUNT(*)::int AS tx_count,
         COALESCE(SUM(wt.amount_usd), 0)::numeric AS total_usd,
         ae1.display_name AS from_name,
         ae2.display_name AS to_name,
         (SELECT wmc1.chain FROM oracle_wallet_mappings wmc1
          WHERE wmc1.agent_entity = wt.agent_entity AND wmc1.removed_at IS NULL LIMIT 1) AS from_chain,
         (SELECT wmc2.chain FROM oracle_wallet_mappings wmc2
          WHERE wmc2.agent_entity = wm2.agent_entity AND wmc2.removed_at IS NULL LIMIT 1) AS to_chain,
         CASE WHEN ae1.reputation_json IS NOT NULL
              AND (ae1.reputation_json->>'avg_value')::numeric <= 100
              THEN (ae1.reputation_json->>'avg_value')::numeric ELSE NULL END AS from_reputation,
         CASE WHEN ae2.reputation_json IS NOT NULL
              AND (ae2.reputation_json->>'avg_value')::numeric <= 100
              THEN (ae2.reputation_json->>'avg_value')::numeric ELSE NULL END AS to_reputation,
         (SELECT COALESCE(SUM(wb1.balance_usd), 0)
          FROM oracle_wallet_balances wb1
          WHERE wb1.agent_entity = wt.agent_entity
            AND wb1.balance_usd > 0 AND wb1.balance_usd < 100000)::numeric AS from_portfolio_usd,
         (SELECT COALESCE(SUM(wb2.balance_usd), 0)
          FROM oracle_wallet_balances wb2
          WHERE wb2.agent_entity = wm2.agent_entity
            AND wb2.balance_usd > 0 AND wb2.balance_usd < 100000)::numeric AS to_portfolio_usd
       FROM oracle_wallet_transactions wt
       JOIN oracle_wallet_mappings wm2
         ON LOWER(wt.counterparty) = LOWER(wm2.address)
         AND wm2.chain = wt.chain
         AND wm2.removed_at IS NULL
       LEFT JOIN oracle_agent_entities ae1 ON ae1.id = wt.agent_entity
       LEFT JOIN oracle_agent_entities ae2 ON ae2.id = wm2.agent_entity
       WHERE wt.direction = 'outbound'
       GROUP BY wt.agent_entity, wm2.agent_entity, ae1.display_name, ae2.display_name,
                ae1.reputation_json, ae2.reputation_json
       ORDER BY tx_count DESC
       LIMIT $1::int`,
      [edgeLimit],
    )

    let edges = agentRows

    // Fallback: agent → top counterparty connections (same as getAgentGraph)
    if (edges.length === 0) {
      const { rows: counterpartyRows } = await client.query(
        `SELECT
           wt.agent_entity AS from_agent,
           wt.counterparty AS to_agent,
           COUNT(*)::int AS tx_count,
           COALESCE(SUM(wt.amount_usd), 0)::numeric AS total_usd,
           ae1.display_name AS from_name,
           NULL AS to_name,
           (SELECT wmc.chain FROM oracle_wallet_mappings wmc
            WHERE wmc.agent_entity = wt.agent_entity AND wmc.removed_at IS NULL LIMIT 1) AS from_chain,
           wt.chain AS to_chain,
           CASE WHEN ae1.reputation_json IS NOT NULL
                AND (ae1.reputation_json->>'avg_value')::numeric <= 100
                THEN (ae1.reputation_json->>'avg_value')::numeric ELSE NULL END AS from_reputation,
           NULL::numeric AS to_reputation,
           (SELECT COALESCE(SUM(wb1.balance_usd), 0)
            FROM oracle_wallet_balances wb1
            WHERE wb1.agent_entity = wt.agent_entity
              AND wb1.balance_usd > 0 AND wb1.balance_usd < 100000)::numeric AS from_portfolio_usd,
           0::numeric AS to_portfolio_usd
         FROM oracle_wallet_transactions wt
         LEFT JOIN oracle_agent_entities ae1 ON ae1.id = wt.agent_entity
         WHERE wt.direction = 'outbound'
           AND wt.counterparty IS NOT NULL
         GROUP BY wt.agent_entity, wt.counterparty, wt.chain, ae1.display_name, ae1.reputation_json
         HAVING COUNT(*) >= 2
         ORDER BY tx_count DESC
         LIMIT $1::int`,
        [edgeLimit],
      )
      edges = counterpartyRows
    }

    // Build nodes from edges
    const nodeMap = new Map<string, GraphSnapshotNode>()

    for (const e of edges) {
      const fromId = e.from_agent as string
      const toId = e.to_agent as string

      if (!nodeMap.has(fromId)) {
        nodeMap.set(fromId, {
          id: fromId,
          name: (e.from_name as string) ?? null,
          chain: (e.from_chain as string) ?? 'base',
          reputation: e.from_reputation != null ? Number(e.from_reputation) : null,
          txCount: 0,
          portfolioUsd: Number(e.from_portfolio_usd ?? 0),
        })
      }

      if (!nodeMap.has(toId)) {
        nodeMap.set(toId, {
          id: toId,
          name: (e.to_name as string) ?? null,
          chain: (e.to_chain as string) ?? 'base',
          reputation: e.to_reputation != null ? Number(e.to_reputation) : null,
          txCount: 0,
          portfolioUsd: Number(e.to_portfolio_usd ?? 0),
        })
      }

      const txCount = e.tx_count as number
      nodeMap.get(fromId)!.txCount += txCount
      nodeMap.get(toId)!.txCount += txCount
    }

    const nodes = Array.from(nodeMap.values())
    const links: GraphSnapshotLink[] = edges.map((e) => ({
      source: e.from_agent as string,
      target: e.to_agent as string,
      value: e.tx_count as number,
      usd: Number(e.total_usd ?? 0),
    }))

    // Chain distribution
    const chainCounts: Record<string, number> = {}
    for (const n of nodes) {
      chainCounts[n.chain] = (chainCounts[n.chain] ?? 0) + 1
    }

    const snapshot: GraphSnapshot = {
      nodes,
      links,
      meta: {
        totalAgents: nodes.length,
        totalConnections: links.length,
        chainCounts,
        computedAt: new Date().toISOString(),
      },
    }

    return snapshot
  })
}

// ── Redis storage ──────────────────────────────────────────────

/**
 * Store a snapshot in Redis with TTL.
 * Accepts a Redis client (the `redis` npm package client type).
 */
export async function storeSnapshotInRedis(
  redis: { set(key: string, value: string, options?: { EX: number }): Promise<unknown> } | null,
  snapshot: GraphSnapshot,
): Promise<void> {
  if (!redis) return
  await redis.set(
    GRAPH_SNAPSHOT_REDIS_KEY,
    JSON.stringify(snapshot),
    { EX: GRAPH_SNAPSHOT_TTL_SECONDS },
  )
}

/**
 * Read a snapshot from Redis. Returns null on miss or error.
 */
export async function readSnapshotFromRedis(
  redis: { get(key: string): Promise<string | null> } | null,
): Promise<GraphSnapshot | null> {
  if (!redis) return null
  try {
    const raw = await redis.get(GRAPH_SNAPSHOT_REDIS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as GraphSnapshot
  } catch {
    return null
  }
}

// ── Postgres persistence ───────────────────────────────────────

/**
 * Persist the snapshot in the most recent economy_snapshots row
 * (adds/updates graph_snapshot_json column).
 */
async function persistSnapshotInDb(
  client: pg.PoolClient | pg.Pool,
  snapshot: GraphSnapshot,
): Promise<void> {
  try {
    await client.query(
      `UPDATE oracle_economy_snapshots
       SET graph_snapshot_json = $1::jsonb
       WHERE snapshot_at = (
         SELECT snapshot_at FROM oracle_economy_snapshots ORDER BY snapshot_at DESC LIMIT 1
       )`,
      [JSON.stringify(snapshot)],
    )
  } catch {
    // Column may not exist yet — non-critical, log silently
    console.warn('[graph-materializer] Could not persist snapshot to DB (graph_snapshot_json column may be missing)')
  }
}

// ── Enricher loop ──────────────────────────────────────────────

export interface GraphMaterializerDeps {
  pool: pg.Pool
  redis?: { set(key: string, value: string, options?: { EX: number }): Promise<unknown> } | null
  onSnapshot?: (snapshot: GraphSnapshot) => void
}

/**
 * Start the graph materializer on a 5-minute timer.
 * Computes the snapshot immediately on startup, then every intervalMs.
 */
export function startGraphMaterializer(
  deps: GraphMaterializerDeps,
  config?: Partial<GraphMaterializerConfig>,
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  const { pool, redis, onSnapshot } = deps

  return startEnricherLoop(
    'graph-materializer',
    fullConfig.intervalMs,
    async () => {
      const snapshot = await computeGraphSnapshot(pool, fullConfig.edgeLimit)
      if (!snapshot) return null // Lock not acquired

      // Store in Redis
      await storeSnapshotInRedis(redis ?? null, snapshot)

      // Persist in DB
      await persistSnapshotInDb(pool, snapshot)

      // Notify listeners (e.g. EventBus)
      if (onSnapshot) onSnapshot(snapshot)

      console.log(
        `[graph-materializer] Snapshot computed: ${snapshot.meta.totalAgents} agents, ${snapshot.meta.totalConnections} connections`,
      )

      return null // suppress generic "Processed N items" log
    },
  )
}
