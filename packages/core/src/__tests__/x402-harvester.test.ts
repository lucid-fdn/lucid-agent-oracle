import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isProbeUrlSafe,
  extractServiceUrls,
  parseX402Header,
  probeEndpoint,
  harvestX402,
} from '../adapters/x402-harvester.js'

// ── Helper: mock pg pool ───────────────────────────────────────

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

// ── isProbeUrlSafe ─────────────────────────────────────────────

describe('isProbeUrlSafe', () => {
  it('allows HTTPS URLs with public hostnames', () => {
    expect(isProbeUrlSafe('https://agent.example.com/api/analyze')).toBe(true)
    expect(isProbeUrlSafe('https://api.olas.network/v1/task')).toBe(true)
  })

  it('rejects HTTP URLs', () => {
    expect(isProbeUrlSafe('http://agent.example.com/api')).toBe(false)
  })

  it('rejects file:// URLs', () => {
    expect(isProbeUrlSafe('file:///etc/passwd')).toBe(false)
  })

  it('rejects localhost', () => {
    expect(isProbeUrlSafe('https://localhost/api')).toBe(false)
    expect(isProbeUrlSafe('https://localhost:8080/api')).toBe(false)
  })

  it('rejects private IP ranges', () => {
    expect(isProbeUrlSafe('https://127.0.0.1/api')).toBe(false)
    expect(isProbeUrlSafe('https://10.0.0.1/api')).toBe(false)
    expect(isProbeUrlSafe('https://172.16.0.1/api')).toBe(false)
    expect(isProbeUrlSafe('https://192.168.1.1/api')).toBe(false)
    expect(isProbeUrlSafe('https://169.254.169.254/api')).toBe(false) // AWS metadata
  })

  it('rejects IPv6 private addresses', () => {
    expect(isProbeUrlSafe('https://[::1]/api')).toBe(false)
    expect(isProbeUrlSafe('https://[fe80::1]/api')).toBe(false)
  })

  it('rejects URLs with userinfo', () => {
    expect(isProbeUrlSafe('https://user:pass@example.com/api')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isProbeUrlSafe('not-a-url')).toBe(false)
    expect(isProbeUrlSafe('')).toBe(false)
  })
})

// ── extractServiceUrls ─────────────────────────────────────────

describe('extractServiceUrls', () => {
  it('extracts direct url fields', () => {
    const urls = extractServiceUrls({ url: 'https://agent.example.com/api' })
    expect(urls).toEqual(['https://agent.example.com/api'])
  })

  it('extracts from services array of strings', () => {
    const urls = extractServiceUrls({
      services: [
        'https://agent1.example.com/api',
        'https://agent2.example.com/api',
      ],
    })
    expect(urls).toHaveLength(2)
    expect(urls).toContain('https://agent1.example.com/api')
  })

  it('extracts from services array of objects', () => {
    const urls = extractServiceUrls({
      services: [
        { url: 'https://agent.example.com/analyze', name: 'analyze' },
        { endpoint: 'https://agent.example.com/predict', name: 'predict' },
      ],
    })
    expect(urls).toHaveLength(2)
  })

  it('filters out unsafe URLs', () => {
    const urls = extractServiceUrls({
      services: [
        'https://public.example.com/api',
        'http://insecure.example.com/api', // HTTP - rejected
        'https://localhost/api', // localhost - rejected
      ],
    })
    expect(urls).toEqual(['https://public.example.com/api'])
  })

  it('deduplicates URLs', () => {
    const urls = extractServiceUrls({
      url: 'https://agent.example.com/api',
      endpoint: 'https://agent.example.com/api',
    })
    expect(urls).toHaveLength(1)
  })

  it('returns empty for null/undefined/non-object metadata', () => {
    expect(extractServiceUrls(null)).toEqual([])
    expect(extractServiceUrls(undefined)).toEqual([])
    expect(extractServiceUrls('string')).toEqual([])
  })

  it('extracts from endpoints and apis arrays', () => {
    const urls = extractServiceUrls({
      endpoints: [{ href: 'https://e1.example.com/api' }],
      apis: [{ uri: 'https://e2.example.com/api' }],
    })
    expect(urls).toHaveLength(2)
  })
})

