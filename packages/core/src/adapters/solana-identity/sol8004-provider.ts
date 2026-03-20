/**
 * Sol8004 Provider — QuantuLabs 8004-solana Agent Registry.
 *
 * Parses Anchor events from Helius enhanced transactions for the
 * Agent Registry program (8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ).
 *
 * Anchor events are emitted via `emit!()` in Solana programs and appear as
 * base64-encoded data in transaction log messages prefixed with "Program data:".
 * The first 8 bytes are a discriminator (sha256 of "event:<EventName>" truncated).
 *
 * For v1, we parse from `logMessages` in the Helius transaction response.
 */
import { createHash } from 'node:crypto'
import type { HeliusTransaction } from '../helius.js'
import type { SolanaIdentityProvider, StagingEvent } from './types.js'

/** Agent Registry program on Solana mainnet */
const AGENT_REGISTRY_PROGRAM = '8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ'

/** ATOM Engine program on Solana mainnet */
const ATOM_ENGINE_PROGRAM = 'AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb'

/**
 * Compute Anchor event discriminator (first 8 bytes of sha256("event:<name>")).
 */
function anchorEventDiscriminator(eventName: string): Buffer {
  const hash = createHash('sha256').update(`event:${eventName}`).digest()
  return hash.subarray(0, 8)
}

/** Pre-computed discriminators for all 8004-solana events */
const DISCRIMINATORS = {
  AgentRegistered: anchorEventDiscriminator('AgentRegistered'),
  UriUpdated: anchorEventDiscriminator('UriUpdated'),
  MetadataSet: anchorEventDiscriminator('MetadataSet'),
  WalletUpdated: anchorEventDiscriminator('WalletUpdated'),
  AgentOwnerSynced: anchorEventDiscriminator('AgentOwnerSynced'),
  MetadataDeleted: anchorEventDiscriminator('MetadataDeleted'),
  NewFeedback: anchorEventDiscriminator('NewFeedback'),
  FeedbackRevoked: anchorEventDiscriminator('FeedbackRevoked'),
  ResponseAppended: anchorEventDiscriminator('ResponseAppended'),
} as const

/** Solana pubkey is 32 bytes */
const PUBKEY_SIZE = 32

/**
 * Read a 32-byte Solana public key from a buffer at the given offset.
 * Returns the base58-encoded string.
 */
function readPubkey(buf: Buffer, offset: number): string {
  const bytes = buf.subarray(offset, offset + PUBKEY_SIZE)
  return encodeBase58(bytes)
}

/**
 * Read a Borsh-encoded string (4-byte LE length prefix + UTF-8 bytes).
 * Returns [value, bytesConsumed].
 */
function readBorshString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset)
  const str = buf.subarray(offset + 4, offset + 4 + len).toString('utf8')
  return [str, 4 + len]
}

/**
 * Read a Borsh bool (1 byte). Returns [value, 1].
 */
function readBool(buf: Buffer, offset: number): [boolean, number] {
  return [buf[offset] !== 0, 1]
}

/**
 * Read a Borsh Option<Pubkey> (1 byte tag + optional 32 bytes).
 * Returns [value | null, bytesConsumed].
 */
function readOptionPubkey(buf: Buffer, offset: number): [string | null, number] {
  const tag = buf[offset]
  if (tag === 0) return [null, 1]
  return [readPubkey(buf, offset + 1), 1 + PUBKEY_SIZE]
}

/**
 * Read a Borsh u64 (8 bytes LE). Returns as bigint string.
 */
function readU64(buf: Buffer, offset: number): [string, number] {
  const lo = buf.readUInt32LE(offset)
  const hi = buf.readUInt32LE(offset + 4)
  const val = BigInt(hi) * BigInt(0x100000000) + BigInt(lo)
  return [val.toString(), 8]
}

/**
 * Read a Borsh i128 (16 bytes LE, signed). Returns as string.
 */
function readI128(buf: Buffer, offset: number): [string, number] {
  // Read as two u64s (little-endian)
  const lo = buf.readBigUInt64LE(offset)
  const hi = buf.readBigInt64LE(offset + 8) // signed high part
  const val = hi * BigInt(2) ** BigInt(64) + lo
  return [val.toString(), 16]
}

