/**
 * x402 Payment Harvester — discovers x402-compatible agent endpoints and
 * correlates on-chain settlements into agent-to-agent micropayments.
 *
 * x402 is an HTTP payment protocol: an agent calls another agent's API,
 * gets a 402 Payment Required with X-Payment header, pays on-chain (USDC),
 * and sends the tx hash to complete the request.
 *
 * Discovery:
 *   - Queries oracle_agent_entities for agents with service URLs in metadata_json
 *   - Probes each HTTPS endpoint with a HEAD request (2s timeout)
 *   - Parses 402 responses with X-Payment header
 *   - Stores discovered endpoints in oracle_x402_endpoints
 *
 * Correlation:
 *   - Joins oracle_wallet_transactions with oracle_x402_endpoints
 *   - Outbound transfers to a payTo address matching token = x402 payment
 *   - Stores in oracle_x402_payments
 *
 * Runs every 30 minutes, 10 agents per cycle. Advisory-locked.
 * See: https://www.x402.org/
 */
import type pg from 'pg'
import { withAdvisoryLock, startEnricherLoop } from './enricher-utils.js'

// ── Types ──────────────────────────────────────────────────────

export interface X402PaymentEvent {
  payer_agent: string
  payee_agent: string
  amount_usd: number
  endpoint: string
  settlement_tx: string
  chain: string
  timestamp: string
}

export interface X402Endpoint {
  agent_entity: string
  chain: string
  endpoint_url: string
  pay_to_address: string
  token_address: string
  max_amount: string
  description: string
  discovered_at: Date
  last_verified_at: Date
  is_active: boolean
}

export interface X402HarvesterConfig {
  intervalMs: number
  agentsPerCycle: number
  probeTimeoutMs: number
  delayBetweenProbesMs: number
}

/** Parsed X-Payment header from a 402 response */
export interface X402PaymentHeader {
  scheme: string
  network: string
  maxAmountRequired: string
  resource: string
  payTo: string
  maxTimeoutSeconds: number
  mimeType: string
  description: string
  extra?: {
    token?: string
    [key: string]: unknown
  }
}

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_CONFIG: X402HarvesterConfig = {
  intervalMs: 30 * 60_000, // 30 minutes
  agentsPerCycle: 10,
  probeTimeoutMs: 2_000,
  delayBetweenProbesMs: 2_000,
}

/** Map x402 network names to our chain IDs */
const NETWORK_TO_CHAIN: Record<string, string> = {
  base: 'base',
  'base-sepolia': 'base',
  ethereum: 'ethereum',
  'ethereum-mainnet': 'ethereum',
  polygon: 'polygon',
  optimism: 'optimism',
  arbitrum: 'arbitrum',
}

// ── SSRF Protection ────────────────────────────────────────────

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^::1$/,
  /^f[cd]/i,
  /^fe80/i,
]

/** Validate a URL is safe to probe (HTTPS, no private IPs, no file://) */
export function isProbeUrlSafe(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // Only HTTPS
  if (parsed.protocol !== 'https:') return false

  // No userinfo in URL
  if (parsed.username || parsed.password) return false

  // Check hostname against private ranges
  // URL parser keeps brackets around IPv6 — strip them for matching
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  for (const pattern of PRIVATE_RANGES) {
    if (pattern.test(hostname)) return false
  }

  return true
}

// ── Endpoint Discovery ─────────────────────────────────────────

/**
 * Extract service endpoint URLs from an agent's metadata_json.
 * Looks for common patterns: services array, endpoints array, url fields.
 */
export function extractServiceUrls(metadataJson: unknown): string[] {
  if (!metadataJson || typeof metadataJson !== 'object') return []
  const meta = metadataJson as Record<string, unknown>
  const urls: string[] = []

  // Direct URL fields
  for (const key of ['url', 'endpoint', 'service_url', 'api_url', 'api_endpoint']) {
    if (typeof meta[key] === 'string' && meta[key]) {
      urls.push(meta[key] as string)
    }
  }

  // services / endpoints arrays
  for (const key of ['services', 'endpoints', 'apis']) {
    const arr = meta[key]
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string') {
          urls.push(item)
        } else if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>
          for (const urlKey of ['url', 'endpoint', 'href', 'uri']) {
            if (typeof obj[urlKey] === 'string' && obj[urlKey]) {
              urls.push(obj[urlKey] as string)
            }
          }
        }
      }
    }
  }

  // Deduplicate and filter to safe probe targets
  return [...new Set(urls)].filter(isProbeUrlSafe)
}

