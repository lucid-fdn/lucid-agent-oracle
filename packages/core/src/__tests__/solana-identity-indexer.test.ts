import { describe, it, expect, vi } from 'vitest'
import type { SolanaIdentityProvider, StagingEvent } from '../adapters/solana-identity/types.js'
import type { HeliusTransaction } from '../adapters/helius.js'

describe('SolanaIdentityProvider interface', () => {
  it('allows creating a custom provider', () => {
    const mockProvider: SolanaIdentityProvider = {
      id: 'test-provider',
      name: 'Test Provider',
      programIds: ['11111111111111111111111111111111'],
      parseTransaction(tx: HeliusTransaction): StagingEvent[] {
        return [{
          source: 'test-provider',
          chain: 'solana',
          event_type: 'agent_registered',
          agent_id: 'TestAgent1111111111111111111111111111111111',
          payload: { owner_address: 'TestOwner1111111111111111111111111111111111' },
          tx_hash: tx.signature,
          block_number: tx.slot,
        }]
      },
    }

    expect(mockProvider.id).toBe('test-provider')
    expect(mockProvider.programIds).toHaveLength(1)

    const events = mockProvider.parseTransaction({
      signature: 'sig123',
      type: 'UNKNOWN',
      timestamp: 1700000000,
      slot: 250000000,
      nativeTransfers: [],
      tokenTransfers: [],
      accountData: [],
      description: '',
    })

    expect(events).toHaveLength(1)
    expect(events[0].source).toBe('test-provider')
    expect(events[0].chain).toBe('solana')
    expect(events[0].event_type).toBe('agent_registered')
  })
})

describe('SolanaIdentityIndexerConfig', () => {
  it('accepts partial config with required fields', () => {
    // Type check — this is a compile-time test
    const config = {
      heliusApiKey: 'test-key',
      providers: [] as SolanaIdentityProvider[],
      pollIntervalMs: 30_000,
      batchSize: 50,
    }

    expect(config.heliusApiKey).toBe('test-key')
    expect(config.pollIntervalMs).toBe(30_000)
    expect(config.batchSize).toBe(50)
    expect(config.providers).toHaveLength(0)
  })
})

describe('StagingEvent format', () => {
  it('has the correct shape for Solana events', () => {
    const event: StagingEvent = {
      source: 'sol8004',
      chain: 'solana',
      event_type: 'agent_registered',
      agent_id: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      payload: {
        owner_address: '7v91N7iZ9mNicL8WfG6cgSCKyRXydQjLh6UYBWwm6y1Q',
        agent_uri: 'https://arweave.net/agent.json',
        collection: 'Collection1111111111111111111111111111111111',
      },
      tx_hash: '3FNGPVz9Hna4n6JvVTYvpcWFzNuGF91oVLXYc9qJF7nT',
      block_number: 250000000,
    }

    expect(event.chain).toBe('solana')
    expect(event.source).toBe('sol8004')
    expect(typeof event.agent_id).toBe('string')
    expect(typeof event.block_number).toBe('number')
    expect(typeof event.tx_hash).toBe('string')
  })
})