/**
 * Read an Option<u8> (1 byte tag + optional 1 byte).
 */
function readOptionU8(buf: Buffer, offset: number): [number | null, number] {
  const tag = buf[offset]
  if (tag === 0) return [null, 1]
  return [buf[offset + 1], 2]
}

/**
 * Read a [u8; 32] fixed array.
 */
function readFixedBytes32(buf: Buffer, offset: number): [string, number] {
  const bytes = buf.subarray(offset, offset + 32)
  return [bytes.toString('hex'), 32]
}

/**
 * Read a Vec<u8> (4-byte LE length + bytes). Returns hex string.
 */
function readVecU8(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset)
  const bytes = buf.subarray(offset + 4, offset + 4 + len)
  return [bytes.toString('hex'), 4 + len]
}

// Base58 alphabet (Bitcoin)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Encode bytes to base58 (Solana standard encoding).
 */
function encodeBase58(bytes: Uint8Array): string {
  // Count leading zeros
  let zeros = 0
  for (const b of bytes) {
    if (b !== 0) break
    zeros++
  }

  // Convert to big integer
  let num = BigInt(0)
  for (const b of bytes) {
    num = num * BigInt(256) + BigInt(b)
  }

  // Convert to base58
  const chars: string[] = []
  while (num > BigInt(0)) {
    const rem = Number(num % BigInt(58))
    num = num / BigInt(58)
    chars.unshift(BASE58_ALPHABET[rem])
  }

  // Add leading '1's for zero bytes
  for (let i = 0; i < zeros; i++) {
    chars.unshift('1')
  }

  return chars.join('') || '1'
}

/**
 * Extract base64-encoded event data from transaction log messages.
 *
 * Anchor emits events as "Program data: <base64>" log entries following
 * the program invocation log. We look for these entries that follow logs
 * from our watched programs.
 */
function extractAnchorEventData(
  logMessages: string[] | undefined,
  programIds: string[],
): Buffer[] {
  if (!logMessages) return []

  const events: Buffer[] = []
  let inTargetProgram = false

  for (const msg of logMessages) {
    // Track when we enter/exit our target programs
    if (msg.startsWith('Program ') && msg.includes(' invoke [')) {
      const progId = msg.split(' ')[1]
      if (programIds.includes(progId)) {
        inTargetProgram = true
      }
    }
    if (msg.startsWith('Program ') && (msg.includes(' success') || msg.includes(' failed'))) {
      const progId = msg.split(' ')[1]
      if (programIds.includes(progId)) {
        inTargetProgram = false
      }
    }

    // Extract event data when inside our program
    if (inTargetProgram && msg.startsWith('Program data: ')) {
      const b64 = msg.slice('Program data: '.length).trim()
      try {
        const buf = Buffer.from(b64, 'base64')
        if (buf.length >= 8) {
          events.push(buf)
        }
      } catch {
        // Skip malformed base64
      }
    }
  }

  return events
}

/**
 * Match a buffer's first 8 bytes against known discriminators.
 * Returns the event name or null.
 */
function matchDiscriminator(buf: Buffer): string | null {
  const disc = buf.subarray(0, 8)
  for (const [name, expected] of Object.entries(DISCRIMINATORS)) {
    if (disc.equals(expected)) return name
  }
  return null
}

/**
 * Parse an AgentRegistered event from Borsh-encoded data.
 * Layout: asset(32) + collection(32) + owner(32) + atom_enabled(1) + agent_uri(4+len)
 */
function parseAgentRegistered(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const collection = readPubkey(data, offset); offset += PUBKEY_SIZE
    const owner = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [atomEnabled, boolLen] = readBool(data, offset); offset += boolLen
    const [agentUri] = readBorshString(data, offset)
    return { asset, collection, owner, atom_enabled: atomEnabled, agent_uri: agentUri }
  } catch { return null }
}

