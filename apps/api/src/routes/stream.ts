import type { FastifyInstance } from 'fastify'
import { SignJWT, jwtVerify } from 'jose'
import { CHANNELS, type Channel } from '@lucid/oracle-core'
import { requireTier } from '../plugins/auth.js'
import { StreamTokenResponse, StreamQuery } from '../schemas/stream.js'
import { getSubscriber } from '../services/redis.js'
import type { EventBus } from '../services/event-bus.js'

const TOKEN_TTL_SECONDS = 300 // 5 minutes

function getTokenSecret(): Uint8Array {
  const secret = process.env.STREAM_TOKEN_SECRET
  if (!secret) throw new Error('STREAM_TOKEN_SECRET is required')
  return new TextEncoder().encode(secret)
}

export async function createStreamToken(
  tenantId: string,
  plan: string,
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): Promise<string> {
  const jwt = new SignJWT({ tenantId, plan })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttlSeconds > 0 ? `${ttlSeconds}s` : new Date(Date.now() - 1000))
  return jwt.sign(getTokenSecret())
}

export async function verifyStreamToken(
  token: string,
): Promise<{ tenantId: string; plan: string }> {
  const { payload } = await jwtVerify(token, getTokenSecret())
  return { tenantId: payload.tenantId as string, plan: payload.plan as string }
}

// ── Channel / filter validation ──────────────────────────────

export function validateStreamParams(
  channelsRaw: string,
  filterRaw: string | undefined,
): { channels?: Channel[]; filters?: Record<string, string[]>; error?: string } {
  if (!channelsRaw) return { error: 'channels parameter is required' }

  const channels = channelsRaw.split(',').map((s) => s.trim()) as Channel[]
  for (const ch of channels) {
    if (!CHANNELS.includes(ch)) {
      return { error: `Invalid channel: ${ch}. Valid: ${CHANNELS.join(', ')}` }
    }
  }
  if (channels.length === 0) return { error: 'At least one channel is required' }

  let filters: Record<string, string[]> | undefined
  if (filterRaw) {
    try {
      filters = JSON.parse(filterRaw)
    } catch {
      return { error: 'Malformed filter JSON' }
    }
    for (const key of Object.keys(filters!)) {
      if (!channels.includes(key as Channel)) {
        return { error: `Filter key '${key}' does not match subscribed channels: ${channels.join(', ')}` }
      }
    }
  }

  return { channels, filters }
}

// ── Connection tracking ──────────────────────────────────────

const connections = new Map<string, number>() // tenantId → active count
const MAX_CONNECTIONS_PRO = 3

function matchesFilter(
  event: Record<string, unknown>,
  channel: string,
  filters?: Record<string, string[]>,
): boolean {
  if (!filters || !filters[channel]) return true
  const allowed = filters[channel]
  // For feeds channel, check feedId
  if (channel === 'feeds' && event.payload) {
    const payload = event.payload as Record<string, unknown>
    return allowed.includes(payload.feedId as string)
  }
  // For agent_events, check agentId
  if (channel === 'agent_events' && event.payload) {
    const payload = event.payload as Record<string, unknown>
    return allowed.includes(payload.agentId as string)
  }
  return true
}

// ── Route registration ───────────────────────────────────────

