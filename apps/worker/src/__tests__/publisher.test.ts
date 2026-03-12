import { describe, it, expect, vi } from 'vitest'
import { shouldPublish, publishFeedValue, type PublishContext, type FeedComputeResult } from '../publisher.js'

describe('shouldPublish', () => {
  const base: PublishContext = {
    feedId: 'aegdp',
    newValue: 1000,
    previousValue: 990,
    thresholdBps: 100,
    lastPublishedAt: null,
    heartbeatIntervalMs: 900_000,
    now: Date.now(),
  }

  it('publishes on first computation (no previous)', () => {
    expect(shouldPublish({ ...base, previousValue: null, lastPublishedAt: null })).toBe(true)
  })

  it('publishes when deviation exceeds threshold', () => {
    // |1000 - 990| / max(990, 1) * 10000 = 101 bps > 100 bps
    expect(shouldPublish(base)).toBe(true)
  })

  it('does not publish when deviation is below threshold', () => {
    const recent = Date.now() - 60_000 // 1 min ago — within heartbeat window
    expect(shouldPublish({ ...base, newValue: 990.5, lastPublishedAt: recent })).toBe(false)
  })

  it('publishes on heartbeat even without deviation', () => {
    const old = Date.now() - 1_000_000 // > 15 min ago
    expect(shouldPublish({ ...base, newValue: 990, lastPublishedAt: old })).toBe(true)
  })
})

describe('publishFeedValue', () => {
  it('publishes to both INDEX_UPDATES and PUBLICATION topics', async () => {
    const mockClickhouse = {
      insertPublishedFeedValue: vi.fn().mockResolvedValue(undefined),
    }
    const mockProducer = {
      publishJson: vi.fn().mockResolvedValue(undefined),
    }
    const mockAttestation = {
      signReport: vi.fn().mockReturnValue({
        feed_id: 'aegdp',
        feed_version: 1,
        report_timestamp: 1710288000000,
        values: {},
        input_manifest_hash: 'abc',
        computation_hash: 'def',
        revision: 0,
        signer_set_id: 'ss_lucid_v1',
        signatures: [{ signer: 'pub1', sig: 'sig1' }],
      }),
    }
    const result: FeedComputeResult = {
      feedId: 'aegdp',
      valueJson: '{"value_usd": 1000}',
      valueUsd: 1000,
      valueIndex: null,
      inputManifestHash: 'abc',
      computationHash: 'def',
      completeness: 0.8,
      freshnessMs: 2000,
    }
    const config = {
      heartbeatIntervalMs: 900_000,
    } as any

    await publishFeedValue(result, mockAttestation as any, mockClickhouse as any, mockProducer as any, config)

    // Should publish to both topics
    expect(mockProducer.publishJson).toHaveBeenCalledTimes(2)
    expect(mockProducer.publishJson).toHaveBeenCalledWith('index.updates', 'aegdp', expect.any(Object))
    expect(mockProducer.publishJson).toHaveBeenCalledWith('publication.requests', 'aegdp', expect.any(Object))

    // Verify confidence is NOT just completeness
    const pubRequest = mockProducer.publishJson.mock.calls[1][2]
    expect(pubRequest.confidence).toBeGreaterThan(0)
    expect(pubRequest.feed_id).toBe('aegdp')
    expect(pubRequest.revision).toBe(0)
    expect(pubRequest.methodology_version).toBe(1)
    expect(pubRequest.signer_set_id).toBe('ss_lucid_v1')
  })

  it('uses computeConfidence not raw completeness', async () => {
    const mockClickhouse = { insertPublishedFeedValue: vi.fn().mockResolvedValue(undefined) }
    const mockProducer = { publishJson: vi.fn().mockResolvedValue(undefined) }
    const mockAttestation = {
      signReport: vi.fn().mockReturnValue({
        feed_id: 'aai', feed_version: 1, report_timestamp: Date.now(),
        values: {}, input_manifest_hash: 'a', computation_hash: 'b', revision: 0,
        signer_set_id: 'ss_lucid_v1', signatures: [{ signer: 'p', sig: 's' }],
      }),
    }
    const result: FeedComputeResult = {
      feedId: 'aai', valueJson: '{}', valueUsd: null, valueIndex: 500,
      inputManifestHash: 'a', computationHash: 'b', completeness: 0.5, freshnessMs: 60_000,
    }
    await publishFeedValue(result, mockAttestation as any, mockClickhouse as any, mockProducer as any, { heartbeatIntervalMs: 900_000 } as any)

    const row = mockClickhouse.insertPublishedFeedValue.mock.calls[0][0]
    // confidence should differ from completeness because freshness decays
    expect(row.confidence).not.toBe(row.completeness)
    expect(row.pub_status_rev).toBe(0)
  })
})