/**
 * Parse a UriUpdated event.
 * Layout: asset(32) + updated_by(32) + new_uri(4+len)
 */
function parseUriUpdated(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const updatedBy = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [newUri] = readBorshString(data, offset)
    return { asset, updated_by: updatedBy, new_uri: newUri }
  } catch { return null }
}

/**
 * Parse a MetadataSet event.
 * Layout: asset(32) + immutable(1) + key(4+len) + value(4+vecLen)
 */
function parseMetadataSet(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [immutable, boolLen] = readBool(data, offset); offset += boolLen
    const [key, keyLen] = readBorshString(data, offset); offset += keyLen
    const [value, valueLen] = readVecU8(data, offset)
    return { asset, immutable, key, value }
  } catch { return null }
}

/**
 * Parse a WalletUpdated event.
 * Layout: asset(32) + old_wallet(Option<Pubkey>) + new_wallet(32) + updated_by(32)
 */
function parseWalletUpdated(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [oldWallet, optLen] = readOptionPubkey(data, offset); offset += optLen
    const newWallet = readPubkey(data, offset); offset += PUBKEY_SIZE
    const updatedBy = readPubkey(data, offset)
    return { asset, old_wallet: oldWallet, new_wallet: newWallet, updated_by: updatedBy }
  } catch { return null }
}

/**
 * Parse an AgentOwnerSynced event.
 * Layout: asset(32) + old_owner(32) + new_owner(32)
 */
function parseAgentOwnerSynced(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const oldOwner = readPubkey(data, offset); offset += PUBKEY_SIZE
    const newOwner = readPubkey(data, offset)
    return { asset, old_owner: oldOwner, new_owner: newOwner }
  } catch { return null }
}

/**
 * Parse a MetadataDeleted event.
 * Layout: asset(32) + key(4+len)
 */
function parseMetadataDeleted(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [key] = readBorshString(data, offset)
    return { asset, key }
  } catch { return null }
}

/**
 * Parse a NewFeedback event.
 * Layout: asset(32) + client_address(32) + feedback_index(u64) + value(i128) +
 *         value_decimals(u8) + score(Option<u8>) + tag1(4+len) + tag2(4+len) +
 *         endpoint(4+len) + feedback_uri(4+len) + seal_hash([u8;32]) + ...ATOM fields
 */
function parseNewFeedback(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const clientAddress = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [feedbackIndex, fiLen] = readU64(data, offset); offset += fiLen
    const [value, valLen] = readI128(data, offset); offset += valLen
    const valueDecimals = data[offset]; offset += 1
    const [score, scoreLen] = readOptionU8(data, offset); offset += scoreLen
    const [tag1, tag1Len] = readBorshString(data, offset); offset += tag1Len
    const [tag2, tag2Len] = readBorshString(data, offset); offset += tag2Len
    const [endpoint, epLen] = readBorshString(data, offset); offset += epLen
    const [feedbackUri, fuLen] = readBorshString(data, offset); offset += fuLen
    const [sealHash] = readFixedBytes32(data, offset)

    return {
      asset,
      client_address: clientAddress,
      feedback_index: feedbackIndex,
      value,
      value_decimals: valueDecimals,
      score,
      tag1,
      tag2,
      endpoint,
      feedback_uri: feedbackUri,
      seal_hash: sealHash,
    }
  } catch { return null }
}

/**
 * Parse a FeedbackRevoked event.
 * Layout: asset(32) + client_address(32) + feedback_index(u64) + seal_hash([u8;32])
 */
function parseFeedbackRevoked(data: Buffer): Record<string, any> | null {
  try {
    let offset = 0
    const asset = readPubkey(data, offset); offset += PUBKEY_SIZE
    const clientAddress = readPubkey(data, offset); offset += PUBKEY_SIZE
    const [feedbackIndex, fiLen] = readU64(data, offset); offset += fiLen
    const [sealHash] = readFixedBytes32(data, offset)
    return { asset, client_address: clientAddress, feedback_index: feedbackIndex, seal_hash: sealHash }
  } catch { return null }
}

