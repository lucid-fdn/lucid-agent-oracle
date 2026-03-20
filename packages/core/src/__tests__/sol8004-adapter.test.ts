import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sol8004Adapter } from '../adapters/sol8004-adapter.js'
import { erc8004Adapter } from '../adapters/erc8004-adapter.js'

function mockDb() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }
}

describe('sol8004Adapter', () => {
  it('has correct source and metadata', () => {
    expect(sol8004Adapter.source).toBe('sol8004')
    expect(sol8004Adapter.version).toBe(1)
    expect(sol8004Adapter.chains).toContain('solana')
    expect(sol8004Adapter.description).toContain('Solana 8004')
  })

  it('shares identity handler with erc8004Adapter', () => {
    expect(sol8004Adapter.identity).toBeDefined()
    expect(sol8004Adapter.identity).toBe(erc8004Adapter.identity)
  })

  it('has no webhook handler', () => {
    expect(sol8004Adapter.webhook).toBeUndefined()
  })

  it('handles all event types including feedback_revoked', () => {
    const handler = sol8004Adapter.identity!
    expect(handler.handles).toContain('agent_registered')
    expect(handler.handles).toContain('uri_updated')
    expect(handler.handles).toContain('metadata_set')
    expect(handler.handles).toContain('ownership_transferred')
    expect(handler.handles).toContain('new_feedback')
    expect(handler.handles).toContain('feedback_revoked')
  })
})

describe('sol8004Adapter identity handler (chain=solana)', () => {
  const handler = sol8004Adapter.identity!

  it('creates entity for Solana agent with base58 pubkey as erc8004_id', async () => {
    const db = mockDb()
    // getOrCreateEntity INSERT returns new row
    db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_sol123' }] })
    const event = {
      event_type: 'agent_registered',
      agent_id: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      owner_address: '7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1Q',
      agent_uri: 'https://arweave.net/agent.json',
      tx_hash: '3abc123',
      block_number: 250000000,
      chain: 'solana',
      source: 'sol8004',
    }

    await handler.handleEvent(event, db, null)

    // Should INSERT into oracle_agent_entities with the base58 pubkey
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oracle_agent_entities'),
      expect.arrayContaining(['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']),
    )
  })

  it('handles ownership_transferred on solana chain', async () => {
    const db = mockDb()
    db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_sol_existing' }] })

    await handler.handleEvent({
      event_type: 'ownership_transferred',
      agent_id: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      previous_owner: 'OldOwnerPubkey11111111111111111111111111111',
      new_owner: 'NewOwnerPubkey11111111111111111111111111111',
      tx_hash: '4def456',
      chain: 'solana',
      source: 'sol8004',
    }, db, null)

    // Should soft-delete old owner with chain='solana'
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE oracle_wallet_mappings SET removed_at'),
      expect.arrayContaining(['solana', 'OldOwnerPubkey11111111111111111111111111111']),
    )
    // Should add new owner with chain='solana'
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oracle_wallet_mappings'),
      expect.arrayContaining(['solana', 'NewOwnerPubkey11111111111111111111111111111']),
    )
  })

  it('handles feedback_revoked event', async () => {
    const db = mockDb()
    // SELECT entity
    db.query.mockResolvedValueOnce({ rows: [{ id: 'ae_sol_fb' }] })
    // DELETE feedback
    db.query.mockResolvedValueOnce({ rows: [] })
    // Reputation recompute: count query
    db.query.mockResolvedValueOnce({ rows: [{ feedback_count: '2', avg_value: '4.50' }] })
    // Reputation recompute: latest tags
    db.query.mockResolvedValueOnce({ rows: [{ tag1: 'quality', tag2: 'speed' }] })
    // Reputation UPDATE
    db.query.mockResolvedValueOnce({ rows: [] })

    await handler.handleEvent({
      event_type: 'feedback_revoked',
      agent_id: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      client_address: 'ClientPubkey11111111111111111111111111111',
      feedback_index: 1,
      seal_hash: 'abcd1234',
      chain: 'solana',
      source: 'sol8004',
    }, db, null)

    // Should DELETE from oracle_agent_feedback
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM oracle_agent_feedback'),
      expect.arrayContaining(['ae_sol_fb', 'solana', 1]),
    )
    // Should recompute reputation
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE oracle_agent_entities'),
      expect.arrayContaining([expect.stringContaining('feedback_count'), 'ae_sol_fb']),
    )
  })
})
