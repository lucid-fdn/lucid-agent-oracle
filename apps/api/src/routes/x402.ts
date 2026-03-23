import type { FastifyInstance } from 'fastify'
import type { DbClient } from '@lucid/oracle-core'
import { Type } from '@sinclair/typebox'
import { sendProblem } from '../schemas/common.js'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const X402EndpointSchema = Type.Object({
  agent_entity: Type.String(),
  chain: Type.String(),
  endpoint_url: Type.String(),
  pay_to_address: Type.String(),
  token_address: Type.String(),
  max_amount: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  discovered_at: Type.String(),
  last_verified_at: Type.String(),
  is_active: Type.Boolean(),
})

const X402PaymentSchema = Type.Object({
  payer_agent: Type.String(),
  payee_agent: Type.String(),
  endpoint_url: Type.String(),
  amount: Type.String(),
  amount_usd: Type.Union([Type.Number(), Type.Null()]),
  token_address: Type.String(),
  chain: Type.String(),
  tx_hash: Type.String(),
  event_timestamp: Type.String(),
})

const EndpointsResponse = Type.Object({
  data: Type.Array(X402EndpointSchema),
  total: Type.Integer(),
})

const PaymentsQuery = Type.Object({
  agent_id: Type.Optional(Type.String()),
  role: Type.Optional(
    Type.Union([
      Type.Literal('payer'),
      Type.Literal('payee'),
      Type.Literal('any'),
    ], { default: 'any' }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
})

const PaymentsResponse = Type.Object({
  data: Type.Array(X402PaymentSchema),
  total: Type.Integer(),
})

const StatsResponse = Type.Object({
  data: Type.Object({
    total_endpoints: Type.Integer(),
    active_endpoints: Type.Integer(),
    total_payments: Type.Integer(),
    total_volume_usd: Type.Number(),
    unique_payers: Type.Integer(),
    unique_payees: Type.Integer(),
    top_endpoints: Type.Array(Type.Object({
      endpoint_url: Type.String(),
      payee_agent: Type.String(),
      payment_count: Type.Integer(),
      volume_usd: Type.Number(),
    })),
    top_payers: Type.Array(Type.Object({
      agent: Type.String(),
      payment_count: Type.Integer(),
      volume_usd: Type.Number(),
    })),
    top_payees: Type.Array(Type.Object({
      agent: Type.String(),
      payment_count: Type.Integer(),
      volume_usd: Type.Number(),
    })),
  }),
})

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerX402Routes(
  app: FastifyInstance,
  db: DbClient,
): void {

  // ---- GET /v1/oracle/x402/endpoints ----
  app.get('/v1/oracle/x402/endpoints', {
    schema: {
      tags: ['agents'],
      summary: 'List discovered x402 endpoints',
      description: 'Returns all discovered x402-compatible agent service endpoints with payment parameters.',
      response: {
        200: EndpointsResponse,
      },
    },
    config: {
      rateLimit: { max: 30 },
    },
  }, async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT agent_entity, chain, endpoint_url, pay_to_address,
              token_address, max_amount, description,
              discovered_at, last_verified_at, is_active
       FROM oracle_x402_endpoints
       ORDER BY is_active DESC, last_verified_at DESC
       LIMIT 200`,
    )

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM oracle_x402_endpoints`,
    )

    const data = rows.map(row => ({
      agent_entity: String(row.agent_entity),
      chain: String(row.chain),
      endpoint_url: String(row.endpoint_url),
      pay_to_address: String(row.pay_to_address),
      token_address: String(row.token_address),
      max_amount: String(row.max_amount),
      description: row.description ? String(row.description) : null,
      discovered_at: String(row.discovered_at),
      last_verified_at: String(row.last_verified_at),
      is_active: Boolean(row.is_active),
    }))

    return reply.send({
      data,
      total: countResult.rows[0]?.cnt ?? 0,
    })
  })

  // ---- GET /v1/oracle/x402/payments ----
  app.get('/v1/oracle/x402/payments', {
    schema: {
      tags: ['agents'],
      summary: 'List x402 payments',
      description: 'Returns x402 agent-to-agent payments, optionally filtered by agent ID and role.',
      querystring: PaymentsQuery,
      response: {
        200: PaymentsResponse,
      },
    },
    config: {
      rateLimit: { max: 30 },
    },
  }, async (request, reply) => {
    const query = request.query as {
      agent_id?: string
      role?: string
      limit?: number
      offset?: number
    }
    const agentId = query.agent_id
    const role = query.role ?? 'any'
    const limit = query.limit ?? 50
    const offset = query.offset ?? 0

    let sql: string
    let countSql: string
    const params: unknown[] = []
    const countParams: unknown[] = []

    if (agentId) {
      if (role === 'payer') {
        sql = `SELECT payer_agent, payee_agent, endpoint_url, amount, amount_usd,
                      token_address, chain, tx_hash, event_timestamp
               FROM oracle_x402_payments
               WHERE payer_agent = $1::text
               ORDER BY event_timestamp DESC
               LIMIT $2::int OFFSET $3::int`
        countSql = `SELECT COUNT(*)::int AS cnt FROM oracle_x402_payments WHERE payer_agent = $1::text`
        params.push(agentId, limit, offset)
        countParams.push(agentId)
      } else if (role === 'payee') {
        sql = `SELECT payer_agent, payee_agent, endpoint_url, amount, amount_usd,
                      token_address, chain, tx_hash, event_timestamp
               FROM oracle_x402_payments
               WHERE payee_agent = $1::text
               ORDER BY event_timestamp DESC
               LIMIT $2::int OFFSET $3::int`
        countSql = `SELECT COUNT(*)::int AS cnt FROM oracle_x402_payments WHERE payee_agent = $1::text`
        params.push(agentId, limit, offset)
        countParams.push(agentId)
      } else {
        sql = `SELECT payer_agent, payee_agent, endpoint_url, amount, amount_usd,
                      token_address, chain, tx_hash, event_timestamp
               FROM oracle_x402_payments
               WHERE payer_agent = $1::text OR payee_agent = $1::text
               ORDER BY event_timestamp DESC
               LIMIT $2::int OFFSET $3::int`
        countSql = `SELECT COUNT(*)::int AS cnt FROM oracle_x402_payments WHERE payer_agent = $1::text OR payee_agent = $1::text`
        params.push(agentId, limit, offset)
        countParams.push(agentId)
      }
    } else {
      sql = `SELECT payer_agent, payee_agent, endpoint_url, amount, amount_usd,
                    token_address, chain, tx_hash, event_timestamp
             FROM oracle_x402_payments
             ORDER BY event_timestamp DESC
             LIMIT $1::int OFFSET $2::int`
      countSql = `SELECT COUNT(*)::int AS cnt FROM oracle_x402_payments`
      params.push(limit, offset)
    }

    const [{ rows }, countResult] = await Promise.all([
      db.query(sql, params),
      db.query(countSql, countParams),
    ])

    const data = rows.map(row => ({
      payer_agent: String(row.payer_agent),
      payee_agent: String(row.payee_agent),
      endpoint_url: String(row.endpoint_url),
      amount: String(row.amount),
      amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
      token_address: String(row.token_address),
      chain: String(row.chain),
      tx_hash: String(row.tx_hash),
      event_timestamp: String(row.event_timestamp),
    }))

    return reply.send({
      data,
      total: countResult.rows[0]?.cnt ?? 0,
    })
  })

  // ---- GET /v1/oracle/x402/stats ----
  app.get('/v1/oracle/x402/stats', {
    schema: {
      tags: ['agents'],
      summary: 'x402 payment statistics',
      description: 'Aggregate statistics on x402 agent-to-agent payments: volume, top endpoints, top payers/payees.',
      response: {
        200: StatsResponse,
      },
    },
    config: {
      rateLimit: { max: 30 },
    },
  }, async (_request, reply) => {
    const [
      endpointCountResult,
      activeEndpointCountResult,
      paymentStatsResult,
      topEndpointsResult,
      topPayersResult,
      topPayeesResult,
    ] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS cnt FROM oracle_x402_endpoints`),
      db.query(`SELECT COUNT(*)::int AS cnt FROM oracle_x402_endpoints WHERE is_active = true`),
      db.query(
        `SELECT
           COUNT(*)::int AS total_payments,
           COALESCE(SUM(amount_usd), 0)::numeric AS total_volume_usd,
           COUNT(DISTINCT payer_agent)::int AS unique_payers,
           COUNT(DISTINCT payee_agent)::int AS unique_payees
         FROM oracle_x402_payments`,
      ),
      db.query(
        `SELECT endpoint_url, payee_agent,
                COUNT(*)::int AS payment_count,
                COALESCE(SUM(amount_usd), 0)::numeric AS volume_usd
         FROM oracle_x402_payments
         GROUP BY endpoint_url, payee_agent
         ORDER BY volume_usd DESC
         LIMIT 10`,
      ),
      db.query(
        `SELECT payer_agent AS agent,
                COUNT(*)::int AS payment_count,
                COALESCE(SUM(amount_usd), 0)::numeric AS volume_usd
         FROM oracle_x402_payments
         GROUP BY payer_agent
         ORDER BY volume_usd DESC
         LIMIT 10`,
      ),
      db.query(
        `SELECT payee_agent AS agent,
                COUNT(*)::int AS payment_count,
                COALESCE(SUM(amount_usd), 0)::numeric AS volume_usd
         FROM oracle_x402_payments
         GROUP BY payee_agent
         ORDER BY volume_usd DESC
         LIMIT 10`,
      ),
    ])

    const stats = paymentStatsResult.rows[0] ?? {}

    return reply.send({
      data: {
        total_endpoints: endpointCountResult.rows[0]?.cnt ?? 0,
        active_endpoints: activeEndpointCountResult.rows[0]?.cnt ?? 0,
        total_payments: Number(stats.total_payments ?? 0),
        total_volume_usd: Number(stats.total_volume_usd ?? 0),
        unique_payers: Number(stats.unique_payers ?? 0),
        unique_payees: Number(stats.unique_payees ?? 0),
        top_endpoints: topEndpointsResult.rows.map(row => ({
          endpoint_url: String(row.endpoint_url),
          payee_agent: String(row.payee_agent),
          payment_count: Number(row.payment_count),
          volume_usd: Number(row.volume_usd),
        })),
        top_payers: topPayersResult.rows.map(row => ({
          agent: String(row.agent),
          payment_count: Number(row.payment_count),
          volume_usd: Number(row.volume_usd),
        })),
        top_payees: topPayeesResult.rows.map(row => ({
          agent: String(row.agent),
          payment_count: Number(row.payment_count),
          volume_usd: Number(row.volume_usd),
        })),
      },
    })
  })
}
