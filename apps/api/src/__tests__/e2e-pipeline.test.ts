/**
 * End-to-end pipeline integration test.
 *
 * Exercises the full compute → cache → serve flow:
 *   1. Build realistic feed inputs
 *   2. Compute all 3 feeds (AEGDP, AAI, APRI) via pure functions
 *   3. Build a signed feed publication record (attestation)
 *   4. Inject into the API's in-memory feed cache via handleIndexUpdate()
 *   5. Query the API and verify the full response
 *
 * No external services required — uses real computation logic + lightweight Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  computeAEGDP,
  computeAAI,
  computeAPRI,
  AttestationService,
  computeConfidence,
  computeFreshnessScore,
  computeStalenessRisk,
  V1_FEEDS,
  type PublishedFeedRow,
} from '@lucid/oracle-core'
import { registerOracleRoutes, handleIndexUpdate } from '../routes/v1.js'
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

// ── Test suite ───────────────────────────────────────────────

describe('E2E pipeline: compute → cache → serve', () => {
  let app: ReturnType<typeof Fastify>
  let aegdpValue: number
  let aaiValue: number
  let apriValue: number

  beforeAll(async () => {
    // Build Fastify instance (minimal — just feeds routes)
    app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()
    app.addSchema(ProblemDetail)
    registerGlobalErrorHandler(app)
    registerOracleRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('computes AEGDP from protocol USD data', () => {
    const inputs = buildAEGDPInputs(PROTOCOL_USD_ROWS)
    const result = computeAEGDP(inputs)

    aegdpValue = result.value_usd
    expect(aegdpValue).toBeGreaterThan(0)
    expect(aegdpValue).toBeCloseTo(12500.50 + 8750.25 + 3200 + 1800.75, 1)
    expect(result.computation_hash).toBeDefined()
    expect(result.input_manifest_hash).toBeDefined()
  })

  it('computes AAI from window aggregates', () => {
    const inputs = buildAAIInputs(WINDOW_AGGREGATES, WINDOW_SECONDS)
    const result = computeAAI(inputs)

    aaiValue = result.value
    expect(aaiValue).toBeGreaterThan(0)
    expect(aaiValue).toBeLessThanOrEqual(1000)
    expect(result.breakdown).toBeDefined()
  })

  it('computes APRI from provider distribution', () => {
    const inputs = buildAPRIInputs(
      WINDOW_AGGREGATES,
      PROVIDER_COUNTS,
      55, // active buckets
      60, // total buckets
    )
    const result = computeAPRI(inputs)

    apriValue = result.value
    expect(apriValue).toBeGreaterThan(0)
    // HHI with 4 providers shouldn't be extreme monopoly
    expect(apriValue).toBeLessThan(10000)
  })

  it('generates quality envelope for each feed', () => {
    const freshnessScore = computeFreshnessScore(500, WINDOW_MS)
    const aegdpConf = computeConfidence({
      source_diversity_score: 0.8,
      identity_confidence: 0.9,
      data_completeness: 1.0,
      anomaly_cleanliness: 0.95,
      freshness_score: freshnessScore,
      revision_stability: 1.0,
    })
    const staleness = computeStalenessRisk(500, WINDOW_MS)

    expect(aegdpConf).toBeGreaterThan(0)
    expect(aegdpConf).toBeLessThanOrEqual(1)
    expect(['low', 'medium', 'high']).toContain(staleness)
  })

  it('injects computed feeds into API cache via handleIndexUpdate', () => {
    const now = new Date().toISOString()
    const signerSetId = 'test-signer'
    const signaturesJson = JSON.stringify([{ signer: 'test-key', sig: 'deadbeef' }])

    // Build PublishedFeedRow objects matching what the worker produces
    const feeds: PublishedFeedRow[] = [
      {
        feed_id: 'aegdp',
        feed_version: V1_FEEDS.aegdp.version,
        computed_at: now,
        revision: 1,
        pub_status_rev: 1,
        value_json: JSON.stringify({ value_usd: aegdpValue }),
        value_usd: aegdpValue,
        value_index: null,
        confidence: 0.95,
        completeness: 1.0,
        freshness_ms: 500,
        staleness_risk: 'low',
        revision_status: 'current',
        methodology_version: 1,
        input_manifest_hash: 'abc123',
        computation_hash: 'def456',
        signer_set_id: signerSetId,
        signatures_json: signaturesJson,
        source_coverage: 'full',
        published_solana: null,
        published_base: null,
      },
      {
        feed_id: 'aai',
        feed_version: V1_FEEDS.aai.version,
        computed_at: now,
        revision: 1,
        pub_status_rev: 1,
        value_json: JSON.stringify({ value: aaiValue }),
        value_usd: null,
        value_index: aaiValue,
        confidence: 0.92,
        completeness: 1.0,
        freshness_ms: 500,
        staleness_risk: 'low',
        revision_status: 'current',
        methodology_version: 1,
        input_manifest_hash: 'abc124',
        computation_hash: 'def457',
        signer_set_id: signerSetId,
        signatures_json: signaturesJson,
        source_coverage: 'full',
        published_solana: null,
        published_base: null,
      },
      {
        feed_id: 'apri',
        feed_version: V1_FEEDS.apri.version,
        computed_at: now,
        revision: 1,
        pub_status_rev: 1,
        value_json: JSON.stringify({ value: apriValue }),
        value_usd: null,
        value_index: apriValue,
        confidence: 0.88,
        completeness: 0.92,
        freshness_ms: 800,
        staleness_risk: 'low',
        revision_status: 'current',
        methodology_version: 1,
        input_manifest_hash: 'abc125',
        computation_hash: 'def458',
        signer_set_id: signerSetId,
        signatures_json: signaturesJson,
        source_coverage: 'full',
        published_solana: null,
        published_base: null,
      },
    ]

    // Inject each feed via the same path as the Redpanda consumer
    for (const row of feeds) {
      handleIndexUpdate(JSON.stringify(row))
    }
  })

  it('GET /v1/oracle/feeds returns all 3 feeds with computed values', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/feeds' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.feeds).toHaveLength(3)

    // Verify each feed has a latest_value
    for (const feed of body.feeds) {
      expect(feed.id).toBeDefined()
      expect(feed.name).toBeDefined()
      expect(feed.latest_value).not.toBeNull()
      expect(feed.latest_value.confidence).toBeGreaterThan(0)
      expect(feed.latest_value.staleness_risk).toBe('low')
      expect(feed.latest_value.signer).toBe('test-key')
    }

    // Verify specific feed values
    const aegdp = body.feeds.find((f: any) => f.id === 'aegdp')
    expect(aegdp).toBeDefined()
    const aegdpVal = JSON.parse(aegdp.latest_value.value)
    expect(aegdpVal.value_usd).toBeCloseTo(aegdpValue, 1)

    const aai = body.feeds.find((f: any) => f.id === 'aai')
    expect(aai).toBeDefined()
    const aaiVal = JSON.parse(aai.latest_value.value)
    expect(aaiVal.value).toBeCloseTo(aaiValue, 1)

    const apri = body.feeds.find((f: any) => f.id === 'apri')
    expect(apri).toBeDefined()
    const apriVal = JSON.parse(apri.latest_value.value)
    expect(apriVal.value).toBeCloseTo(apriValue, 1)
  })

  it('GET /v1/oracle/feeds/:id returns correct detail', async () => {
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

  it('computed feed values are deterministic (same inputs → same output)', () => {
    const inputs1 = buildAEGDPInputs(PROTOCOL_USD_ROWS)
    const inputs2 = buildAEGDPInputs(PROTOCOL_USD_ROWS)
    const result1 = computeAEGDP(inputs1)
    const result2 = computeAEGDP(inputs2)

    expect(result1.value_usd).toBe(result2.value_usd)
    expect(result1.computation_hash).toBe(result2.computation_hash)
    expect(result1.input_manifest_hash).toBe(result2.input_manifest_hash)
  })
})
