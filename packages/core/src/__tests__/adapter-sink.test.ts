import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RawAdapterEvent } from '../adapters/sink.js'
import { DirectSink } from '../adapters/direct-sink.js'

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  end: vi.fn().mockResolvedValue(undefined),
}

const SAMPLE_EVENT: RawAdapterEvent = {
  event_id: 'erc8004_base_0xabc_0',
  source: 'erc8004',
  source_adapter_ver: 1,
  chain: 'base',
  event_type: 'agent_registered',
  event_timestamp: '2026-03-19T00:00:00Z',
  payload_json: JSON.stringify({ agent_id: '0x123', owner: '0xabc' }),
  block_number: 20000001,
  tx_hash: '0xabc',
  log_index: 0,
}

describe('DirectSink', () => {
  let sink: DirectSink

  beforeEach(() => {
    vi.clearAllMocks()
    sink = new DirectSink(mockPool as any)
  })

  it('writes a single event to staging table', async () => {
    await sink.writeRawEvent(SAMPLE_EVENT)

    expect(mockPool.query).toHaveBeenCalledOnce()
    const [sql, params] = mockPool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO oracle_raw_adapter_events')
    expect(sql).toContain('ON CONFLICT (event_id) DO NOTHING')
    expect(params[0]).toBe('erc8004_base_0xabc_0')
    expect(params[1]).toBe('erc8004')
    expect(params[4]).toBe('agent_registered')
  })

  it('writes batch of events', async () => {
    const events = [SAMPLE_EVENT, { ...SAMPLE_EVENT, event_id: 'erc8004_base_0xdef_1' }]
    await sink.writeRawEvents(events)
    expect(mockPool.query).toHaveBeenCalledTimes(2)
  })

  it('handles null optional fields', async () => {
    const event: RawAdapterEvent = {
      ...SAMPLE_EVENT,
      block_number: undefined,
      tx_hash: undefined,
      log_index: undefined,
    }
    await sink.writeRawEvent(event)
    const params = mockPool.query.mock.calls[0][1]
    expect(params[7]).toBeNull() // block_number
    expect(params[8]).toBeNull() // tx_hash
    expect(params[9]).toBeNull() // log_index
  })

  it('close ends the pool', async () => {
    await sink.close()
    expect(mockPool.end).toHaveBeenCalledOnce()
  })
})