/**
 * Parse the X-Payment header JSON from a 402 response.
 */
export function parseX402Header(headerValue: string): X402PaymentHeader | null {
  try {
    const data = JSON.parse(headerValue) as Record<string, unknown>
    if (!data.payTo || !data.maxAmountRequired) return null

    return {
      scheme: String(data.scheme ?? 'exact'),
      network: String(data.network ?? 'base'),
      maxAmountRequired: String(data.maxAmountRequired),
      resource: String(data.resource ?? ''),
      payTo: String(data.payTo),
      maxTimeoutSeconds: Number(data.maxTimeoutSeconds ?? 60),
      mimeType: String(data.mimeType ?? 'application/json'),
      description: String(data.description ?? ''),
      extra: data.extra as X402PaymentHeader['extra'],
    }
  } catch {
    return null
  }
}

/**
 * Probe a single URL for x402 support.
 * Sends a HEAD request with a short timeout. If the server returns 402
 * with an X-Payment header, returns the parsed payment info.
 */
export async function probeEndpoint(
  url: string,
  timeoutMs: number,
): Promise<X402PaymentHeader | null> {
  if (!isProbeUrlSafe(url)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Lucid-Oracle-x402-Discovery/1.0',
        Accept: 'application/json',
      },
      redirect: 'manual', // Don't follow redirects — 402 is what we want
    })

    if (res.status !== 402) return null

    // Look for X-Payment header (case-insensitive via Headers API)
    const paymentHeader = res.headers.get('x-payment')
    if (!paymentHeader) return null

    return parseX402Header(paymentHeader)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Main Harvest Cycle ─────────────────────────────────────────

/**
 * Run one discovery + correlation cycle.
 */
export async function harvestX402(
  pool: pg.Pool,
  config: X402HarvesterConfig = DEFAULT_CONFIG,
): Promise<number> {
  const result = await withAdvisoryLock(pool, 'x402_harvester', async (client) => {
    let processed = 0

    // ── Phase 1: Endpoint Discovery ────────────────────────────
    processed += await discoverEndpoints(client, config)

    // ── Phase 2: Re-verify existing endpoints ──────────────────
    await reverifyEndpoints(client, config)

    // ── Phase 3: Payment Correlation ───────────────────────────
    processed += await correlatePayments(client)

    return processed
  })

  return result ?? 0
}

/**
 * Phase 1: Discover new x402 endpoints from agent service metadata.
 */
async function discoverEndpoints(
  client: pg.PoolClient,
  config: X402HarvesterConfig,
): Promise<number> {
  let discovered = 0

  // Query agents with metadata that might contain service URLs
  // Skip agents we've already scanned recently (within last 24h)
  const agentsResult = await client.query(
    `SELECT ae.id, ae.metadata_json
     FROM oracle_agent_entities ae
     WHERE ae.metadata_json IS NOT NULL
       AND ae.metadata_json::text != 'null'
       AND ae.metadata_json::text != '{}'
       AND NOT EXISTS (
         SELECT 1 FROM oracle_x402_endpoints x
         WHERE x.agent_entity = ae.id
           AND x.last_verified_at > now() - interval '24 hours'
       )
     ORDER BY ae.updated_at DESC
     LIMIT $1::int`,
    [config.agentsPerCycle],
  )

  for (const agent of agentsResult.rows) {
    const agentId = agent.id as string
    const metadata = agent.metadata_json

    const urls = extractServiceUrls(metadata)
    if (urls.length === 0) continue

    for (const url of urls) {
      try {
        const header = await probeEndpoint(url, config.probeTimeoutMs)

        if (header) {
          const chain = NETWORK_TO_CHAIN[header.network] ?? header.network
          const tokenAddress = header.extra?.token ?? ''

          await client.query(
            `INSERT INTO oracle_x402_endpoints
               (agent_entity, chain, endpoint_url, pay_to_address, token_address,
                max_amount, description, discovered_at, last_verified_at, is_active)
             VALUES ($1::text, $2::text, $3::text, $4::text, $5::text,
                     $6::text, $7::text, now(), now(), true)
             ON CONFLICT (agent_entity, endpoint_url) DO UPDATE
             SET pay_to_address = EXCLUDED.pay_to_address,
                 token_address = EXCLUDED.token_address,
                 max_amount = EXCLUDED.max_amount,
                 description = EXCLUDED.description,
                 last_verified_at = now(),
                 is_active = true,
                 chain = EXCLUDED.chain`,
            [agentId, chain, url, header.payTo.toLowerCase(), tokenAddress.toLowerCase(), header.maxAmountRequired, header.description],
          )
          discovered++
        }

        // Rate limit between probes
        if (config.delayBetweenProbesMs > 0) {
          await new Promise(r => setTimeout(r, config.delayBetweenProbesMs))
        }
      } catch (err) {
        console.error(`[x402] Probe error for ${url}:`, (err as Error).message)
      }
    }
  }

  return discovered
}

