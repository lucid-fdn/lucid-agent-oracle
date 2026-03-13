import { describe, it, expect } from 'vitest'
import { formatChallengeMessage, formatAuthMessage } from '../identity/challenge.js'

describe('formatChallengeMessage', () => {
  it('formats a new-entity challenge message', () => {
    const msg = formatChallengeMessage({
      agentEntity: 'new',
      address: '0xABC123',
      chain: 'base',
      environment: 'production',
      nonce: 'test-nonce-uuid',
      issuedAt: '2026-03-12T10:00:00Z',
      expiresAt: '2026-03-12T10:05:00Z',
    })

    expect(msg).toContain('Lucid Agent Oracle — Wallet Verification')
    expect(msg).toContain('Agent: new')
    expect(msg).toContain('Wallet: 0xABC123')
    expect(msg).toContain('Chain: base')
    expect(msg).toContain('Environment: production')
    expect(msg).toContain('Domain: oracle.lucid.foundation')
    expect(msg).toContain('Nonce: test-nonce-uuid')
  })

  it('formats an existing-entity challenge message', () => {
    const msg = formatChallengeMessage({
      agentEntity: 'ae_existing123',
      address: '0xDEF456',
      chain: 'ethereum',
      environment: 'staging',
      nonce: 'uuid-2',
      issuedAt: '2026-03-12T10:00:00Z',
      expiresAt: '2026-03-12T10:05:00Z',
    })
    expect(msg).toContain('Agent: ae_existing123')
  })
})

describe('formatAuthMessage', () => {
  it('formats an entity authorization message', () => {
    const msg = formatAuthMessage({
      targetEntity: 'ae_target',
      newAddress: '0xNEW',
      newChain: 'base',
      authAddress: '0xAUTH',
      authChain: 'ethereum',
      environment: 'production',
      timestamp: '2026-03-12T10:00:00Z',
    })

    expect(msg).toContain('Lucid Agent Oracle — Entity Authorization')
    expect(msg).toContain('Entity: ae_target')
    expect(msg).toContain('New Wallet: 0xNEW')
    expect(msg).toContain('Auth Wallet: 0xAUTH')
  })
})
