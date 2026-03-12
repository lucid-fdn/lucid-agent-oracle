import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OracleClickHouse } from '../clients/clickhouse.js'

// Mock @clickhouse/client
vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({
    query: vi.fn(),
    insert: vi.fn(),
    ping: vi.fn().mockResolvedValue({ success: true }),
    close: vi.fn(),
  })),
}))

describe('OracleClickHouse', () => {
  let client: OracleClickHouse

  beforeEach(() => {
    vi.clearAllMocks()
    client = new OracleClickHouse({ url: 'http://localhost:8123' })
  })

  it('constructs with config', () => {
    expect(client).toBeDefined()
  })

  it('health check calls ping', async () => {
    const result = await client.healthCheck()
    expect(result).toBe(true)
  })

  it('insertEvents calls insert with correct table', async () => {
    const events = [
      {
        event_id: 'test-id',
        source: 'lucid_gateway',
        source_adapter_ver: 1,
        ingestion_type: 'realtime',
        ingestion_ts: new Date(),
        chain: 'offchain',
        block_number: null,
        tx_hash: null,
        log_index: null,
        event_type: 'llm_inference',
        event_timestamp: new Date(),
        subject_entity_id: null,
        subject_raw_id: 'tenant_abc',
        subject_id_type: 'tenant',
        counterparty_raw_id: null,
        protocol: 'lucid',
        amount: null,
        currency: null,
        usd_value: '0.05',
        tool_name: null,
        model_id: 'gpt-4o',
        provider: 'openai',
        duration_ms: 1200,
        status: 'success',
        quality_score: 1.0,
        economic_authentic: true,
        corrects_event_id: null,
        correction_reason: null,
      },
    ]
    await client.insertEvents(events as any)
    const { createClient } = await import('@clickhouse/client')
    const mockInstance = (createClient as any).mock.results[0].value
    expect(mockInstance.insert).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'raw_economic_events' })
    )
  })
})
