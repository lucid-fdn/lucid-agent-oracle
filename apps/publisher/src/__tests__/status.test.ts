import { describe, it, expect, vi } from 'vitest'
import { recordPublicationStatus } from '../status.js'
import type { PublicationRequest } from '@lucid/oracle-core'

const mockReq: PublicationRequest = {
  feed_id: 'aegdp', feed_version: 1,
  computed_at: '2026-03-12T00:00:00.000Z', revision: 0,
  value_json: '{}', value_usd: 1000, value_index: null,
  confidence: 0.85, completeness: 0.8,
  input_manifest_hash: 'abc', computation_hash: 'def',
  methodology_version: 1, signer_set_id: 'ss_lucid_v1', signatures_json: '[]',
}

describe('recordPublicationStatus', () => {
  it('inserts status-revision row when at least one chain succeeds', async () => {
    const mockClickhouse = {
      queryPublicationStatus: vi.fn().mockResolvedValue(null),
      insertPublishedFeedValue: vi.fn().mockResolvedValue(undefined),
    }

    await recordPublicationStatus(
      mockClickhouse as any, mockReq,
      '0xsolana_sig', '0xbase_hash',
    )

    expect(mockClickhouse.insertPublishedFeedValue).toHaveBeenCalledOnce()
    const row = mockClickhouse.insertPublishedFeedValue.mock.calls[0][0]
    expect(row.pub_status_rev).toBe(1)
    expect(row.published_solana).toBe('0xsolana_sig')
    expect(row.published_base).toBe('0xbase_hash')
    expect(row.revision).toBe(0)
  })

  it('does not insert when both chains fail', async () => {
    const mockClickhouse = {
      queryPublicationStatus: vi.fn().mockResolvedValue(null),
      insertPublishedFeedValue: vi.fn().mockResolvedValue(undefined),
    }

    await recordPublicationStatus(mockClickhouse as any, mockReq, null, null)
    expect(mockClickhouse.insertPublishedFeedValue).not.toHaveBeenCalled()
  })

  it('skips chains already published (idempotency) and increments pub_status_rev', async () => {
    const mockClickhouse = {
      queryPublicationStatus: vi.fn().mockResolvedValue({
        published_solana: '0xalready', published_base: null, pub_status_rev: 1,
      }),
      insertPublishedFeedValue: vi.fn().mockResolvedValue(undefined),
    }

    const result = await recordPublicationStatus(
      mockClickhouse as any, mockReq,
      '0xnew_solana', '0xbase_hash',
    )

    expect(result.skipSolana).toBe(true)
    expect(result.skipBase).toBe(false)
    const row = mockClickhouse.insertPublishedFeedValue.mock.calls[0][0]
    expect(row.pub_status_rev).toBe(2)
  })
})
