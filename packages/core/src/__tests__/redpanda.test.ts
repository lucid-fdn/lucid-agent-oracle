import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RedpandaProducer, RedpandaConsumer, TOPICS } from '../clients/redpanda.js'

const mockSend = vi.fn().mockResolvedValue(undefined)
const mockConnect = vi.fn().mockResolvedValue(undefined)
const mockDisconnect = vi.fn().mockResolvedValue(undefined)
const mockSubscribe = vi.fn().mockResolvedValue(undefined)
const mockRun = vi.fn().mockResolvedValue(undefined)

vi.mock('kafkajs', () => ({
  Kafka: vi.fn(() => ({
    producer: vi.fn(() => ({
      connect: mockConnect,
      send: mockSend,
      disconnect: mockDisconnect,
    })),
    consumer: vi.fn(() => ({
      connect: mockConnect,
      subscribe: mockSubscribe,
      run: mockRun,
      disconnect: mockDisconnect,
    })),
  })),
}))

describe('RedpandaProducer', () => {
  let producer: RedpandaProducer

  beforeEach(() => {
    vi.clearAllMocks()
    producer = new RedpandaProducer({ brokers: ['localhost:9092'] })
  })

  it('throws when publishing before connect', async () => {
    await expect(producer.publishEvents(TOPICS.RAW_GATEWAY, []))
      .rejects.toThrow('Producer not connected')
  })

  it('sends events with correct key and topic after connect', async () => {
    await producer.connect()
    const event = {
      event_id: 'test-1',
      source: 'lucid_gateway',
      chain: 'offchain',
      event_timestamp: new Date('2026-03-12T00:00:00Z'),
    } as any

    await producer.publishEvents(TOPICS.RAW_GATEWAY, [event])
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: TOPICS.RAW_GATEWAY,
        messages: [expect.objectContaining({ key: 'lucid_gateway:offchain' })],
      })
    )
  })

  it('skips send for empty events array', async () => {
    await producer.connect()
    await producer.publishEvents(TOPICS.RAW_GATEWAY, [])
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('RedpandaConsumer', () => {
  it('subscribes to topics and calls connect', async () => {
    const consumer = new RedpandaConsumer({
      brokers: ['localhost:9092'],
      groupId: 'test-group',
    })
    await consumer.subscribe([TOPICS.RAW_GATEWAY])
    expect(mockConnect).toHaveBeenCalled()
    expect(mockSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ topic: TOPICS.RAW_GATEWAY })
    )
  })
})

describe('TOPICS', () => {
  it('defines all expected topics', () => {
    expect(TOPICS.RAW_GATEWAY).toBe('raw.lucid_gateway.events')
    expect(TOPICS.NORMALIZED).toBe('normalized.economic')
    expect(TOPICS.INDEX_UPDATES).toBe('index.updates')
    expect(TOPICS.PUBLICATION).toBe('publication.requests')
  })
})