// ── parseX402Header ────────────────────────────────────────────

describe('parseX402Header', () => {
  it('parses a valid X-Payment header', () => {
    const header = JSON.stringify({
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '100000',
      resource: 'https://agent.example/api/analyze',
      payTo: '0xAgentWallet',
      maxTimeoutSeconds: 60,
      mimeType: 'application/json',
      description: 'Analysis endpoint',
      extra: { token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    })

    const result = parseX402Header(header)
    expect(result).not.toBeNull()
    expect(result!.payTo).toBe('0xAgentWallet')
    expect(result!.maxAmountRequired).toBe('100000')
    expect(result!.network).toBe('base')
    expect(result!.description).toBe('Analysis endpoint')
    expect(result!.extra?.token).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
  })

  it('returns null for missing payTo', () => {
    const header = JSON.stringify({ maxAmountRequired: '100' })
    expect(parseX402Header(header)).toBeNull()
  })

  it('returns null for missing maxAmountRequired', () => {
    const header = JSON.stringify({ payTo: '0xABC' })
    expect(parseX402Header(header)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseX402Header('not-json')).toBeNull()
    expect(parseX402Header('')).toBeNull()
  })

  it('uses defaults for optional fields', () => {
    const header = JSON.stringify({
      payTo: '0xABC',
      maxAmountRequired: '50000',
    })

    const result = parseX402Header(header)
    expect(result).not.toBeNull()
    expect(result!.scheme).toBe('exact')
    expect(result!.network).toBe('base')
    expect(result!.maxTimeoutSeconds).toBe(60)
    expect(result!.mimeType).toBe('application/json')
  })
})

// ── probeEndpoint ──────────────────────────────────────────────

describe('probeEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns parsed header on 402 response', async () => {
    const paymentData = JSON.stringify({
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '100000',
      payTo: '0xPayee',
      description: 'Test endpoint',
      extra: { token: '0xUSDC' },
    })

    const mockFetch = vi.fn().mockResolvedValue({
      status: 402,
      headers: new Map([['x-payment', paymentData]]),
    })

    // Mock Headers.get to work correctly
    mockFetch.mockResolvedValue({
      status: 402,
      headers: {
        get: (name: string) => name.toLowerCase() === 'x-payment' ? paymentData : null,
      },
    })

    vi.stubGlobal('fetch', mockFetch)

    const result = await probeEndpoint('https://agent.example.com/api', 2000)
    expect(result).not.toBeNull()
    expect(result!.payTo).toBe('0xPayee')
    expect(result!.maxAmountRequired).toBe('100000')
  })

  it('returns null on 200 response (no payment required)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await probeEndpoint('https://agent.example.com/api', 2000)
    expect(result).toBeNull()
  })

  it('returns null on 402 without X-Payment header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 402,
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await probeEndpoint('https://agent.example.com/api', 2000)
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', mockFetch)

    const result = await probeEndpoint('https://down.example.com/api', 2000)
    expect(result).toBeNull()
  })

  it('returns null for unsafe URLs without making a request', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const result = await probeEndpoint('http://insecure.example.com/api', 2000)
    expect(result).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends correct headers in probe request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', mockFetch)

    await probeEndpoint('https://agent.example.com/api', 2000)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://agent.example.com/api',
      expect.objectContaining({
        method: 'HEAD',
        redirect: 'manual',
        headers: expect.objectContaining({
          'User-Agent': 'Lucid-Oracle-x402-Discovery/1.0',
        }),
      }),
    )
  })
})

// ── harvestX402 (integration with mocked DB) ───────────────────

