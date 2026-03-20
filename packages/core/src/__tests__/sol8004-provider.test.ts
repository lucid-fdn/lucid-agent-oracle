import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { Sol8004Provider } from '../adapters/solana-identity/sol8004-provider.js'
import type { HeliusTransaction } from '../adapters/helius.js'

/** Compute Anchor event discriminator for test fixtures */
function anchorDisc(eventName: string): Buffer {
  return createHash('sha256').update(`event:${eventName}`).digest().subarray(0, 8)
}

/** Base58 alphabet */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Encode bytes to base58 */
function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0
  for (const b of bytes) {
    if (b !== 0) break
    zeros++
  }
  let num = BigInt(0)
  for (const b of bytes) {
    num = num * BigInt(256) + BigInt(b)
  }
  const chars: string[] = []
  while (num > BigInt(0)) {
    const rem = Number(num % BigInt(58))
    num = num / BigInt(58)
    chars.unshift(B58[rem])
  }
  for (let i = 0; i < zeros; i++) chars.unshift('1')
  return chars.join('') || '1'
}

/** Create a fake 32-byte pubkey with a recognizable pattern */
function fakePubkey(seed: number): Buffer {
  const buf = Buffer.alloc(32, 0)
  buf[0] = seed
  buf[31] = seed
  return buf
}

/** Encode a Borsh string (4-byte LE length + UTF-8) */
function borshString(s: string): Buffer {
  const strBuf = Buffer.from(s, 'utf8')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32LE(strBuf.length)
  return Buffer.concat([lenBuf, strBuf])
}

/** Encode a Borsh bool */
function borshBool(val: boolean): Buffer {
  return Buffer.from([val ? 1 : 0])
}

/** Encode a Borsh Vec<u8> (4-byte LE length + bytes) */
function borshVecU8(hex: string): Buffer {
  const data = Buffer.from(hex, 'hex')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32LE(data.length)
  return Buffer.concat([lenBuf, data])
}

/** Encode a Borsh u64 (8 bytes LE) */
function borshU64(val: bigint): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(val)
  return buf
}

/** Encode a Borsh i128 (16 bytes LE) */
function borshI128(val: bigint): Buffer {
  const buf = Buffer.alloc(16)
  buf.writeBigUInt64LE(val & BigInt('0xFFFFFFFFFFFFFFFF'))
  buf.writeBigInt64LE(val >> BigInt(64), 8)
  return buf
}

/** Encode an Option<Pubkey> — None */
function optionNone(): Buffer {
  return Buffer.from([0])
}

/** Encode an Option<Pubkey> — Some(pubkey) */
function optionSomePubkey(pubkey: Buffer): Buffer {
  return Buffer.concat([Buffer.from([1]), pubkey])
}

/** Encode an Option<u8> — Some(val) */
function optionSomeU8(val: number): Buffer {
  return Buffer.concat([Buffer.from([1]), Buffer.from([val])])
}

/** Encode an Option<u8> — None */
function optionNoneU8(): Buffer {
  return Buffer.from([0])
}

/** Build a mock Helius transaction with log messages */
function mockTx(
  logMessages: string[],
  overrides?: Partial<HeliusTransaction>,
): HeliusTransaction & { logMessages: string[] } {
  return {
    signature: 'testSig123abc',
    type: 'UNKNOWN',
    timestamp: 1700000000,
    slot: 250000000,
    nativeTransfers: [],
    tokenTransfers: [],
    accountData: [],
    description: '',
    logMessages,
    ...overrides,
  } as any
}

/** Wrap event data in program log messages format */
function wrapInLogs(programId: string, eventData: Buffer): string[] {
  const b64 = eventData.toString('base64')
  return [
    `Program ${programId} invoke [1]`,
    `Program data: ${b64}`,
    `Program ${programId} success`,
  ]
}

