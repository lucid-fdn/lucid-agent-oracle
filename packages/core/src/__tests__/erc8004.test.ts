import { describe, it, expect } from 'vitest'
import {
  normalizeAgentRegistered,
  normalizeAgentUpdated,
  normalizeOwnershipTransferred,
  normalizeReputationUpdated,
} from '../adapters/erc8004.js'

const BASE_LOG = {
  block_number: 12345678,
  tx_hash: '0xabc123def456',
  log_index: 0,
  timestamp: new Date('2026-03-12T00:00:00Z'),
}

describe('ERC-8004 adapter', () => {
  it('normalizes AgentRegistered event', () => {
    const event = normalizeAgentRegistered({
      ...BASE_LOG,
      agent_id: '0x0001',
      owner_address: '0xOwner123',
      tba_address: '0xTBA456',
      raw_data: '{}',
    })
    expect(event.event_type).toBe('agent_registered')
    expect(event.source).toBe('erc8004')
    expect(event.chain).toBe('base')
    expect(event.agent_id).toBe('0x0001')
    expect(event.owner_address).toBe('0xOwner123')
    expect(event.tba_address).toBe('0xTBA456')
    expect(event.event_id).toMatch(/^[0-9a-f]{8}-/)
  })

  it('normalizes AgentRegistered with null TBA', () => {
    const event = normalizeAgentRegistered({
      ...BASE_LOG,
      agent_id: '0x0002',
      owner_address: '0xOwner789',
      tba_address: null,
      raw_data: '{}',
    })
    expect(event.tba_address).toBeNull()
  })

  it('normalizes AgentUpdated event', () => {
    const event = normalizeAgentUpdated({
      ...BASE_LOG,
      agent_id: '0x0001',
      owner_address: '0xOwner123',
      raw_data: '{"name":"Agent Alpha"}',
    })
    expect(event.event_type).toBe('agent_updated')
    expect(event.reputation_score).toBeNull()
  })

  it('normalizes OwnershipTransferred event', () => {
    const event = normalizeOwnershipTransferred({
      ...BASE_LOG,
      agent_id: '0x0001',
      old_owner: '0xOldOwner',
      new_owner: '0xNewOwner',
      raw_data: '{}',
    })
    expect(event.event_type).toBe('ownership_transferred')
    expect(event.owner_address).toBe('0xNewOwner')
  })

  it('normalizes ReputationUpdated event', () => {
    const event = normalizeReputationUpdated({
      ...BASE_LOG,
      agent_id: '0x0001',
      owner_address: '0xOwner123',
      reputation_score: 8500,
      validator_address: '0xValidator',
      evidence_hash: '0xEvidence',
      raw_data: '{}',
    })
    expect(event.event_type).toBe('reputation_updated')
    expect(event.reputation_score).toBe(8500)
    expect(event.validator_address).toBe('0xValidator')
  })

  it('produces deterministic event_ids', () => {
    const a = normalizeAgentRegistered({ ...BASE_LOG, agent_id: '0x01', owner_address: '0xA', tba_address: null, raw_data: '{}' })
    const b = normalizeAgentRegistered({ ...BASE_LOG, agent_id: '0x01', owner_address: '0xA', tba_address: null, raw_data: '{}' })
    expect(a.event_id).toBe(b.event_id)
  })
})
