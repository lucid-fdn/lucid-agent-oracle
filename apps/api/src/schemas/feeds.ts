import { Type, type Static } from '@sinclair/typebox'
import { DataEnvelope } from './common.js'

// ---------------------------------------------------------------------------
// Feed ID params (shared with v1.ts feed routes)
// ---------------------------------------------------------------------------

export const FeedIdParams = Type.Object(
  {
    id: Type.String({ description: 'Feed identifier (aegdp, aai, apri)' }),
  },
  { $id: 'FeedIdParams' },
)

export type FeedIdParams = Static<typeof FeedIdParams>

// ---------------------------------------------------------------------------
// Feed History
// ---------------------------------------------------------------------------

export const FeedHistoryQuery = Type.Object(
  {
    period: Type.Optional(
      Type.Union([
        Type.Literal('1d'),
        Type.Literal('7d'),
        Type.Literal('30d'),
        Type.Literal('90d'),
      ], { default: '7d' }),
    ),
    interval: Type.Optional(
      Type.Union([
        Type.Literal('1m'),
        Type.Literal('1h'),
        Type.Literal('1d'),
      ], { default: '1h' }),
    ),
  },
  { $id: 'FeedHistoryQuery' },
)

export type FeedHistoryQuery = Static<typeof FeedHistoryQuery>

export const FeedHistoryPoint = Type.Object({
  timestamp: Type.String(),
  value: Type.String(),
  confidence: Type.Number(),
})

export type FeedHistoryPoint = Static<typeof FeedHistoryPoint>

const FeedHistoryData = Type.Object({
  feed_id: Type.String(),
  period: Type.String(),
  interval: Type.String(),
  has_data: Type.Boolean(),
  points: Type.Array(FeedHistoryPoint),
})

export const FeedHistoryResponse = DataEnvelope(FeedHistoryData, 'FeedHistoryResponse')

export type FeedHistoryResponse = Static<typeof FeedHistoryResponse>
