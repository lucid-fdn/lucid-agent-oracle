import type { FastifyInstance } from 'fastify'
import type { DbClient, RedpandaProducer } from '@lucid/oracle-core'
import { TOPICS } from '@lucid/oracle-core'
import { LucidResolver } from '../services/lucid-resolver.js'

interface ResolveInput {
  resolution: 'keep_existing' | 'keep_claiming' | 'merge'
  resolved_by: string
  resolution_reason: string
}

interface ResolveResult {
  status: number
  error?: string
  data?: Record<string, unknown>
}

/** Exported for direct testing */
export async function resolveConflict(
  db: DbClient,
  producer: RedpandaProducer,
  conflictId: number,
  input: ResolveInput,
): Promise<ResolveResult> {
  const { rows } = await db.query(
    'SELECT * FROM identity_conflicts WHERE id = $1',
    [conflictId],
  )
  if (rows.length === 0) {
    return { status: 404, error: 'Conflict not found' }
  }

  const conflict = rows[0] as Record<string, any>
  if (conflict.status !== 'open') {
    return { status: 409, error: 'Conflict already resolved' }
  }

  // Wrap resolution in a transaction (especially important for keep_claiming
  // which does soft-delete + insert + status update atomically)
  await db.query('BEGIN')

  try {
    if (input.resolution === 'keep_claiming') {
      // Soft-delete existing mapping
      await db.query(
        `UPDATE wallet_mappings SET removed_at = now()
         WHERE chain = $1 AND LOWER(address) = LOWER($2)
         AND agent_entity = $3 AND removed_at IS NULL`,
        [conflict.chain, conflict.address, conflict.existing_entity],
      )

      // Create new mapping for claiming entity
      await db.query(
        `INSERT INTO wallet_mappings
         (agent_entity, chain, address, link_type, confidence, evidence_hash)
         VALUES ($1, $2, $3, 'self_claim', 1.0, NULL)`,
        [conflict.claiming_entity, conflict.chain, conflict.address],
      )
    }

    // Resolve conflict record
    await db.query(
      `UPDATE identity_conflicts
       SET status = $1, resolution = $2, resolved_by = $3,
           resolution_reason = $4, resolved_at = now()
       WHERE id = $5`,
      ['resolved', input.resolution, input.resolved_by, input.resolution_reason, conflictId],
    )

    await db.query('COMMIT')

    // Publish watchlist updates after commit (non-fatal side effects)
    if (input.resolution === 'keep_claiming') {
      const chain = conflict.chain as string
      if (chain === 'solana' || chain === 'base') {
        await producer.publishJson(TOPICS.WATCHLIST, `watchlist:${chain}`, {
          action: 'remove', chain, address: conflict.address,
          agent_entity_id: conflict.existing_entity,
        }).catch(() => {})
        await producer.publishJson(TOPICS.WATCHLIST, `watchlist:${chain}`, {
          action: 'add', chain, address: conflict.address,
          agent_entity_id: conflict.claiming_entity,
        }).catch(() => {})
      }
    }
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }

  return { status: 200, data: { id: conflictId, resolution: input.resolution } }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  db: DbClient,
  producer: RedpandaProducer,
  adminKey: string,
): void {
  // Admin key middleware
  const checkAdmin = (request: any, reply: any) => {
    if (request.headers['x-admin-key'] !== adminKey) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  }

  // GET /v1/internal/identity/conflicts
  app.get('/v1/internal/identity/conflicts', async (request, reply) => {
    checkAdmin(request, reply)
    if (reply.sent) return

    const query = request.query as Record<string, string>
    const status = query.status ?? 'open'
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100)
    const offset = parseInt(query.offset ?? '0', 10)

    const { rows } = await db.query(
      `SELECT c.*, e.evidence_type, e.chain as evidence_chain
       FROM identity_conflicts c
       LEFT JOIN identity_evidence e ON c.claim_evidence_id = e.id
       WHERE c.status = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    )

    return reply.send({ conflicts: rows, limit, offset })
  })

  // GET /v1/internal/identity/conflicts/:id
  app.get('/v1/internal/identity/conflicts/:id', async (request, reply) => {
    checkAdmin(request, reply)
    if (reply.sent) return

    const { id } = request.params as { id: string }
    const { rows } = await db.query(
      `SELECT c.*,
              json_agg(DISTINCT jsonb_build_object(
                'id', e.id, 'evidence_type', e.evidence_type,
                'chain', e.chain, 'address', e.address, 'verified_at', e.verified_at
              )) FILTER (WHERE e.id IS NOT NULL) AS evidence
       FROM identity_conflicts c
       LEFT JOIN identity_evidence e
         ON e.agent_entity IN (c.existing_entity, c.claiming_entity)
         AND e.chain = c.chain AND LOWER(e.address) = LOWER(c.address)
       WHERE c.id = $1
       GROUP BY c.id`,
      [id],
    )

    if (rows.length === 0) return reply.status(404).send({ error: 'Conflict not found' })
    return reply.send(rows[0])
  })

  // PATCH /v1/internal/identity/conflicts/:id
  app.patch('/v1/internal/identity/conflicts/:id', async (request, reply) => {
    checkAdmin(request, reply)
    if (reply.sent) return

    const { id } = request.params as { id: string }
    const body = request.body as Record<string, string>
    const { resolution, resolution_reason } = body

    if (!resolution || !resolution_reason) {
      return reply.status(400).send({ error: 'resolution and resolution_reason required' })
    }

    const result = await resolveConflict(db, producer, parseInt(id, 10), {
      resolution: resolution as ResolveInput['resolution'],
      resolved_by: 'admin', // From admin key lookup
      resolution_reason,
    })

    return reply.status(result.status).send(result.error ? { error: result.error } : result.data)
  })

  // POST /v1/internal/identity/resolve-lucid
  app.post('/v1/internal/identity/resolve-lucid', async (request, reply) => {
    checkAdmin(request, reply)
    if (reply.sent) return

    const resolver = new LucidResolver(db, producer)
    const result = await resolver.run()
    return reply.send(result)
  })
}
