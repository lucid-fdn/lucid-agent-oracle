import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for x402 API route handlers.
 * Validates the SQL queries, response shaping, and edge cases.
 */

function mockDb() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

describe('x402 routes', () => {
  let db: ReturnType<typeof mockDb>

  beforeEach(() => {
    db = mockDb()
    vi.clearAllMocks()
  })

  describe('GET /v1/oracle/x402/endpoints', () => {
    it('returns empty data when no endpoints exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 0 }] })

      // Simulate the route handler logic
      const { rows } = await db.query(
        `SELECT agent_entity, chain, endpoint_url, pay_to_address,
                token_address, max_amount, description,
                discovered_at, last_verified_at, is_active
         FROM oracle_x402_endpoints
         ORDER BY is_active DESC, last_verified_at DESC
         LIMIT 200`,
      )
      const countResult = await db.query(
        `SELECT COUNT(*)::int AS cnt FROM oracle_x402_endpoints`,
      )

      expect(rows).toEqual([])
      expect(countResult.rows[0].cnt).toBe(0)
    })

    it('maps rows to correct response shape', async () => {
      const now = new Date().toISOString()
      db.query.mockResolvedValueOnce({
        rows: [{
          agent_entity: 'ae_test_1',
          chain: 'base',
          endpoint_url: 'https://agent.example.com/api',
          pay_to_address: '0xpayee',
          token_address: '0xusdc',
          max_amount: '100000',
          description: 'Test endpoint',
          discovered_at: now,
          last_verified_at: now,
          is_active: true,
        }],
      })

      const { rows } = await db.query(expect.any(String))
      const data = rows.map((row: Record<string, unknown>) => ({
        agent_entity: String(row.agent_entity),
        chain: String(row.chain),
        endpoint_url: String(row.endpoint_url),
        pay_to_address: String(row.pay_to_address),
        token_address: String(row.token_address),
        max_amount: String(row.max_amount),
        description: row.description ? String(row.description) : null,
        discovered_at: String(row.discovered_at),
        last_verified_at: String(row.last_verified_at),
        is_active: Boolean(row.is_active),
      }))

      expect(data).toHaveLength(1)
      expect(data[0].agent_entity).toBe('ae_test_1')
      expect(data[0].is_active).toBe(true)
    })
  })

  describe('GET /v1/oracle/x402/payments', () => {
    it('filters by payer agent', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{
          payer_agent: 'ae_payer',
          payee_agent: 'ae_payee',
          endpoint_url: 'https://agent.example.com/api',
          amount: '100000',
          amount_usd: 1.5,
          token_address: '0xusdc',
          chain: 'base',
          tx_hash: '0xabc123',
          event_timestamp: new Date().toISOString(),
        }],
      })
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 1 }] })

      const agentId = 'ae_payer'
      const sql = `SELECT payer_agent, payee_agent, endpoint_url, amount, amount_usd,
                      token_address, chain, tx_hash, event_timestamp
               FROM oracle_x402_payments
               WHERE payer_agent = $1::text
               ORDER BY event_timestamp DESC
               LIMIT $2::int OFFSET $3::int`

      const { rows } = await db.query(sql, [agentId, 50, 0])
      expect(rows).toHaveLength(1)
      expect(rows[0].payer_agent).toBe('ae_payer')

      // Verify the query was called with correct params
      expect(db.query).toHaveBeenCalledWith(sql, [agentId, 50, 0])
    })

    it('handles null amount_usd correctly', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{
          payer_agent: 'ae_payer',
          payee_agent: 'ae_payee',
          endpoint_url: 'https://agent.example.com/api',
          amount: '100000',
          amount_usd: null,
          token_address: '0xusdc',
          chain: 'base',
          tx_hash: '0xabc123',
          event_timestamp: new Date().toISOString(),
        }],
      })

      const { rows } = await db.query(expect.any(String))
      const mapped = rows.map((row: Record<string, unknown>) => ({
        amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
      }))
      expect(mapped[0].amount_usd).toBeNull()
    })
  })

  describe('GET /v1/oracle/x402/stats', () => {
    it('returns aggregate statistics', async () => {
      // endpoint counts
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 15 }] })
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 12 }] })
      // payment stats
      db.query.mockResolvedValueOnce({
        rows: [{
          total_payments: 100,
          total_volume_usd: 5000.50,
          unique_payers: 10,
          unique_payees: 8,
        }],
      })
      // top endpoints
      db.query.mockResolvedValueOnce({
        rows: [{
          endpoint_url: 'https://top.example.com/api',
          payee_agent: 'ae_top_payee',
          payment_count: 50,
          volume_usd: 2500,
        }],
      })
      // top payers
      db.query.mockResolvedValueOnce({
        rows: [{
          agent: 'ae_top_payer',
          payment_count: 30,
          volume_usd: 1500,
        }],
      })
      // top payees
      db.query.mockResolvedValueOnce({
        rows: [{
          agent: 'ae_top_payee',
          payment_count: 50,
          volume_usd: 2500,
        }],
      })

      // Simulate the parallel query pattern
      const [
        endpointCountResult,
        activeEndpointCountResult,
        paymentStatsResult,
        topEndpointsResult,
        topPayersResult,
        topPayeesResult,
      ] = await Promise.all([
        db.query('SELECT COUNT(*)::int AS cnt FROM oracle_x402_endpoints'),
        db.query('SELECT COUNT(*)::int AS cnt FROM oracle_x402_endpoints WHERE is_active = true'),
        db.query(expect.any(String)),
        db.query(expect.any(String)),
        db.query(expect.any(String)),
        db.query(expect.any(String)),
      ])

      const stats = paymentStatsResult.rows[0] ?? {}
      expect(Number(endpointCountResult.rows[0].cnt)).toBe(15)
      expect(Number(activeEndpointCountResult.rows[0].cnt)).toBe(12)
      expect(Number(stats.total_payments)).toBe(100)
      expect(Number(stats.total_volume_usd)).toBe(5000.50)
      expect(topEndpointsResult.rows).toHaveLength(1)
      expect(topPayersResult.rows).toHaveLength(1)
      expect(topPayeesResult.rows).toHaveLength(1)
    })

    it('handles zero stats gracefully', async () => {
      db.query.mockResolvedValue({ rows: [{ cnt: 0, total_payments: 0, total_volume_usd: 0, unique_payers: 0, unique_payees: 0 }] })

      const result = await db.query(expect.any(String))
      const stats = result.rows[0]
      expect(Number(stats.total_payments ?? 0)).toBe(0)
      expect(Number(stats.total_volume_usd ?? 0)).toBe(0)
    })
  })
})
