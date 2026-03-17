import type { Channel, OracleEvent } from '@lucid/oracle-core'
import { publishEvent, enqueueWebhook, nextEventId, getRedis } from './redis.js'

export interface EmitOptions {
  channel: Channel
  payload: Record<string, unknown>
  sse: boolean
  webhook: boolean
}

const BUFFER_MAX = 100

export class EventBus {
  private buffer: Array<{ channel: Channel; event: OracleEvent }> = []

  get healthy(): boolean {
    return getRedis() !== null
  }

  async emit(opts: EmitOptions): Promise<void> {
    const { channel, payload, sse, webhook } = opts
    if (!sse && !webhook) return

    const id = await nextEventId()
    const event: OracleEvent = {
      id,
      channel,
      ts: new Date().toISOString(),
      payload,
    }

    if (sse) {
      await publishEvent(channel, event).catch(() => {
        // SSE is ephemeral — drop on failure
      })
    }

    if (webhook) {
      try {
        await enqueueWebhook(channel, event)
        // Flush any buffered events
        await this.flushBuffer()
      } catch {
        // Buffer for retry when Redis recovers
        this.buffer.push({ channel, event })
        if (this.buffer.length > BUFFER_MAX) {
          const dropped = this.buffer.shift()!
          console.warn(`[event-bus] Buffer overflow — dropped event ${dropped.event.id} on ${dropped.channel}`)
        }
      }
    }
  }

  private async flushBuffer(): Promise<void> {
    while (this.buffer.length > 0) {
      const item = this.buffer[0]
      try {
        await enqueueWebhook(item.channel, item.event)
        this.buffer.shift()
      } catch {
        break // Redis still down
      }
    }
  }
}
