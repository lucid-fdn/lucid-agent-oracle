/**
 * End-to-end pipeline integration test.
 *
 * Exercises the full compute → cache → serve flow:
 *   1. Build realistic feed inputs
 *   2. Compute all 3 feeds (AEGDP, AAI, APRI) via pure functions
 *   3. Verify quality envelope computation
 *   4. Inject into the API's in-memory feed cache via handleIndexUpdate()
 *   5. Query the API and verify the full response
 *   6. Verify error paths, stale-data rejection, edge cases
 *
 * No external services required — uses real computation logic + lightweight Fastify.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  computeAEGDP,
  computeAAI,
  computeAPRI,
  computeConfidence,
  computeFreshnessScore,
  computeStalenessRisk,
  V1_FEEDS,
  type PublishedFeedRow,
} from '@lucid/oracle-core'
import { registerOracleRoutes, handleIndexUpdate, _resetFeedValues } from '../routes/v1.js'
import { buildAEGDPInputs, buildAAIInputs, buildAPRIInputs } from '../../../worker/src/compute.js'
import { ProblemDetail, registerGlobalErrorHandler } from '../schemas/common.js'

// ── Realistic test data ──────────────────────────────────────

const PROTOCOL_USD_ROWS = [
  { protocol: 'lucid', event_type: 'payment', usd_value: 12500.50 },
  { protocol: 'lucid', event_type: 'task_complete', usd_value: 8750.25 },
  { protocol: 'virtuals', event_type: 'payment', usd_value: 3200.00 },
  { protocol: 'olas', event_type: 'revenue_distribute', usd_value: 1800.75 },
]

const WINDOW_AGGREGATES = {
  total_events: 15420,
  total_operational: 12100,
  total_authentic: 9800,
  authentic_operational: 8500,
  authentic_tool_calls: 6200,
  operational_errors: 45,
  unique_agents_authentic: 87,
  unique_model_provider_pairs_authentic: 12,
}

const PROVIDER_COUNTS = [
  { provider: 'anthropic', cnt: 4500 },
  { provider: 'openai', cnt: 3200 },
  { provider: 'google', cnt: 1800 },
  { provider: 'mistral', cnt: 300 },
]

const WINDOW_MS = 3_600_000 // 1 hour
const WINDOW_SECONDS = WINDOW_MS / 1000

// ── Helpers ──────────────────────────────────────────────────

function makeFeedRow(overrides: Partial<PublishedFeedRow> & { feed_id: string }): PublishedFeedRow {
  return {
    feed_version: V1_FEEDS[overrides.feed_id as keyof typeof V1_FEEDS]?.version ?? 1,
    computed_at: new Date().toISOString(),
    revision: 1,
    pub_status_rev: 1,
    value_json: '{}',
    value_usd: null,
    value_index: null,
    confidence: 0.95,
    completeness: 1.0,
    freshness_ms: 500,
    staleness_risk: 'low',
    revision_status: 'current',
    methodology_version: 1,
    input_manifest_hash: 'abc123',
    computation_hash: 'def456',
    signer_set_id: 'test-signer',
    signatures_json: JSON.stringify([{ signer: 'test-key', sig: 'deadbeef' }]),
    source_coverage: 'full',
    published_solana: null,
    published_base: null,
    ...overrides,
  }
}

// Pre-compute all feed values (no test-order dependency)
const aegdpResult = computeAEGDP(buildAEGDPInputs(PROTOCOL_USD_ROWS))
const aaiResult = computeAAI(buildAAIInputs(WINDOW_AGGREGATES, WINDOW_SECONDS))
const apriResult = computeAPRI(buildAPRIInputs(WINDOW_AGGREGATES, PROVIDER_COUNTS, 55, 60))

// ── Test suite ───────────────────────────────────────────────

describe('E2E pipeline: compute → cache → serve', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(ProblemDetail)
    registerGlobalErrorHandler(app)
    registerOracleRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    _resetFeedValues()
  })

  // ── Feed computation ───────────────────────────────────────

  it('computes AEGDP from protocol USD data', () => {
    expect(aegdpResult.value_usd).toBeGreaterThan(0)
    expect(aegdpResult.value_usd).toBeCloseTo(12500.50 + 8750.25 + 3200 + 1800.75, 1)
    expect(aegdpResult.computation_hash).toBeDefined()
    expect(aegdpResult.input_manifest_hash).toBeDefined()
  })

  it('computes AAI from window aggregates', () => {
    expect(aaiResult.value).toBeGreaterThan(0)
    expect(aaiResult.value).toBeLessThanOrEqual(1000)
    expect(aaiResult.breakdown).toBeDefined()
  })

  it('computes APRI from provider distribution', () => {
    expect(apriResult.value).toBeGreaterThan(0)
    expect(apriResult.value).toBeLessThan(10000) // HHI with 4 providers
  })

  it('computed feed values are deterministic (same inputs → same output)', () => {
    const result2 = computeAEGDP(buildAEGDPInputs(PROTOCOL_USD_ROWS))
    expect(aegdpResult.value_usd).toBe(result2.value_usd)
    expect(aegdpResult.computation_hash).toBe(result2.computation_hash)
    expect(aegdpResult.input_manifest_hash).toBe(result2.input_manifest_hash)
  })

  it('generates quality envelope for each feed', () => {
    const freshnessScore = computeFreshnessScore(500, WINDOW_MS)
    const conf = computeConfidence({
      source_diversity_score: 0.8,
      identity_confidence: 0.9,
      data_completeness: 1.0,
      anomaly_cleanliness: 0.95,
      freshness_score: freshnessScore,
      revision_stability: 1.0,
    })
    const staleness = computeStalenessRisk(500, WINDOW_MS)

    expect(conf).toBeGreaterThan(0)
    expect(conf).toBeLessThanOrEqual(1)
    expect(['low', 'medium', 'high']).toContain(staleness)
  })

  // ── Boundary conditions ────────────────────────────────────

  it('computeAEGDP handles empty input', () => {
    const result = computeAEGDP(buildAEGDPInputs([]))
    expect(result.value_usd).toBe(0)
  })

  it('computeAEGDP handles zero-value rows', () => {
    const rows = [{ protocol: 'test', event_type: 'payment', usd_value: 0 }]
    const result = computeAEGDP(buildAEGDPInputs(rows))
    expect(result.value_usd).toBe(0)
  })

  it('computeAAI handles zero activity', () => {
    const zeroAgg = { ...WINDOW_AGGREGATES, total_events: 0, authentic_tool_calls: 0, unique_agents_authentic: 0, authentic_operational: 0, unique_model_provider_pairs_authentic: 0 }
    const result = computeAAI(buildAAIInputs(zeroAgg, WINDOW_SECONDS))
    expect(result.value).toBe(0)
  })

  it('computeAPRI handles single provider (monopoly)', () => {
    const singleProvider = [{ provider: 'anthropic', cnt: 10000 }]
    const inputs = buildAPRIInputs(WINDOW_AGGREGATES, singleProvider, 60, 60)
    const result = computeAPRI(inputs)
    // HHI for a monopoly should be high (up to 10000)
    expect(result.value).toBeGreaterThan(0)
  })

  // ── Cache injection + API serving ──────────────────────────

  it('GET /v1/oracle/feeds returns null latest_value on cold start', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.feeds).toHaveLength(3)
    for (const feed of body.feeds) {
      expect(feed.latest_value).toBeNull()
    }
  })

  it('injects computed feeds and serves them via GET /v1/oracle/feeds', async () => {
    const now = new Date().toISOString()

    handleIndexUpdate(JSON.stringify(makeFeedRow({
      feed_id: 'aegdp', computed_at: now,
      value_json: JSON.stringify({ value_usd: aegdpResult.value_usd }),
      value_usd: aegdpResult.value_usd,
    })))
    handleIndexUpdate(JSON.stringify(makeFeedRow({
      feed_id: 'aai', computed_at: now,
      value_json: JSON.stringify({ value: aaiResult.value }),
      value_index: aaiResult.value,
    })))
    handleIndexUpdate(JSON.stringify(makeFeedRow({
      feed_id: 'apri', computed_at: now,
      value_json: JSON.stringify({ value: apriResult.value }),
      value_index: apriResult.value, confidence: 0.88, completeness: 0.92,
    })))

    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds' })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    const populated = body.feeds.filter((f: any) => f.latest_value !== null)
    expect(populated).toHaveLength(3)

    for (const feed of body.feeds) {
      expect(feed.latest_value.signer).toBe('test-key')
      expect(feed.latest_value.staleness_risk).toBe('low')
    }

    const aegdp = body.feeds.find((f: any) => f.id === 'aegdp')
    expect(JSON.parse(aegdp.latest_value.value).value_usd).toBeCloseTo(aegdpResult.value_usd, 1)
  })

  it('GET /v1/oracle/feeds/:id returns correct detail', async () => {
    handleIndexUpdate(JSON.stringify(makeFeedRow({
      feed_id: 'aegdp',
      value_json: JSON.stringify({ value_usd: aegdpResult.value_usd }),
      value_usd: aegdpResult.value_usd,
      confidence: 0.95,
    })))

    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds/aegdp' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.feed.id).toBe('aegdp')
    expect(body.latest).not.toBeNull()
    expect(body.latest.confidence).toBe(0.95)
    expect(body.methodology_url).toBeDefined()
  })

  it('GET /v1/oracle/feeds/:id returns 404 for unknown feed', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /v1/oracle/feeds/:id/methodology returns computation details', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds/aai/methodology' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.computation).toBeDefined()
  })

  it('GET /v1/oracle/feeds/:id/methodology returns 404 for unknown feed', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds/nonexistent/methodology' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /v1/oracle/reports/latest returns feed values', async () => {
    handleIndexUpdate(JSON.stringify(makeFeedRow({
      feed_id: 'aegdp',
      value_json: JSON.stringify({ value_usd: aegdpResult.value_usd }),
      value_usd: aegdpResult.value_usd,
    })))

    const res = await app.inject({ method: 'GET', url: '/v1/oracle/reports/latest' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.report).not.toBeNull()
    expect(body.report.feeds).toBeDefined()
    expect(body.report.feeds.length).toBeGreaterThan(0)
  })

  // ── Error paths ────────────────────────────────────────────

  it('handleIndexUpdate ignores malformed JSON', () => {
    expect(() => handleIndexUpdate('not-json{')).not.toThrow()
  })

  it('handleIndexUpdate ignores messages missing feed_id', () => {
    const msg = JSON.stringify({ computed_at: new Date().toISOString() })
    expect(() => handleIndexUpdate(msg)).not.toThrow()
    // Cache should remain empty
  })

  it('handleIndexUpdate ignores messages missing computed_at', () => {
    const msg = JSON.stringify({ feed_id: 'aegdp' })
    expect(() => handleIndexUpdate(msg)).not.toThrow()
  })

  // ── Stale-data rejection (critical oracle invariant) ───────

  it('handleIndexUpdate does not overwrite newer data with older', async () => {
    const newer = makeFeedRow({
      feed_id: 'aegdp',
      computed_at: '2026-03-18T12:00:00Z',
      value_json: JSON.stringify({ value_usd: 99999 }),
      value_usd: 99999,
    })
    const older = makeFeedRow({
      feed_id: 'aegdp',
      computed_at: '2026-03-18T11:00:00Z',
      value_json: JSON.stringify({ value_usd: 11111 }),
      value_usd: 11111,
    })

    handleIndexUpdate(JSON.stringify(newer))
    handleIndexUpdate(JSON.stringify(older)) // should be rejected

    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds/aegdp' })
    const body = res.json()
    const val = JSON.parse(body.latest.value)
    expect(val.value_usd).toBe(99999) // newer value preserved
  })
})
