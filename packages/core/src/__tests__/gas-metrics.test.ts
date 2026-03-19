import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeGasMetrics, getAgentGasMetrics } from '../adapters/gas-metrics.js'

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

describe('Gas Metrics', () => {
  let pool: ReturnType<typeof mockPool>

  beforeEach(() => {
    pool = mockPool()
    vi.clearAllMocks()
  })

  describe('computeGasMetrics', () => {
    it('returns 0 when advisory lock is not acquired', async () => {
      pool._client.query.mockResolvedValueOnce({
        rows: [{ pg_try_advisory_lock: false }],
      })

      const result = await computeGasMetrics(pool as any)
      expect(result).toBe(0)
      expect(pool._client.release).toHaveBeenCalled()
    })

    it('computes metrics for all three periods', async () => {
      // Lock acquired
      pool._client.query.mockResolvedValueOnce({
        rows: [{ pg_try_advisory_lock: true }],
      })

      // 24h period query
      pool._client.query.mockResolvedValueOnce({
        rows: [
          { agent_entity: 'ae_1', tx_count: 5, unique_contracts: 3, active_chains: ['base'] },
        ],
      })
      // Upsert for 24h
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      // 7d period query
      pool._client.query.mockResolvedValueOnce({
        rows: [
          { agent_entity: 'ae_1', tx_count: 20, unique_contracts: 8, active_chains: ['base', 'eth'] },
        ],
      })
      // Upsert for 7d
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      // 30d period query
      pool._client.query.mockResolvedValueOnce({
        rows: [
          { agent_entity: 'ae_1', tx_count: 50, unique_contracts: 15, active_chains: ['base', 'eth'] },
        ],
      })
      // Upsert for 30d
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      // Unlock
      pool._client.query.mockResolvedValueOnce({ rows: [] })

      const result = await computeGasMetrics(pool as any)
      expect(result).toBe(3) // 1 agent x 3 periods

      // Verify upsert queries
      const upsertCall = pool._client.query.mock.calls[2]
      expect(upsertCall[0]).toContain('oracle_gas_metrics')
      expect(upsertCall[1]).toContain('ae_1')
      expect(upsertCall[1]).toContain('24h')

      expect(pool._client.release).toHaveBeenCalled()
    })

    it('always releases client even on error', async () => {
      pool._client.query.mockRejectedValueOnce(new Error('DB error'))

      await expect(computeGasMetrics(pool as any)).rejects.toThrow('DB error')
      expect(pool._client.release).toHaveBeenCalled()
    })
  })

  describe('getAgentGasMetrics', () => {
    it('returns metrics for a specific agent', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { agent_entity: 'ae_1', period: '24h', tx_count: 5, unique_contracts: 3, active_chains: ['base'] },
          { agent_entity: 'ae_1', period: '7d', tx_count: 20, unique_contracts: 8, active_chains: ['base', 'eth'] },
          { agent_entity: 'ae_1', period: '30d', tx_count: 50, unique_contracts: 15, active_chains: ['base', 'eth'] },
        ],
      })

      const result = await getAgentGasMetrics(pool as any, 'ae_1')
      expect(result).toHaveLength(3)
      expect(result[0].period).toBe('24h')
      expect(result[0].tx_count).toBe(5)
      expect(result[2].period).toBe('30d')
      expect(result[2].unique_contracts).toBe(15)
    })

    it('returns empty array when agent has no metrics', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] })
      const result = await getAgentGasMetrics(pool as any, 'ae_none')
      expect(result).toHaveLength(0)
    })
  })
})
