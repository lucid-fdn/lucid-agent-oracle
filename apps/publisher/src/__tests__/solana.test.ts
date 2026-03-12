import { describe, it, expect, vi } from 'vitest'
import { buildReportMessage, buildEd25519VerifyInstruction, serializePostReportData } from '../solana.js'

describe('buildReportMessage', () => {
  it('produces 101-byte canonical message', () => {
    const feedId = Buffer.alloc(16)
    feedId.write('aegdp', 'utf8')

    const msg = buildReportMessage(
      feedId,
      BigInt(1710288000000),
      BigInt(847_000_000_000),
      6, 9700, 0,
      Buffer.alloc(32), Buffer.alloc(32),
    )

    expect(msg.length).toBe(101)
    expect(msg.subarray(0, 5).toString('utf8')).toBe('aegdp')
    expect(msg.readBigInt64LE(16)).toBe(BigInt(1710288000000))
    expect(msg.readBigUInt64LE(24)).toBe(BigInt(847_000_000_000))
    expect(msg[32]).toBe(6)
    expect(msg.readUInt16LE(33)).toBe(9700)
    expect(msg.readUInt16LE(35)).toBe(0)
  })
})

describe('buildEd25519VerifyInstruction', () => {
  it('creates instruction with correct program ID', () => {
    const ix = buildEd25519VerifyInstruction(
      Buffer.alloc(32),
      Buffer.alloc(64),
      Buffer.alloc(101),
    )
    expect(ix.programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111')
  })
})

describe('serializePostReportData', () => {
  it('produces 101-byte buffer with 8-byte discriminator + 93-byte args', () => {
    const data = serializePostReportData(
      BigInt(847_000_000_000),
      6, 9700, 0,
      BigInt(1710288000000),
      Buffer.alloc(32, 0xab),
      Buffer.alloc(32, 0xcd),
    )

    expect(data.length).toBe(101)
    expect(data.subarray(0, 8).length).toBe(8)
    expect(data.readBigUInt64LE(8)).toBe(BigInt(847_000_000_000))
    expect(data[16]).toBe(6)
    expect(data.readUInt16LE(17)).toBe(9700)
    expect(data.readUInt16LE(19)).toBe(0)
    expect(data.readBigInt64LE(21)).toBe(BigInt(1710288000000))
    expect(data[29]).toBe(0xab)
    expect(data[61]).toBe(0xcd)
  })
})