/**
 * Sol8004Provider — 8004-solana (QuantuLabs) identity provider.
 *
 * Watches the Agent Registry and ATOM Engine programs for identity and
 * reputation events, parsing Anchor-encoded log data into staging events.
 */
export class Sol8004Provider implements SolanaIdentityProvider {
  readonly id = 'sol8004'
  readonly name = '8004-solana Agent Registry (QuantuLabs)'
  readonly programIds = [AGENT_REGISTRY_PROGRAM, ATOM_ENGINE_PROGRAM]

  parseTransaction(tx: HeliusTransaction): StagingEvent[] {
    // Extract Anchor event buffers from log messages
    const logMessages = (tx as any).logMessages as string[] | undefined
    const eventBuffers = extractAnchorEventData(logMessages, this.programIds)

    if (eventBuffers.length === 0) return []

    const events: StagingEvent[] = []

    for (const buf of eventBuffers) {
      const eventName = matchDiscriminator(buf)
      if (!eventName) continue

      // Data after the 8-byte discriminator
      const data = buf.subarray(8)
      const staging = this.parseSingleEvent(eventName, data, tx)
      if (staging) events.push(staging)
    }

    return events
  }

  private parseSingleEvent(
    eventName: string,
    data: Buffer,
    tx: HeliusTransaction,
  ): StagingEvent | null {
    const base = {
      source: this.id,
      chain: 'solana' as const,
      tx_hash: tx.signature,
      block_number: tx.slot,
    }

    switch (eventName) {
      case 'AgentRegistered': {
        const parsed = parseAgentRegistered(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'agent_registered',
          agent_id: parsed.asset,
          payload: {
            owner_address: parsed.owner,
            agent_uri: parsed.agent_uri,
            collection: parsed.collection,
            atom_enabled: parsed.atom_enabled,
          },
        }
      }

      case 'UriUpdated': {
        const parsed = parseUriUpdated(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'uri_updated',
          agent_id: parsed.asset,
          payload: {
            agent_uri: parsed.new_uri,
            updated_by: parsed.updated_by,
          },
        }
      }

      case 'MetadataSet': {
        const parsed = parseMetadataSet(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'metadata_set',
          agent_id: parsed.asset,
          payload: {
            key: parsed.key,
            value: parsed.value,
            immutable: parsed.immutable,
          },
        }
      }

      case 'WalletUpdated': {
        const parsed = parseWalletUpdated(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'metadata_set',
          agent_id: parsed.asset,
          payload: {
            value: 'agentWallet',
            data: parsed.new_wallet,
            old_wallet: parsed.old_wallet,
            updated_by: parsed.updated_by,
          },
        }
      }

      case 'AgentOwnerSynced': {
        const parsed = parseAgentOwnerSynced(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'ownership_transferred',
          agent_id: parsed.asset,
          payload: {
            previous_owner: parsed.old_owner,
            new_owner: parsed.new_owner,
          },
        }
      }

      case 'MetadataDeleted': {
        const parsed = parseMetadataDeleted(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'metadata_deleted',
          agent_id: parsed.asset,
          payload: {
            key: parsed.key,
          },
        }
      }

      case 'NewFeedback': {
        const parsed = parseNewFeedback(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'new_feedback',
          agent_id: parsed.asset,
          payload: {
            client_address: parsed.client_address,
            feedback_index: parsed.feedback_index,
            value: parsed.value,
            value_decimals: parsed.value_decimals,
            score: parsed.score,
            tag1: parsed.tag1,
            tag2: parsed.tag2,
            endpoint: parsed.endpoint,
            feedback_uri: parsed.feedback_uri,
            seal_hash: parsed.seal_hash,
          },
        }
      }

      case 'FeedbackRevoked': {
        const parsed = parseFeedbackRevoked(data)
        if (!parsed) return null
        return {
          ...base,
          event_type: 'feedback_revoked',
          agent_id: parsed.asset,
          payload: {
            client_address: parsed.client_address,
            feedback_index: parsed.feedback_index,
            seal_hash: parsed.seal_hash,
          },
        }
      }

      default:
        return null
    }
  }
}