export function registerStreamRoutes(
  app: FastifyInstance,
  _eventBus: EventBus,
): void {
  // POST /v1/oracle/stream/token — issue JWT for browser EventSource
  app.post('/v1/oracle/stream/token', {
    schema: {
      tags: ['streaming'],
      summary: 'Issue a short-lived SSE stream token',
      response: {
        200: StreamTokenResponse,
        403: { $ref: 'ProblemDetail' },
      },
    },
    preHandler: [requireTier('pro')],
  }, async (request, reply) => {
    const { id, plan } = request.tenant
    if (!id) {
      return reply.code(401).header('content-type', 'application/problem+json').send({
        type: 'https://oracle.lucid.foundation/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'API key required for stream tokens',
      })
    }
    const token = await createStreamToken(id, plan)
    return { token, expiresIn: TOKEN_TTL_SECONDS }
  })

  // GET /v1/oracle/stream — SSE endpoint
  app.get('/v1/oracle/stream', {
    schema: {
      tags: ['streaming'],
      summary: 'SSE: live feed updates, agent events, reports',
      querystring: StreamQuery,
      response: {
        400: { $ref: 'ProblemDetail' },
        401: { $ref: 'ProblemDetail' },
        403: { $ref: 'ProblemDetail' },
        503: { $ref: 'ProblemDetail' },
      },
    },
  }, async (request, reply) => {
    // ── Auth: JWT token or x-api-key ──
    const query = request.query as StreamQuery
    let tenantId: string | null = null
    let plan = 'free'

    if (query.token) {
      try {
        const claims = await verifyStreamToken(query.token)
        tenantId = claims.tenantId
        plan = claims.plan
      } catch {
        return reply.code(401).header('content-type', 'application/problem+json').send({
          type: 'https://oracle.lucid.foundation/errors/invalid-token',
          title: 'Invalid stream token',
          status: 401,
          detail: 'Stream token is invalid or expired. Request a new one via POST /v1/oracle/stream/token.',
        })
      }
    } else {
      // Fall back to x-api-key (already resolved by auth plugin)
      tenantId = request.tenant?.id ?? null
      plan = request.tenant?.plan ?? 'free'
    }

    // ── Tier check ──
    const tierRank: Record<string, number> = { free: 0, pro: 1, growth: 2 }
    if ((tierRank[plan] ?? 0) < 1) {
      return reply.code(403).header('content-type', 'application/problem+json').send({
        type: 'https://oracle.lucid.foundation/errors/tier-required',
        title: 'Pro tier required',
        status: 403,
        detail: 'SSE streaming requires a Pro or Growth plan.',
      })
    }

    // ── Validate params ──
    const parsed = validateStreamParams(query.channels, query.filter)
    if (parsed.error) {
      return reply.code(400).header('content-type', 'application/problem+json').send({
        type: 'https://oracle.lucid.foundation/errors/invalid-params',
        title: 'Invalid parameters',
        status: 400,
        detail: parsed.error,
      })
    }

    // ── Connection limit ──
    const tenantKey = tenantId ?? request.ip
    const current = connections.get(tenantKey) ?? 0
    if (plan !== 'growth' && current >= MAX_CONNECTIONS_PRO) {
      return reply.code(429).header('content-type', 'application/problem+json').send({
        type: 'https://oracle.lucid.foundation/errors/connection-limit',
        title: 'Connection limit exceeded',
        status: 429,
        detail: `Pro tier allows ${MAX_CONNECTIONS_PRO} concurrent SSE connections.`,
      })
    }

    // ── Redis subscriber ──
    const subscriber = await getSubscriber()
    if (!subscriber) {
      return reply.code(503).header('content-type', 'application/problem+json').send({
        type: 'https://oracle.lucid.foundation/errors/service-unavailable',
        title: 'Service unavailable',
        status: 503,
        detail: 'Real-time streaming is temporarily unavailable.',
      })
    }

    // ── Hijack response for SSE ──
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    })

    // Track connection
    connections.set(tenantKey, current + 1)

    // Initial frames
    raw.write(': connected\n\n')
    raw.write('retry: 5000\n\n')

    // Subscribe to channels
    const channels = parsed.channels!
    const filters = parsed.filters

    const messageHandler = (message: string, channelKey: string) => {
      // channelKey is e.g. 'oracle:events:feeds'
      const channel = channelKey.replace('oracle:events:', '')
      try {
        const event = JSON.parse(message)
        if (!matchesFilter(event, channel, filters)) return
        raw.write(`id: ${event.id ?? ''}\n`)
        raw.write(`event: ${channel}\n`)
        raw.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        // Malformed event — skip
      }
    }

    // Subscribe via a duplicate client for this connection
    const subClient = subscriber.duplicate() as typeof subscriber
    await subClient.connect()
    for (const ch of channels) {
      await subClient.subscribe(`oracle:events:${ch}`, messageHandler)
    }

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (!raw.destroyed) raw.write(': heartbeat\n\n')
    }, 15_000)

    // Cleanup on disconnect
    let cleaned = false
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      clearInterval(heartbeat)
      const count = connections.get(tenantKey) ?? 1
      if (count <= 1) connections.delete(tenantKey)
      else connections.set(tenantKey, count - 1)
      try {
        for (const ch of channels) {
          await subClient.unsubscribe(`oracle:events:${ch}`)
        }
        await subClient.quit()
      } catch {
        // Already closed
      }
    }

    raw.on('close', cleanup)
    request.raw.on('close', cleanup)
  })
}
