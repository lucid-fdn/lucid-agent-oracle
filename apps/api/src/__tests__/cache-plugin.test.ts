import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import cachePlugin from '../plugins/cache.js'

describe('cache plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cached response on HIT with X-Cache: HIT', async () => {
    const cached = JSON.stringify({ hello: 'world' })
    const redis = { get: vi.fn().mockResolvedValue(cached), setEx: vi.fn() }

    const app = Fastify()
    await app.register(cachePlugin, { redis: redis as any })

    app.get('/test', { config: { cache: { ttl: 60, key: () => 'test-key' } } } as any, async () => {
      return { should: 'not reach here' }
    })

    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/test' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache']).toBe('HIT')
    expect(res.json()).toEqual({ hello: 'world' })
    expect(redis.get).toHaveBeenCalledWith('test-key')
    expect(redis.setEx).not.toHaveBeenCalled()
    await app.close()
  })

  it('stores response on MISS with X-Cache: MISS', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null), setEx: vi.fn().mockResolvedValue('OK') }

    const app = Fastify()
    await app.register(cachePlugin, { redis: redis as any })

    app.get('/test', { config: { cache: { ttl: 60, key: () => 'test-key' } } } as any, async () => {
      return { data: 'fresh' }
    })

    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/test' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-cache']).toBe('MISS')
    expect(res.json()).toEqual({ data: 'fresh' })
    expect(redis.get).toHaveBeenCalledWith('test-key')
    expect(redis.setEx).toHaveBeenCalledWith('test-key', 60, expect.any(String))
    await app.close()
  })

  it('does not cache non-200 responses', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null), setEx: vi.fn() }

    const app = Fastify()
    await app.register(cachePlugin, { redis: redis as any })

    app.get('/test', { config: { cache: { ttl: 60, key: () => 'test-key' } } } as any, async (_req, reply) => {
      reply.status(404)
      return { error: 'not found' }
    })

    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/test' })

    expect(res.statusCode).toBe(404)
    expect(redis.setEx).not.toHaveBeenCalled()
    await app.close()
  })

  it('skips cache entirely when no config.cache on route', async () => {
    const redis = { get: vi.fn(), setEx: vi.fn() }

    const app = Fastify()
    await app.register(cachePlugin, { redis: redis as any })

    app.get('/test', async () => {
      return { uncached: true }
    })

    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/test' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ uncached: true })
    expect(redis.get).not.toHaveBeenCalled()
    expect(res.headers['x-cache']).toBeUndefined()
    await app.close()
  })
})
