import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the conflict resolution logic directly (not HTTP layer)
import { resolveConflict } from '../routes/identity-admin.js'

function mockDb() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

function mockProducer() {
  return { publishJson: vi.fn().mockResolvedValue(undefined) } as any
}

describe('Admin conflict resolution', () => {
  let db: ReturnType<typeof mockDb>
  let producer: ReturnType<typeof mockProducer>

  beforeEach(() => {
    db = mockDb()
    producer = mockProducer()
    vi.clearAllMocks()
  })

  it('keep_existing: resolves conflict without mapping changes', async () => {
    // 1. Lookup conflict
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, status: 'open', chain: 'base', address: '0xABC', existing_entity: 'ae_1', claiming_entity: 'ae_2' }],
    })
    // 2. BEGIN
    db.query.mockResolvedValueOnce({ rows: [] })
    // 3. UPDATE oracle_identity_conflicts
    db.query.mockResolvedValueOnce({ rows: [] })
    // 4. COMMIT
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await resolveConflict(db, producer, 1, {
      resolution: 'keep_existing',
      resolved_by: 'admin-1',
      resolution_reason: 'Verified on-chain',
    })

    expect(result.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE oracle_identity_conflicts'),
      expect.arrayContaining(['resolved', 'keep_existing', 'admin-1']),
    )
  })

  it('keep_claiming: soft-deletes existing mapping and creates new (in transaction)', async () => {
    // 1. Lookup conflict
    db.query.mockResolvedValueOnce({
      rows: [{ id: 2, status: 'open', chain: 'base', address: '0xDEF', existing_entity: 'ae_1', claiming_entity: 'ae_2' }],
    })
    // 2. BEGIN
    db.query.mockResolvedValueOnce({ rows: [] })
    // 3. Soft-delete existing mapping
    db.query.mockResolvedValueOnce({ rows: [] })
    // 4. Insert new mapping
    db.query.mockResolvedValueOnce({ rows: [] })
    // 5. Resolve conflict
    db.query.mockResolvedValueOnce({ rows: [] })
    // 6. COMMIT
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await resolveConflict(db, producer, 2, {
      resolution: 'keep_claiming',
      resolved_by: 'admin-1',
      resolution_reason: 'Self-claim with signature proof',
    })

    expect(result.status).toBe(200)
    // Should publish watchlist updates after commit
    expect(producer.publishJson).toHaveBeenCalled()
  })

  it('rejects resolution of non-open conflict', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 3, status: 'resolved' }],
    })

    const result = await resolveConflict(db, producer, 3, {
      resolution: 'keep_existing',
      resolved_by: 'admin-1',
      resolution_reason: 'test',
    })

    expect(result.status).toBe(409)
    expect(result.error).toContain('already resolved')
  })

  it('returns 404 for missing conflict', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await resolveConflict(db, producer, 999, {
      resolution: 'keep_existing',
      resolved_by: 'admin-1',
      resolution_reason: 'test',
    })

    expect(result.status).toBe(404)
  })
})
