import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeContractInteractions, getAgentContractInteractions } from '../adapters/contract-analyzer.js'

function mockPool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    _client: client,
  }
}

describe('Contract Analyzer', () => {
  let pool: ReturnType<typeof mockPool>

  beforeEach(() => {
    pool = mockPool()
    vi.clearAllMocks()
  })

  describe('analyzeContractInteractions', () => {
    it('returns 0 when advisory lock is not acquired', async () => {
      pool._client.query.mockResolvedValueOnce({
        rows: [{ pg_try_advisory_lock: false }],
      })

      const result = await analyzeContractInteractions(pool as any)
      expect(result).toBe(0)
      expect(pool._client.release).toHaveBeenCalled()
    })

    it('analyzes and upserts contract interactions', async () => {
      // Lock acquired
      pool._client.query.mockResolvedValueOnce({
        rows: [{ pg_try_advisory_lock: true }],
      })

      // Grouped transactions
      pool._client.query.mockResolvedValueOnce({
        rows: [
          {
            agent_entity: 'ae_1',
            chain: 'base',
            contract_address: '0xDEAD',
            interaction_count: 10,
            first_seen: '2026-03-10T00:00:00Z',
            last_seen: '2026-03-20T00:00:00Z',
          },
          {
            agent_entity: 'ae_1',
            chain: 'base',
            contract_address: '0xBEEF',
            interaction_count: 3,
            first_seen: '2026-03-15T00:00:00Z',
            last_seen: '2026-03-20T00:00:00Z',
          },
        ],
      })

      // Two upserts
      pool._client.query.mockResolvedValueOnce({ rows: [] })
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      // Unlock
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      const result = await analyzeContractInteractions(pool as any)
      expect(result).toBe(2)
      expect(pool._client.release).toHaveBeenCalled()

      // Verify upsert SQL
      const upsertCall = pool._client.query.mock.calls[2]
      expect(upsertCall[0]).toContain('oracle_contract_interactions')
      expect(upsertCall[1]).toContain('ae_1')
      expect(upsertCall[1]).toContain('0xDEAD')
    })

    it('skips name resolution when moralisApiKey is not set', async () => {
      // Lock acquired
      pool._client.query.mockResolvedValueOnce({
        rows: [{ pg_try_advisory_lock: true }],
      })

      // No transactions
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      // Unlock
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      const result = await analyzeContractInteractions(pool as any, {
        intervalMs: 60_000,
        resolveNames: false,
      })
      expect(result).toBe(0)
      // Should not have made a name resolution query
      expect(pool._client.query).toHaveBeenCalledTimes(3) // lock, select, unlock
    })

    it('always releases client even on error', async () => {
      pool._client.query.mockRejectedValueOnce(new Error('DB error'))

      await expect(analyzeContractInteractions(pool as any)).rejects.toThrow('DB error')
      expect(pool._client.release).toHaveBeenCalled()
    })
  })

  describe('getAgentContractInteractions', () => {
    it('returns contract interactions for an agent', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            agent_entity: 'ae_1',
            chain: 'base',
            contract_address: '0xDEAD',
            contract_name: 'Uniswap V3',
            interaction_count: 10,
            first_seen: '2026-03-10T00:00:00Z',
            last_seen: '2026-03-20T00:00:00Z',
          },
        ],
      })

      const result = await getAgentContractInteractions(pool as any, 'ae_1')
      expect(result).toHaveLength(1)
      expect(result[0].contract_address).toBe('0xDEAD')
      expect(result[0].contract_name).toBe('Uniswap V3')
      expect(result[0].interaction_count).toBe(10)
    })

    it('returns empty array when agent has no interactions', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] })
      const result = await getAgentContractInteractions(pool as any, 'ae_none')
      expect(result).toHaveLength(0)
    })
  })
})