describe('harvestX402', () => {
  let pool: ReturnType<typeof mockPool>

  beforeEach(() => {
    pool = mockPool()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 0 when advisory lock is not acquired', async () => {
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: false }],
    })

    const result = await harvestX402(pool as any, {
      intervalMs: 30_000,
      agentsPerCycle: 10,
      probeTimeoutMs: 2_000,
      delayBetweenProbesMs: 0,
    })
    expect(result).toBe(0)
    expect(pool._client.release).toHaveBeenCalled()
  })

  it('discovers endpoints and correlates payments in a single cycle', async () => {
    // 1. Advisory lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // 2. Phase 1: agents with metadata
    pool._client.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'ae_agent_1',
          metadata_json: {
            services: ['https://agent.example.com/api/analyze'],
          },
        },
      ],
    })

    // Mock fetch for the probe — returns 402 with X-Payment
    const paymentData = JSON.stringify({
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '100000',
      payTo: '0xPayeeWallet',
      description: 'Analysis',
      extra: { token: '0xUSDC' },
    })
    const mockFetch = vi.fn().mockResolvedValue({
      status: 402,
      headers: {
        get: (name: string) => name.toLowerCase() === 'x-payment' ? paymentData : null,
      },
    })
    vi.stubGlobal('fetch', mockFetch)

    // 3. Upsert endpoint
    pool._client.query.mockResolvedValueOnce({ rows: [], rowCount: 1 })

    // 4. Phase 2: re-verify stale endpoints (none)
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // 5. Phase 3: correlation insert
    pool._client.query.mockResolvedValueOnce({ rows: [], rowCount: 2 })

    // 6. Advisory unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await harvestX402(pool as any, {
      intervalMs: 30_000,
      agentsPerCycle: 10,
      probeTimeoutMs: 2_000,
      delayBetweenProbesMs: 0,
    })

    // 1 discovered endpoint + 2 correlated payments = 3
    expect(result).toBe(3)
    expect(pool._client.release).toHaveBeenCalled()

    // Verify the endpoint upsert was called with correct args
    const upsertCall = pool._client.query.mock.calls[2]
    expect(upsertCall[0]).toContain('INSERT INTO oracle_x402_endpoints')
    expect(upsertCall[1]).toContain('0xpayeewallet') // lowercased
  })

  it('handles agents with no service URLs gracefully', async () => {
    // Lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // Agent with empty metadata
    pool._client.query.mockResolvedValueOnce({
      rows: [
        { id: 'ae_empty', metadata_json: {} },
      ],
    })

    // Phase 2: no stale endpoints
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Phase 3: no correlations
    pool._client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })

    // Unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await harvestX402(pool as any, {
      intervalMs: 30_000,
      agentsPerCycle: 10,
      probeTimeoutMs: 2_000,
      delayBetweenProbesMs: 0,
    })

    expect(result).toBe(0)
  })

  it('re-verifies stale endpoints and marks inactive if probe fails', async () => {
    // Lock acquired
    pool._client.query.mockResolvedValueOnce({
      rows: [{ pg_try_advisory_lock: true }],
    })

    // Phase 1: no new agents
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Phase 2: one stale endpoint
    pool._client.query.mockResolvedValueOnce({
      rows: [
        { id: 42, endpoint_url: 'https://stale.example.com/api', agent_entity: 'ae_stale' },
      ],
    })

    // Mock fetch for reverify — endpoint is gone (200 = no longer 402)
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
    })
    vi.stubGlobal('fetch', mockFetch)

    // Mark inactive update
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    // Phase 3: no correlations
    pool._client.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })

    // Unlock
    pool._client.query.mockResolvedValueOnce({ rows: [] })

    const result = await harvestX402(pool as any, {
      intervalMs: 30_000,
      agentsPerCycle: 10,
      probeTimeoutMs: 2_000,
      delayBetweenProbesMs: 0,
    })

    expect(result).toBe(0)

    // Verify the inactive update was called
    const markInactiveCall = pool._client.query.mock.calls[3]
    expect(markInactiveCall[0]).toContain('is_active = false')
    expect(markInactiveCall[1]).toContain(42)
  })

  it('always releases client even on error', async () => {
    pool._client.query.mockRejectedValueOnce(new Error('DB error'))

    await expect(
      harvestX402(pool as any, {
        intervalMs: 30_000,
        agentsPerCycle: 10,
        probeTimeoutMs: 2_000,
        delayBetweenProbesMs: 0,
      }),
    ).rejects.toThrow('DB error')
    expect(pool._client.release).toHaveBeenCalled()
  })
})
