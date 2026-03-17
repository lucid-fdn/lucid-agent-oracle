import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/redis.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  enqueueWebhook: vi.fn().mockResolvedValue('stream-id'),
  nextEventId: vi.fn().mockResolvedValue('1710547200000-1'),
  getRedis: vi.fn(() => ({})),
}))

import { publishEvent, enqueueWebhook, nextEventId } from '../services/redis.js'
import { EventBus } from '../services/event-bus.js'

const mockPublishEvent = vi.mocked(publishEvent)
const mockEnqueueWebhook = vi.mocked(enqueueWebhook)
const mockNextEventId = vi.mocked(nextEventId)

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublishEvent.mockResolvedValue(undefined)
    mockEnqueueWebhook.mockResolvedValue('stream-id')
    mockNextEventId.mockResolvedValue('1710547200000-1')
    bus = new EventBus()
  })

  it('emits to both Pub/Sub and Stream when sse + webhook are true', async () => {
    await bus.emit({
      channel: 'feeds',
      payload: { feedId: 'aegdp', value: 142.7 },
      sse: true,
      webhook: true,
    })

    expect(mockPublishEvent).toHaveBeenCalledWith('feeds', expect.objectContaining({
      id: '1710547200000-1',
      channel: 'feeds',
      payload: { feedId: 'aegdp', value: 142.7 },
    }))
    expect(mockEnqueueWebhook).toHaveBeenCalledWith('feeds', expect.objectContaining({
      id: '1710547200000-1',
      channel: 'feeds',
    }))
  })

  it('emits to Pub/Sub only when webhook is false', async () => {
    await bus.emit({
      channel: 'feeds',
      payload: { feedId: 'aegdp', value: 100 },
      sse: true,
      webhook: false,
    })

    expect(mockPublishEvent).toHaveBeenCalled()
    expect(mockEnqueueWebhook).not.toHaveBeenCalled()
  })

  it('emits to Stream only when sse is false', async () => {
    await bus.emit({
      channel: 'feeds',
      payload: { feedId: 'aegdp', value: 100 },
      sse: false,
      webhook: true,
    })

    expect(mockPublishEvent).not.toHaveBeenCalled()
    expect(mockEnqueueWebhook).toHaveBeenCalled()
  })

  it('does nothing when both flags are false', async () => {
    await bus.emit({
      channel: 'feeds',
      payload: { feedId: 'aegdp', value: 100 },
      sse: false,
      webhook: false,
    })

    expect(mockPublishEvent).not.toHaveBeenCalled()
    expect(mockEnqueueWebhook).not.toHaveBeenCalled()
  })

  it('attaches monotonic id and timestamp to event', async () => {
    await bus.emit({
      channel: 'agent_events',
      payload: { agentId: 'a1', eventType: 'score_change' },
      sse: true,
      webhook: false,
    })

    const publishedEvent = mockPublishEvent.mock.calls[0][1]
    expect(publishedEvent.id).toBe('1710547200000-1')
    expect(publishedEvent.ts).toBeDefined()
    expect(publishedEvent.channel).toBe('agent_events')
  })

  it('reports healthy when Redis is available', () => {
    expect(bus.healthy).toBe(true)
  })
})