describe('Sol8004Provider', () => {
  const provider = new Sol8004Provider()
  const PROGRAM = '8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ'

  it('has correct provider metadata', () => {
    expect(provider.id).toBe('sol8004')
    expect(provider.name).toContain('8004-solana')
    expect(provider.programIds).toContain(PROGRAM)
    expect(provider.programIds).toContain('AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb')
  })

  it('returns empty array for transactions without log messages', () => {
    const tx = mockTx([])
    expect(provider.parseTransaction(tx)).toEqual([])
  })

  it('returns empty array for transactions from unrelated programs', () => {
    const tx = mockTx([
      'Program 11111111111111111111111111111111 invoke [1]',
      'Program data: AAAA',
      'Program 11111111111111111111111111111111 success',
    ])
    expect(provider.parseTransaction(tx)).toEqual([])
  })

  describe('AgentRegistered', () => {
    it('parses AgentRegistered event correctly', () => {
      const asset = fakePubkey(1)
      const collection = fakePubkey(2)
      const owner = fakePubkey(3)

      const data = Buffer.concat([
        anchorDisc('AgentRegistered'),
        asset,
        collection,
        owner,
        borshBool(true),
        borshString('https://example.com/agent.json'),
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].source).toBe('sol8004')
      expect(events[0].chain).toBe('solana')
      expect(events[0].event_type).toBe('agent_registered')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.owner_address).toBe(encodeBase58(owner))
      expect(events[0].payload.agent_uri).toBe('https://example.com/agent.json')
      expect(events[0].payload.collection).toBe(encodeBase58(collection))
      expect(events[0].payload.atom_enabled).toBe(true)
      expect(events[0].tx_hash).toBe('testSig123abc')
      expect(events[0].block_number).toBe(250000000)
    })
  })

  describe('UriUpdated', () => {
    it('parses UriUpdated event correctly', () => {
      const asset = fakePubkey(10)
      const updatedBy = fakePubkey(11)

      const data = Buffer.concat([
        anchorDisc('UriUpdated'),
        asset,
        updatedBy,
        borshString('https://new.example.com/agent.json'),
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('uri_updated')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.agent_uri).toBe('https://new.example.com/agent.json')
      expect(events[0].payload.updated_by).toBe(encodeBase58(updatedBy))
    })
  })

  describe('MetadataSet', () => {
    it('parses MetadataSet event correctly', () => {
      const asset = fakePubkey(20)

      const data = Buffer.concat([
        anchorDisc('MetadataSet'),
        asset,
        borshBool(false),
        borshString('ecosystem'),
        borshVecU8('4f6c6173'), // "Olas" in hex
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('metadata_set')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.key).toBe('ecosystem')
      expect(events[0].payload.value).toBe('4f6c6173')
      expect(events[0].payload.immutable).toBe(false)
    })
  })

  describe('WalletUpdated', () => {
    it('parses WalletUpdated event (maps to metadata_set with agentWallet)', () => {
      const asset = fakePubkey(30)
      const newWallet = fakePubkey(31)
      const updatedBy = fakePubkey(32)

      const data = Buffer.concat([
        anchorDisc('WalletUpdated'),
        asset,
        optionNone(), // old_wallet = None
        newWallet,
        updatedBy,
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('metadata_set')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.value).toBe('agentWallet')
      expect(events[0].payload.data).toBe(encodeBase58(newWallet))
      expect(events[0].payload.old_wallet).toBeNull()
    })

    it('parses WalletUpdated with old_wallet present', () => {
      const asset = fakePubkey(30)
      const oldWallet = fakePubkey(33)
      const newWallet = fakePubkey(31)
      const updatedBy = fakePubkey(32)

      const data = Buffer.concat([
        anchorDisc('WalletUpdated'),
        asset,
        optionSomePubkey(oldWallet),
        newWallet,
        updatedBy,
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].payload.old_wallet).toBe(encodeBase58(oldWallet))
    })
  })

  describe('AgentOwnerSynced', () => {
    it('parses AgentOwnerSynced as ownership_transferred', () => {
      const asset = fakePubkey(40)
      const oldOwner = fakePubkey(41)
      const newOwner = fakePubkey(42)

      const data = Buffer.concat([
        anchorDisc('AgentOwnerSynced'),
        asset,
        oldOwner,
        newOwner,
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('ownership_transferred')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.previous_owner).toBe(encodeBase58(oldOwner))
      expect(events[0].payload.new_owner).toBe(encodeBase58(newOwner))
    })
  })

  describe('NewFeedback', () => {
    it('parses NewFeedback event correctly', () => {
      const asset = fakePubkey(50)
      const client = fakePubkey(51)

      const data = Buffer.concat([
        anchorDisc('NewFeedback'),
        asset,
        client,
        borshU64(BigInt(1)),           // feedback_index
        borshI128(BigInt(950)),         // value
        Buffer.from([2]),              // value_decimals
        optionSomeU8(85),              // score
        borshString('quality'),        // tag1
        borshString('speed'),          // tag2
        borshString('/api/chat'),      // endpoint
        borshString('https://feedback.example.com/1'), // feedback_uri
        Buffer.alloc(32, 0xab),        // seal_hash
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('new_feedback')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.client_address).toBe(encodeBase58(client))
      expect(events[0].payload.feedback_index).toBe('1')
      expect(events[0].payload.value).toBe('950')
      expect(events[0].payload.value_decimals).toBe(2)
      expect(events[0].payload.score).toBe(85)
      expect(events[0].payload.tag1).toBe('quality')
      expect(events[0].payload.tag2).toBe('speed')
      expect(events[0].payload.endpoint).toBe('/api/chat')
      expect(events[0].payload.feedback_uri).toBe('https://feedback.example.com/1')
      expect(events[0].payload.seal_hash).toBe('ab'.repeat(32))
    })
  })

  describe('FeedbackRevoked', () => {
    it('parses FeedbackRevoked event correctly', () => {
      const asset = fakePubkey(60)
      const client = fakePubkey(61)

      const data = Buffer.concat([
        anchorDisc('FeedbackRevoked'),
        asset,
        client,
        borshU64(BigInt(3)),           // feedback_index
        Buffer.alloc(32, 0xcd),        // seal_hash
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('feedback_revoked')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.client_address).toBe(encodeBase58(client))
      expect(events[0].payload.feedback_index).toBe('3')
      expect(events[0].payload.seal_hash).toBe('cd'.repeat(32))
    })
  })

  describe('MetadataDeleted', () => {
    it('parses MetadataDeleted event correctly', () => {
      const asset = fakePubkey(70)

      const data = Buffer.concat([
        anchorDisc('MetadataDeleted'),
        asset,
        borshString('ecosystem'),
      ])

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      expect(events).toHaveLength(1)
      expect(events[0].event_type).toBe('metadata_deleted')
      expect(events[0].agent_id).toBe(encodeBase58(asset))
      expect(events[0].payload.key).toBe('ecosystem')
    })
  })

  describe('multiple events in single transaction', () => {
    it('parses multiple events from one transaction', () => {
      const asset = fakePubkey(80)
      const collection = fakePubkey(81)
      const owner = fakePubkey(82)

      const registerData = Buffer.concat([
        anchorDisc('AgentRegistered'),
        asset,
        collection,
        owner,
        borshBool(false),
        borshString('https://example.com/agent.json'),
      ])

      const metaData = Buffer.concat([
        anchorDisc('MetadataSet'),
        asset,
        borshBool(true),
        borshString('ecosystem'),
        borshVecU8('4f6c6173'),
      ])

      const b64Register = registerData.toString('base64')
      const b64Meta = metaData.toString('base64')

      const tx = mockTx([
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${b64Register}`,
        `Program data: ${b64Meta}`,
        `Program ${PROGRAM} success`,
      ])

      const events = provider.parseTransaction(tx)
      expect(events).toHaveLength(2)
      expect(events[0].event_type).toBe('agent_registered')
      expect(events[1].event_type).toBe('metadata_set')
    })
  })

  describe('malformed data handling', () => {
    it('skips events with truncated data', () => {
      // Just the discriminator for AgentRegistered, no actual data
      const data = anchorDisc('AgentRegistered')

      const tx = mockTx(wrapInLogs(PROGRAM, data))
      const events = provider.parseTransaction(tx)

      // Should gracefully return empty (parser returns null for truncated data)
      expect(events).toHaveLength(0)
    })

    it('skips events with unknown discriminators', () => {
      const unknownData = Buffer.alloc(40, 0xff)
      const tx = mockTx(wrapInLogs(PROGRAM, unknownData))
      const events = provider.parseTransaction(tx)
      expect(events).toHaveLength(0)
    })
  })
})
