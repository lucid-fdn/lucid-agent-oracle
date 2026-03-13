import { Type, type Static } from '@sinclair/typebox'
import { DataEnvelope } from './common.js'

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const ProtocolSummary = Type.Object({
  id: Type.String(),
  name: Type.String(),
  chains: Type.Array(Type.String()),
  status: Type.String(),
})

export type ProtocolSummary = Static<typeof ProtocolSummary>

// ---------------------------------------------------------------------------
// ProtocolListResponse
// ---------------------------------------------------------------------------

export const ProtocolListResponse = Type.Object(
  {
    data: Type.Array(ProtocolSummary),
  },
  { $id: 'ProtocolListResponse' },
)

export type ProtocolListResponse = Static<typeof ProtocolListResponse>

// ---------------------------------------------------------------------------
// ProtocolDetailResponse
// ---------------------------------------------------------------------------

const ProtocolDetailData = Type.Object({
  id: Type.String(),
  name: Type.String(),
  chains: Type.Array(Type.String()),
  status: Type.String(),
  stats: Type.Object({
    agent_count: Type.Integer(),
    wallet_count: Type.Integer(),
  }),
})

export const ProtocolDetailResponse = DataEnvelope(
  ProtocolDetailData,
  'ProtocolDetailResponse',
)

export type ProtocolDetailResponse = Static<typeof ProtocolDetailResponse>

// ---------------------------------------------------------------------------
// ProtocolMetricsResponse
// ---------------------------------------------------------------------------

const ProtocolMetricsData = Type.Object({
  protocol_id: Type.String(),
  agents: Type.Object({
    total: Type.Integer(),
    by_link_type: Type.Record(Type.String(), Type.Integer()),
  }),
  wallets: Type.Object({
    total: Type.Integer(),
    by_chain: Type.Record(Type.String(), Type.Integer()),
  }),
  evidence: Type.Object({
    total: Type.Integer(),
    by_type: Type.Record(Type.String(), Type.Integer()),
  }),
  recent_registrations_7d: Type.Integer(),
  active_conflicts: Type.Integer(),
})

export const ProtocolMetricsResponse = DataEnvelope(
  ProtocolMetricsData,
  'ProtocolMetricsResponse',
)

export type ProtocolMetricsResponse = Static<typeof ProtocolMetricsResponse>
