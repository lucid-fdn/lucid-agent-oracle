import { describe, it, expect, beforeEach } from 'vitest'
import { AttestationService, type ReportEnvelope } from '../services/attestation-service.js'

describe('AttestationService', () => {
  let service: AttestationService

  beforeEach(() => {
    service = new AttestationService({ seed: 'test-seed-for-oracle-economy' })
  })

  it('creates a signed report envelope', () => {
    const envelope = service.signReport({
      feed_id: 'aegdp',
      feed_version: 1,
      report_timestamp: 1710288000,
      values: { aegdp: 847_000_000 },
      input_manifest_hash: 'abc123',
      computation_hash: 'def456',
      revision: 0,
    })
    expect(envelope.signer_set_id).toBe('ss_lucid_v1')
    expect(envelope.signatures).toHaveLength(1)
    expect(envelope.signatures[0].signer).toBeTruthy()
    expect(envelope.signatures[0].sig).toBeTruthy()
  })

  it('verifies a valid report', () => {
    const envelope = service.signReport({
      feed_id: 'aegdp',
      feed_version: 1,
      report_timestamp: 1710288000,
      values: { aegdp: 847_000_000 },
      input_manifest_hash: 'abc123',
      computation_hash: 'def456',
      revision: 0,
    })
    expect(service.verifyReport(envelope)).toBe(true)
  })

  it('rejects a tampered report', () => {
    const envelope = service.signReport({
      feed_id: 'aegdp',
      feed_version: 1,
      report_timestamp: 1710288000,
      values: { aegdp: 847_000_000 },
      input_manifest_hash: 'abc123',
      computation_hash: 'def456',
      revision: 0,
    })
    const tampered = { ...envelope, values: { aegdp: 999_000_000 } }
    expect(service.verifyReport(tampered)).toBe(false)
  })

  it('returns the public key', () => {
    const pubKey = service.getPublicKey()
    expect(pubKey).toMatch(/^[a-f0-9]{64}$/)
  })
})
