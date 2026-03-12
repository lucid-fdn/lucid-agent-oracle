import { computeEventId } from '../types/events.js'
import type { ERC8004Event } from '../types/identity.js'

interface BaseLogFields {
  block_number: number
  tx_hash: string
  log_index: number
  timestamp: Date
}

export function normalizeAgentRegistered(input: BaseLogFields & {
  agent_id: string
  owner_address: string
  tba_address: string | null
  raw_data: string
}): ERC8004Event {
  return {
    event_id: computeEventId('erc8004', 'base', input.tx_hash, input.log_index),
    event_type: 'agent_registered',
    source: 'erc8004',
    chain: 'base',
    block_number: input.block_number,
    tx_hash: input.tx_hash,
    log_index: input.log_index,
    timestamp: input.timestamp,
    agent_id: input.agent_id,
    owner_address: input.owner_address,
    tba_address: input.tba_address,
    reputation_score: null,
    validator_address: null,
    evidence_hash: null,
    raw_data: input.raw_data,
  }
}

export function normalizeAgentUpdated(input: BaseLogFields & {
  agent_id: string
  owner_address: string
  raw_data: string
}): ERC8004Event {
  return {
    event_id: computeEventId('erc8004', 'base', input.tx_hash, input.log_index),
    event_type: 'agent_updated',
    source: 'erc8004',
    chain: 'base',
    block_number: input.block_number,
    tx_hash: input.tx_hash,
    log_index: input.log_index,
    timestamp: input.timestamp,
    agent_id: input.agent_id,
    owner_address: input.owner_address,
    tba_address: null,
    reputation_score: null,
    validator_address: null,
    evidence_hash: null,
    raw_data: input.raw_data,
  }
}

export function normalizeOwnershipTransferred(input: BaseLogFields & {
  agent_id: string
  old_owner: string
  new_owner: string
  raw_data: string
}): ERC8004Event {
  return {
    event_id: computeEventId('erc8004', 'base', input.tx_hash, input.log_index),
    event_type: 'ownership_transferred',
    source: 'erc8004',
    chain: 'base',
    block_number: input.block_number,
    tx_hash: input.tx_hash,
    log_index: input.log_index,
    timestamp: input.timestamp,
    agent_id: input.agent_id,
    owner_address: input.new_owner,
    tba_address: null,
    reputation_score: null,
    validator_address: null,
    evidence_hash: null,
    raw_data: input.raw_data,
  }
}

export function normalizeReputationUpdated(input: BaseLogFields & {
  agent_id: string
  owner_address: string
  reputation_score: number
  validator_address: string
  evidence_hash: string
  raw_data: string
}): ERC8004Event {
  return {
    event_id: computeEventId('erc8004', 'base', input.tx_hash, input.log_index),
    event_type: 'reputation_updated',
    source: 'erc8004',
    chain: 'base',
    block_number: input.block_number,
    tx_hash: input.tx_hash,
    log_index: input.log_index,
    timestamp: input.timestamp,
    agent_id: input.agent_id,
    owner_address: input.owner_address,
    tba_address: null,
    reputation_score: input.reputation_score,
    validator_address: input.validator_address,
    evidence_hash: input.evidence_hash,
    raw_data: input.raw_data,
  }
}
