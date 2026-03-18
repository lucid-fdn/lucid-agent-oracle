import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processMessage } from '../process-message.js'

// Mock DB
const mockDb = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
}

// Mock Redis
const mockRedis = {
  xAck: vi.fn(),
  zAdd: vi.fn(),
}

describe('processMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WEBHOOK_SECRET_KEY', 'a]32-byte-key-for-aes-256-gcm!!')
  })

  it('ACKs message when no matching subscriptions', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] }) // no subs

    await processMessage(
      mockRedis as any,
      mockDb as any,
      'msg-1',
      { channel: 'feeds', payload: '{"feedId":"aegdp","value":142}' },
      new Map(),
    )

    expect(mockRedis.xAck).toHaveBeenCalled()
  })
})
