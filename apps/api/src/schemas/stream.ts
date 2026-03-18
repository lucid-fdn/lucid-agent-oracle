import { Type, type Static } from '@sinclair/typebox'

export const StreamTokenResponse = Type.Object({
  token: Type.String(),
  expiresIn: Type.Integer({ description: 'Token TTL in seconds' }),
}, { $id: 'StreamTokenResponse' })

export type StreamTokenResponse = Static<typeof StreamTokenResponse>

export const StreamQuery = Type.Object({
  token: Type.Optional(Type.String({ description: 'Short-lived JWT from POST /stream/token' })),
  channels: Type.String({ description: 'Comma-separated channel names: feeds,agent_events,reports' }),
  filter: Type.Optional(Type.String({ description: 'JSON filter: {"feeds":["aegdp"]}' })),
}, { $id: 'StreamQuery' })

export type StreamQuery = Static<typeof StreamQuery>
