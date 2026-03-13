import type { FastifyInstance } from 'fastify'
import type { DbClient } from '@lucid/oracle-core'
import { AgentQueryService } from '../services/agent-query.js'

export function registerProtocolRoutes(app: FastifyInstance, db: DbClient): void {
  const service = new AgentQueryService(db)

  // ---- GET /v1/oracle/protocols/:id ----
  app.get('/v1/oracle/protocols/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const protocol = await service.getProtocol(id)
    if (!protocol) {
      return reply.status(404).send({ error: 'Protocol not found' })
    }

    return reply.send({ protocol })
  })

  // ---- GET /v1/oracle/protocols/:id/metrics (Pro) ----
  app.get('/v1/oracle/protocols/:id/metrics', async (request, reply) => {
    const tier = (request.headers['x-api-tier'] as string) ?? 'free'
    if (tier === 'free') {
      return reply.status(403).send({ error: 'Pro tier required' })
    }

    const { id } = request.params as { id: string }

    const metrics = await service.getProtocolMetrics(id)
    if (!metrics) {
      return reply.status(404).send({ error: 'Protocol not found' })
    }

    return reply.send(metrics)
  })
}
