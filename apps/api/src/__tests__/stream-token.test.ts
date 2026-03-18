import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStreamToken, verifyStreamToken } from '../routes/stream.js'

describe('Stream token', () => {
  const secret = 'test-stream-token-secret-at-least-32-chars!!'

  beforeEach(() => {
    vi.stubEnv('STREAM_TOKEN_SECRET', secret)
  })

  it('creates a valid JWT with tenantId and plan', async () => {
    const token = await createStreamToken('tenant_123', 'pro')
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT has 3 parts
  })

  it('verifies a valid token and returns claims', async () => {
    const token = await createStreamToken('tenant_123', 'pro')
    const claims = await verifyStreamToken(token)
    expect(claims).toMatchObject({ tenantId: 'tenant_123', plan: 'pro' })
  })

  it('rejects an expired token', async () => {
    // Create token with -1s expiry (already expired)
    const token = await createStreamToken('tenant_123', 'pro', -1)
    await expect(verifyStreamToken(token)).rejects.toThrow()
  })

  it('rejects a tampered token', async () => {
    const token = await createStreamToken('tenant_123', 'pro')
    const tampered = token.slice(0, -5) + 'XXXXX'
    await expect(verifyStreamToken(tampered)).rejects.toThrow()
  })
})
