import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyContextConfig {
    cache?: { ttl: number; key: (req: FastifyRequest) => string }
  }
}

export interface RedisClientType {
  get(key: string): Promise<string | null>
  setEx(key: string, ttl: number, value: string): Promise<unknown>
}

export interface CachePluginOptions {
  redis: RedisClientType | null
}

const cachePlugin: FastifyPluginAsync<CachePluginOptions> = async (fastify, opts) => {
  const { redis } = opts

  fastify.addHook('preHandler', async (request, reply) => {
    const cacheConfig = request.routeOptions?.config?.cache
    if (!cacheConfig || !redis) return
    if (request.method !== 'GET' && request.method !== 'HEAD') return

    const key = cacheConfig.key(request)

    try {
      const cached = await redis.get(key)
      if (cached !== null) {
        void reply.header('x-cache', 'HIT')
        void reply.header('content-type', 'application/json')
        void reply.send(cached)
      }
    } catch {
      // Redis error — fall through to handler
    }
  })

  fastify.addHook('onSend', async (request, reply, payload) => {
    const cacheConfig = request.routeOptions?.config?.cache
    if (!cacheConfig || !redis) return payload
    if (request.method !== 'GET' && request.method !== 'HEAD') return payload
    if (reply.statusCode !== 200) return payload
    if (reply.getHeader('x-cache') === 'HIT') return payload

    void reply.header('x-cache', 'MISS')

    const key = cacheConfig.key(request)
    const value = typeof payload === 'string' ? payload : JSON.stringify(payload)

    try {
      await redis.setEx(key, cacheConfig.ttl, value)
    } catch {
      // Redis error — skip silently
    }

    return payload
  })
}

export default fp(cachePlugin, { name: 'cache' })
