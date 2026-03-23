import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentQueryService } from '../services/agent-query.js'

function mockDb() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

describe('AgentQueryService.getAgentGraph', () => {
  let db: ReturnType<typeof mockDb>
  let service: AgentQueryService

  beforeEach(() => {
    db = mockDb()
    service = new AgentQueryService(db as any)
    vi.clearAllMocks()
  })

  it('returns empty array when no transactions exist at all', async () => {
    // First query (agent-to-agent) returns empty, fallback also returns empty
    db.query.mockResolvedValueOnce({ rows: [] })
    db.query.mockResolvedValueOnce({ rows: [] })
    const result = await service.getAgentGraph()
    expect(result).toHaveLength(0)
    // Should have made two queries: agent-to-agent + fallback
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('returns agent graph edges with transaction counts', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { from_agent: 'ae_1', to_agent: 'ae_2', tx_count: 15, total_usd: 1234.56 },
        { from_agent: 'ae_2', to_agent: 'ae_3', tx_count: 5, total_usd: 500 },
      ],
    })

    const result = await service.getAgentGraph(100)
    expect(result).toHaveLength(2)
    expect(result[0].from_agent).toBe('ae_1')
    expect(result[0].to_agent).toBe('ae_2')
    expect(result[0].tx_count).toBe(15)
    expect(result[0].total_usd).toBe(1234.56)
    // Should NOT have made a fallback query
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('uses the correct SQL with wallet mappings cross-reference', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })
    db.query.mockResolvedValueOnce({ rows: [] })
    await service.getAgentGraph(500)

    const sql = db.query.mock.calls[0][0] as string
    expect(sql).toContain('oracle_wallet_transactions')
    expect(sql).toContain('oracle_wallet_mappings')
    expect(sql).toContain("direction = 'outbound'")
    expect(sql).toContain('LOWER(wt.counterparty) = LOWER(wm2.address)')
    expect(sql).toContain('removed_at IS NULL')
  })

  it('falls back to top counterparty connections when no agent-to-agent edges exist', async () => {
    // First query (agent-to-agent) returns empty
    db.query.mockResolvedValueOnce({ rows: [] })
    // Fallback query returns counterparty connections
    db.query.mockResolvedValueOnce({
      rows: [
        { from_agent: 'ae_1', to_agent: '0xdead...', tx_count: 10, total_usd: 200 },
      ],
    })

    const result = await service.getAgentGraph(100)
    expect(result).toHaveLength(1)
    expect(result[0].from_agent).toBe('ae_1')
    expect(result[0].to_agent).toBe('0xdead...')
    expect(db.query).toHaveBeenCalledTimes(2)

    // Verify the fallback SQL groups by counterparty directly
    const fallbackSql = db.query.mock.calls[1][0] as string
    expect(fallbackSql).toContain('wt.counterparty AS to_agent')
    expect(fallbackSql).toContain("direction = 'outbound'")
    expect(fallbackSql).toContain('HAVING')
  })

  it('respects the limit parameter', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })
    db.query.mockResolvedValueOnce({ rows: [] })
    await service.getAgentGraph(42)

    expect(db.query.mock.calls[0][1]).toEqual([42])
  })

  it('defaults limit to 500', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })
    db.query.mockResolvedValueOnce({ rows: [] })
    await service.getAgentGraph()

    expect(db.query.mock.calls[0][1]).toEqual([500])
  })
})
