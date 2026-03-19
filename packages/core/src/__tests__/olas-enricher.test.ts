import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enrichOlasAgents } from '../adapters/olas-enricher.js'

function mockPool() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  }
  return {
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  }
}

describe('Olas Enricher', () => {
  let pool: ReturnType<typeof mockPool>

  beforeEach(() => {
    pool = mockPool()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 0 when advisory lock is not acquired', async () => {
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: false }],
    })

    const result = await enrichOlasAgents(pool as any)
    expect(result).toBe(0)
    expect(pool._client.release).toHaveBeenCalled()
  })

  it('processes agents and enriches from Olas API', async () => {
    // Lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // Agents to enrich
    pool._client.query.mockResolvedValueOnce({
      rows: [
        { id: 'ae_olas_1', agent_uri: 'https://registry.olas.network/gnosis/services/42', metadata_json: null },
      ],
    })

    // Mock fetch — Olas API response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        image: 'https://olas.network/img/agent42.png',
        description: 'A prediction market agent',
        category: 'prediction',
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Update query
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await enrichOlasAgents(pool as any)
    expect(result).toBe(1)
    expect(pool._client.release).toHaveBeenCalled()

    // Check update was called with enrichment data
    const updateCall = pool._client.query.mock.calls[2]
    expect(updateCall[0]).toContain('UPDATE oracle_agent_entities')
    expect(updateCall[1]).toContain('https://olas.network/img/agent42.png')

    vi.unstubAllGlobals()
  })

  it('handles Olas API failure gracefully and marks agent as attempted', async () => {
    // Lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // Agent to enrich
    pool._client.query.mockResolvedValueOnce({
      rows: [
        { id: 'ae_olas_fail', agent_uri: 'https://olas.network/broken', metadata_json: null },
      ],
    })

    // Mock fetch — failure
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    })
    vi.stubGlobal('fetch', mockFetch)

    // "Mark as attempted" update
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await enrichOlasAgents(pool as any)
    expect(result).toBe(0) // not enriched
    expect(pool._client.release).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('extracts service ID from various Olas URI formats', async () => {
    // Lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // Agent with different URI format
    pool._client.query.mockResolvedValueOnce({
      rows: [
        { id: 'ae_olas_2', agent_uri: 'https://marketplace.olas.network/services/123', metadata_json: null },
      ],
    })

    // Mock fetch — Olas API returns data
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        description: 'DeFi optimizer',
        service_type: 'defi',
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Update query
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await enrichOlasAgents(pool as any)
    expect(result).toBe(1)

    // Verify the Olas API was called with the correct service ID
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/services/123'),
      expect.any(Object),
    )

    vi.unstubAllGlobals()
  })

  it('always releases client even on error', async () => {
    pool._client.query.mockRejectedValueOnce(new Error('DB error'))

    await expect(enrichOlasAgents(pool as any)).rejects.toThrow('DB error')
    expect(pool._client.release).toHaveBeenCalled()
  })
})
