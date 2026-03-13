import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentQueryService } from '../services/agent-query.js'

function mockDb() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

describe('AgentQueryService', () => {
  let db: ReturnType<typeof mockDb>
  let service: AgentQueryService

  beforeEach(() => {
    db = mockDb()
    service = new AgentQueryService(db as any)
    vi.clearAllMocks()
  })

  describe('getProfile', () => {
    it('returns null when entity not found', async () => {
      db.query.mockResolvedValueOnce({ rows: [] })
      const result = await service.getProfile('ae_nonexistent')
      expect(result).toBeNull()
    })

    it('returns full profile with wallets, links, evidence count', async () => {
      // Mock 4 queries in sequence:
      // 1. Entity lookup
      db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_1', display_name: 'Agent One', erc8004_id: '123', lucid_tenant: 'lt1', reputation_json: null, reputation_updated_at: null, created_at: '2026-03-12', updated_at: '2026-03-12' }] })
      // 2. Wallets (Promise.all — these are called in parallel, so mock in order)
      db.query.mockResolvedValueOnce({ rows: [{ chain: 'base', address: '0xABC', link_type: 'self_claim', confidence: 1.0 }] })
      // 3. Links
      db.query.mockResolvedValueOnce({ rows: [{ protocol: 'lucid', protocol_id: 'lt1', link_type: 'gateway_correlation', confidence: 1.0 }] })
      // 4. Evidence count
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 3 }] })

      const result = await service.getProfile('ae_1')
      expect(result).not.toBeNull()
      expect(result!.id).toBe('ae_1')
      expect(result!.wallets).toHaveLength(1)
      expect(result!.identity_links).toHaveLength(1)
      expect(result!.evidence_count).toBe(3)
    })
  })

  describe('search', () => {
    it('returns empty results when no agents match', async () => {
      // Count returns 0
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      const result = await service.search({ wallet: '0xNONE', limit: 20, offset: 0 })
      expect(result.agents).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('searches by wallet address', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 1 }] })
      db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_1', display_name: 'Agent', erc8004_id: null, created_at: '2026-03-12' }] })
      const result = await service.search({ wallet: '0xABC', limit: 20, offset: 0 })
      expect(result.agents).toHaveLength(1)
      expect(result.total).toBe(1)
      // Verify wallet join was used
      expect(db.query.mock.calls[0][0]).toContain('wallet_mappings')
      expect(db.query.mock.calls[0][0]).toContain('LOWER')
    })

    it('searches by display name with ILIKE', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 1 }] })
      db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_2', display_name: 'Test Agent', erc8004_id: null, created_at: '2026-03-12' }] })
      const result = await service.search({ q: 'Test', limit: 20, offset: 0 })
      expect(result.agents).toHaveLength(1)
      expect(db.query.mock.calls[0][0]).toContain('ILIKE')
    })

    it('searches by erc8004_id', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 1 }] })
      db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_3', display_name: null, erc8004_id: '42', created_at: '2026-03-12' }] })
      const result = await service.search({ erc8004_id: '42', limit: 20, offset: 0 })
      expect(result.agents).toHaveLength(1)
      expect(db.query.mock.calls[0][0]).toContain('erc8004_id')
    })
  })

  describe('leaderboard', () => {
    it('returns empty when no agents exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
      const result = await service.leaderboard({ sort: 'wallet_count', limit: 20, offset: 0 })
      expect(result.agents).toHaveLength(0)
    })

    it('returns ranked agents with counts', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 2 }] })
      db.query.mockResolvedValueOnce({ rows: [
        { id: 'ae_1', display_name: 'Top', erc8004_id: null, created_at: '2026-03-12', wallet_count: 5, protocol_count: 3, evidence_count: 10 },
        { id: 'ae_2', display_name: 'Second', erc8004_id: null, created_at: '2026-03-11', wallet_count: 3, protocol_count: 2, evidence_count: 5 },
      ] })
      const result = await service.leaderboard({ sort: 'wallet_count', limit: 20, offset: 0 })
      expect(result.agents).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.agents[0].wallet_count).toBe(5)
    })
  })

  describe('getMetrics', () => {
    it('returns null when entity not found', async () => {
      const result = await service.getMetrics('ae_nonexistent')
      expect(result).toBeNull()
    })

    it('returns full metrics breakdown', async () => {
      // Entity exists
      db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_1', created_at: '2026-03-12', updated_at: '2026-03-12' }] })
      // 9 parallel queries:
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 2 }] }) // wallet total
      db.query.mockResolvedValueOnce({ rows: [{ chain: 'base', cnt: 1 }, { chain: 'solana', cnt: 1 }] }) // by chain
      db.query.mockResolvedValueOnce({ rows: [{ link_type: 'self_claim', cnt: 2 }] }) // by link_type
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 3 }] }) // evidence total
      db.query.mockResolvedValueOnce({ rows: [{ evidence_type: 'signed_message', cnt: 2 }, { evidence_type: 'gateway_correlation', cnt: 1 }] }) // by type
      db.query.mockResolvedValueOnce({ rows: [{ protocol: 'lucid' }, { protocol: 'erc8004' }] }) // protocols
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 1 }] }) // active conflicts
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // resolved conflicts
      db.query.mockResolvedValueOnce({ rows: [{ last_verified: '2026-03-12T12:00:00Z' }] }) // last evidence

      const result = await service.getMetrics('ae_1')
      expect(result).not.toBeNull()
      expect(result!.wallets.total).toBe(2)
      expect(result!.wallets.by_chain).toEqual({ base: 1, solana: 1 })
      expect(result!.evidence.total).toBe(3)
      expect(result!.protocols.total).toBe(2)
      expect(result!.conflicts.active).toBe(1)
    })
  })

  describe('getActivity', () => {
    it('returns activity events sorted by timestamp', async () => {
      db.query.mockResolvedValueOnce({ rows: [
        { type: 'evidence_added', timestamp: '2026-03-12T12:00:00Z', detail: { evidence_type: 'signed_message', chain: 'base', address: '0xABC' } },
        { type: 'wallet_linked', timestamp: '2026-03-12T11:00:00Z', detail: { chain: 'solana', address: '7xK', link_type: 'lucid_passport' } },
      ] })

      const result = await service.getActivity('ae_1', { limit: 20, offset: 0 })
      expect(result.events).toHaveLength(2)
      expect(result.events[0].type).toBe('evidence_added')
    })
  })

  describe('getProtocol', () => {
    it('returns null for unknown protocol', async () => {
      const result = await service.getProtocol('unknown')
      expect(result).toBeNull()
      expect(db.query).not.toHaveBeenCalled()
    })

    it('returns protocol with dynamic counts', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 42 }] }) // agent count
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 85 }] }) // wallet count

      const result = await service.getProtocol('lucid')
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Lucid')
      expect(result!.agent_count).toBe(42)
      expect(result!.wallet_count).toBe(85)
    })
  })

  describe('getProtocolMetrics', () => {
    it('returns null for unknown protocol', async () => {
      const result = await service.getProtocolMetrics('unknown')
      expect(result).toBeNull()
    })

    it('returns full protocol metrics', async () => {
      // 8 parallel queries
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 42 }] }) // agent total
      db.query.mockResolvedValueOnce({ rows: [{ link_type: 'gateway_correlation', cnt: 30 }] }) // agents by link_type
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 85 }] }) // wallet total
      db.query.mockResolvedValueOnce({ rows: [{ chain: 'base', cnt: 50 }, { chain: 'solana', cnt: 35 }] }) // wallets by chain
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 120 }] }) // evidence total
      db.query.mockResolvedValueOnce({ rows: [{ evidence_type: 'signed_message', cnt: 80 }] }) // evidence by type
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 5 }] }) // recent registrations
      db.query.mockResolvedValueOnce({ rows: [{ cnt: 2 }] }) // active conflicts

      const result = await service.getProtocolMetrics('lucid')
      expect(result).not.toBeNull()
      expect(result!.agents.total).toBe(42)
      expect(result!.wallets.by_chain).toEqual({ base: 50, solana: 35 })
      expect(result!.recent_registrations_7d).toBe(5)
    })
  })
})
