import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { authPlugin, requireTier } from '../plugins/auth.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(dbRows: Record<string, unknown>[] = [], redis: unknown = null) {
  const db = { query: vi.fn().mockResolvedValue({ rows: dbRows }) }
  const app = Fastify({ logger: false })
  app.register(authPlugin, { db: db as any, redis: redis as any })
  return { app, db }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decorates request.tenant with free plan when no x-api-key', async () => {
    const { app } = buildApp()

    app.get('/test', async (req) => {
      return { tenant: req.tenant }
    })

    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tenant).toEqual({ id: null, plan: 'free' })

    await app.close()
  })

  it('resolves tenant from DB when x-api-key provided', async () => {
    const { app, db } = buildApp([{ id: 'tenant_123', plan: 'pro' }])

    app.get('/test', async (req) => {
      return { tenant: req.tenant }
    })

    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'test-key-abc' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tenant).toEqual({ id: 'tenant_123', plan: 'pro' })
    // DB should have been queried
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('gateway_tenants'),
      expect.arrayContaining(['test-key-abc']),
    )

    await app.close()
  })

  it('returns 401 for invalid API key', async () => {
    const { app } = buildApp([]) // empty rows → invalid key

    app.get('/test', async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-api-key': 'bad-key' },
    })
    expect(res.statusCode).toBe(401)
    const body = res.json()
    expect(body.type).toContain('invalid-api-key')
    expect(res.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('requireTier returns 403 when plan insufficient', async () => {
    const { app } = buildApp() // no key → free plan

    app.get('/pro-only', { preHandler: requireTier('pro') }, async () => ({ secret: true }))
    await app.ready()

    // No x-api-key → free plan, should fail pro check
    const res = await app.inject({ method: 'GET', url: '/pro-only' })
    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.type).toContain('tier-required')

    await app.close()
  })

  it('requireTier passes when plan meets minimum', async () => {
    const { app } = buildApp([{ id: 'tenant_pro', plan: 'pro' }])

    app.get('/pro-only', { preHandler: requireTier('pro') }, async () => ({ secret: true }))
    await app.ready()

    const res = await app.inject({
      method: 'GET',
      url: '/pro-only',
      headers: { 'x-api-key': 'valid-pro-key' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.secret).toBe(true)

    await app.close()
  })
})