/**
 * Phase 2: Re-verify existing active endpoints that haven't been checked in 24h.
 * Mark stale endpoints as inactive if they no longer return 402.
 */
async function reverifyEndpoints(
  client: pg.PoolClient,
  config: X402HarvesterConfig,
): Promise<void> {
  const staleResult = await client.query(
    `SELECT id, endpoint_url, agent_entity
     FROM oracle_x402_endpoints
     WHERE is_active = true
       AND last_verified_at < now() - interval '24 hours'
     ORDER BY last_verified_at ASC
     LIMIT 5`,
  )

  for (const row of staleResult.rows) {
    const url = row.endpoint_url as string
    try {
      const header = await probeEndpoint(url, config.probeTimeoutMs)

      if (header) {
        await client.query(
          `UPDATE oracle_x402_endpoints
           SET last_verified_at = now(), is_active = true,
               pay_to_address = $1::text, max_amount = $2::text
           WHERE id = $3::bigint`,
          [header.payTo.toLowerCase(), header.maxAmountRequired, row.id],
        )
      } else {
        // Endpoint no longer returns 402 — mark inactive
        await client.query(
          `UPDATE oracle_x402_endpoints
           SET is_active = false, last_verified_at = now()
           WHERE id = $1::bigint`,
          [row.id],
        )
      }

      if (config.delayBetweenProbesMs > 0) {
        await new Promise(r => setTimeout(r, config.delayBetweenProbesMs))
      }
    } catch (err) {
      console.error(`[x402] Reverify error for ${url}:`, (err as Error).message)
    }
  }
}

/**
 * Phase 3: Correlate on-chain transactions with known x402 endpoints.
 *
 * Finds outbound wallet transfers to x402 payTo addresses that match
 * the token address — these are x402 settlements.
 */
async function correlatePayments(client: pg.PoolClient): Promise<number> {
  // Find wallet transactions that match x402 payment patterns
  // wt.direction = 'outbound', wt.counterparty = x.pay_to_address, same chain + token
  // Only correlate transactions we haven't already recorded
  const correlationResult = await client.query(
    `INSERT INTO oracle_x402_payments
       (payer_agent, payee_agent, endpoint_url, amount, amount_usd,
        token_address, chain, tx_hash, event_timestamp)
     SELECT
       wt.agent_entity AS payer_agent,
       x.agent_entity AS payee_agent,
       x.endpoint_url,
       wt.amount,
       wt.amount_usd,
       wt.token_address,
       wt.chain,
       wt.tx_hash,
       wt.event_timestamp
     FROM oracle_wallet_transactions wt
     JOIN oracle_x402_endpoints x
       ON LOWER(wt.counterparty) = LOWER(x.pay_to_address)
       AND wt.chain = x.chain
     WHERE wt.direction = 'outbound'
       AND LOWER(wt.token_address) = LOWER(x.token_address)
       AND x.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM oracle_x402_payments p
         WHERE p.chain = wt.chain AND p.tx_hash = wt.tx_hash
       )
     ON CONFLICT (chain, tx_hash) DO NOTHING
     RETURNING id`,
  )

  return correlationResult.rowCount ?? 0
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Start the x402 harvester on a timer loop.
 */
export function startX402Harvester(
  pool: pg.Pool,
  config: Partial<X402HarvesterConfig> = {},
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  return startEnricherLoop(
    'x402-harvester',
    fullConfig.intervalMs,
    async () => {
      const n = await harvestX402(pool, fullConfig)
      return n > 0 ? n : null
    },
  )
}
