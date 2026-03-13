import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import fp from 'fastify-plugin'
import { registerProtocolRoutes } from '../routes/protocols.js'
import { ProblemDetail } from '../schemas/common.js'

// ---------------------------------------------------------------------------
// Mock auth plugin — mirrors the real auth plugin's request.tenant shape
// ---------------------------------------------------------------------------

const mockAuthPlugin = fp(async (fastify) => {
  fastify.decorateRequest('tenant', null as unknown as { id: string | null; plan: string })

  fastify.addHook('onRequest', async (request) => {
    const apiKey = request.headers['x-api-key']
    if (apiKey === 'pro-key') {
      request.tenant = { id: 'tenant-1', plan: 'pro' }
    } else {
      request.tenant = { id: null, plan: 'free' }
    }
  })
}, { name: 'auth' })

// ---------------------------------------------------------------------------
// Mock DB
// ---------------------------------------------------------------------------

function mockDb() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Protocol routes', () => {
  const db = mockDb()
  const app = Fastify()

  beforeAll(async () => {
    app.addSchema(ProblemDetail)
    await app.register(mockAuthPlugin)
    registerProtocolRoutes(app, db)
    await app.ready()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => { db.query.mockReset().mockResolvedValue({ rows: [] }) })

  // ---- GET /v1/oracle/protocols ----

  it('GET /protocols returns all protocols in { data } envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/protocols' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
    // Each entry should have id, name, chains, status
    const first = body.data[0]
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('name')
    expect(first).toHaveProperty('chains')
    expect(first).toHaveProperty('status')
  })

  // ---- GET /v1/oracle/protocols/:id ----

  it('GET /protocols/:id returns 404 with Problem Details for unknown', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/protocols/unknown' })
    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.type).toContain('not-found')
    expect(body.title).toBe('Protocol Not Found')
    expect(body.status).toBe(404)
  })

  it('GET /protocols/:id returns detail with stats in { data }', async () => {
    // service.getProtocol fires 2 parallel queries: agent count, wallet count
    db.query.mockResolvedValueOnce({ rows: [{ cnt: 42 }] }) // agent count
    db.query.mockResolvedValueOnce({ rows: [{ cnt: 85 }] }) // wallet count
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/protocols/lucid' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toBeDefined()
    expect(body.data.id).toBe('lucid')
    expect(body.data.name).toBe('Lucid')
    expect(body.data.stats.agent_count).toBe(42)
    expect(body.data.stats.wallet_count).toBe(85)
  })

  // ---- GET /v1/oracle/protocols/:id/metrics ----

  it('metrics returns 403 for free tier (Problem Details)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/oracle/protocols/lucid/metrics' })
    expect(res.statusCode).toBe(403)
    const body = res.json()
    expect(body.type).toContain('tier-required')
    expect(body.status).toBe(403)
  })

  it('metrics returns data for pro tier in { data } envelope', async () => {
    // service.getProtocolMetrics fires 8 parallel queries
    for (let i = 0; i < 8; i++) {
      db.query.mockResolvedValueOnce({ rows: [{ cnt: i + 1 }] })
    }
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oracle/protocols/lucid/metrics',
      headers: { 'x-api-key': 'pro-key' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toBeDefined()
    expect(body.data.protocol_id).toBe('lucid')
    expect(body.data.agents).toBeDefined()
    expect(body.data.wallets).toBeDefined()
    expect(body.data.evidence).toBeDefined()
    expect(body.data).toHaveProperty('recent_registrations_7d')
    expect(body.data).toHaveProperty('active_conflicts')
  })

  it('metrics returns 404 for unknown protocol', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oracle/protocols/unknown/metrics',
      headers: { 'x-api-key': 'pro-key' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.type).toContain('not-found')
    expect(body.status).toBe(404)
  })
})
