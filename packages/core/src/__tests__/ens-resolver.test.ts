import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveNames } from '../adapters/ens-resolver.js'

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

describe('ENS Resolver', () => {
  let pool: ReturnType<typeof mockPool>

  beforeEach(() => {
    pool = mockPool()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when no API key or RPC URL', async () => {
    const result = await resolveNames(pool as any, {
      intervalMs: 60_000,
      addressesPerCycle: 50,
    })
    expect(result).toBe(0)
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('returns 0 when advisory lock is not acquired', async () => {
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: false }],
    })

    const result = await resolveNames(pool as any, {
      moralisApiKey: 'test-key',
      intervalMs: 60_000,
      addressesPerCycle: 50,
    })
    expect(result).toBe(0)
    expect(pool._client.release).toHaveBeenCalled()
  })

  it('processes addresses and upserts resolutions', async () => {
    // Lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // Addresses to resolve
    pool._client.query.mockResolvedValueOnce({
      rows: [
        { chain: 'eth', address: '0xabc123' },
      ],
    })

    // Mock Moralis fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'alice.eth' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Upsert query
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await resolveNames(pool as any, {
      moralisApiKey: 'test-key',
      intervalMs: 60_000,
      addressesPerCycle: 50,
    })

    expect(result).toBe(1)
    expect(pool._client.release).toHaveBeenCalled()

    // Check upsert was called with resolved name
    const upsertCall = pool._client.query.mock.calls[2]
    expect(upsertCall[0]).toContain('oracle_name_resolution')
    expect(upsertCall[1]).toContain('alice.eth')

    vi.unstubAllGlobals()
  })

  it('always releases client even on error', async () => {
    pool._client.query.mockRejectedValueOnce(new Error('DB error'))

    await expect(resolveNames(pool as any, {
      moralisApiKey: 'test-key',
      intervalMs: 60_000,
      addressesPerCycle: 50,
    })).rejects.toThrow('DB error')

    expect(pool._client.release).toHaveBeenCalled()
  })
})
