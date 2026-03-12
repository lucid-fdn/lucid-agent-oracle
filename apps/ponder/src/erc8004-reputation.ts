import { ponder } from '@/generated'
import { publishToERC8004 } from './redpanda-sink.js'
import { computeEventId } from '../../../packages/core/src/types/events.js'

ponder.on('ReputationRegistry:ReputationUpdated', async ({ event }) => {
  const erc8004Event = {
    event_id: computeEventId('erc8004', 'base', event.transaction.hash, Number(event.log.logIndex)),
    event_type: 'reputation_updated',
    source: 'erc8004',
    chain: 'base',
    block_number: Number(event.block.number),
    tx_hash: event.transaction.hash,
    log_index: Number(event.log.logIndex),
    timestamp: new Date(Number(event.block.timestamp) * 1000).toISOString(),
    agent_id: event.args.agentId,
    owner_address: '',
    tba_address: null,
    reputation_score: Number(event.args.score),
    validator_address: event.args.validator,
    evidence_hash: event.args.evidenceHash,
    raw_data: JSON.stringify(event.args),
  }
  await publishToERC8004(`erc8004:${event.args.agentId}`, erc8004Event)
})
