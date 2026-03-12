import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js'
import { encodeOnChainValue, type PublicationRequest, type FeedId } from '@lucid/oracle-core'
import * as ed from '@noble/ed25519'
import { createHash } from 'node:crypto'

ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const h = createHash('sha512')
  for (const m of msgs) h.update(m)
  return new Uint8Array(h.digest())
}

const RETRY_DELAYS = [0, 2000, 4000]

export function buildReportMessage(
  feedId: Buffer,
  reportTimestamp: bigint,
  value: bigint,
  decimals: number,
  confidence: number,
  revision: number,
  inputManifestHash: Buffer,
  computationHash: Buffer,
): Buffer {
  const buf = Buffer.alloc(101)
  let offset = 0
  feedId.copy(buf, offset); offset += 16
  buf.writeBigInt64LE(reportTimestamp, offset); offset += 8
  buf.writeBigUInt64LE(value, offset); offset += 8
  buf.writeUInt8(decimals, offset); offset += 1
  buf.writeUInt16LE(confidence, offset); offset += 2
  buf.writeUInt16LE(revision, offset); offset += 2
  inputManifestHash.copy(buf, offset); offset += 32
  computationHash.copy(buf, offset)
  return buf
}

export function buildEd25519VerifyInstruction(
  publicKey: Buffer,
  signature: Buffer,
  message: Buffer,
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: new Uint8Array(publicKey),
    message: new Uint8Array(message),
    signature: new Uint8Array(signature),
  })
}

const POST_REPORT_DISCRIMINATOR = Buffer.from(
  createHash('sha256').update('global:post_report').digest().subarray(0, 8),
)

export function serializePostReportData(
  value: bigint,
  decimals: number,
  confidence: number,
  revision: number,
  reportTimestamp: bigint,
  inputManifestHash: Buffer,
  computationHash: Buffer,
): Buffer {
  const buf = Buffer.alloc(8 + 93)
  let offset = 0
  POST_REPORT_DISCRIMINATOR.copy(buf, offset); offset += 8
  buf.writeBigUInt64LE(value, offset); offset += 8
  buf.writeUInt8(decimals, offset); offset += 1
  buf.writeUInt16LE(confidence, offset); offset += 2
  buf.writeUInt16LE(revision, offset); offset += 2
  buf.writeBigInt64LE(reportTimestamp, offset); offset += 8
  inputManifestHash.copy(buf, offset); offset += 32
  computationHash.copy(buf, offset)
  return buf
}

export interface SolanaClient {
  connection: Connection
  keypair: Keypair
  programId: PublicKey
}

export async function postToSolana(
  client: SolanaClient,
  req: PublicationRequest,
  oracleAttestationKey: Uint8Array,
): Promise<string> {
  const { value, decimals } = encodeOnChainValue(req.feed_id as FeedId, req.value_usd, req.value_index)
  const confidenceBps = Math.round(req.confidence * 10000)
  const timestamp = BigInt(new Date(req.computed_at).getTime()) // milliseconds since epoch

  const feedIdBuf = Buffer.alloc(16)
  feedIdBuf.write(req.feed_id, 'utf8')

  const inputManifestHash = Buffer.from(req.input_manifest_hash.replace(/^0x/, '').padStart(64, '0'), 'hex')
  const computationHash = Buffer.from(req.computation_hash.replace(/^0x/, '').padStart(64, '0'), 'hex')

  const message = buildReportMessage(
    feedIdBuf, timestamp, value, decimals, confidenceBps, req.revision,
    inputManifestHash, computationHash,
  )

  const signature = ed.sign(new Uint8Array(message), oracleAttestationKey)
  const pubKey = ed.getPublicKey(oracleAttestationKey)

  const ed25519Ix = buildEd25519VerifyInstruction(
    Buffer.from(pubKey), Buffer.from(signature), message,
  )

  const [feedConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('feed'), feedIdBuf], client.programId,
  )
  const [feedReportPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('report'), feedIdBuf], client.programId,
  )

  let lastError: Error | undefined
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS[attempt])
    try {
      const { blockhash } = await client.connection.getLatestBlockhash()

      const postReportData = serializePostReportData(
        value, decimals, confidenceBps, req.revision, timestamp,
        inputManifestHash, computationHash,
      )

      const postReportIx = new TransactionInstruction({
        programId: client.programId,
        keys: [
          { pubkey: feedConfigPda, isSigner: false, isWritable: false },
          { pubkey: feedReportPda, isSigner: false, isWritable: true },
          { pubkey: client.keypair.publicKey, isSigner: true, isWritable: false },
          { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: postReportData,
      })

      const messageV0 = new TransactionMessage({
        payerKey: client.keypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [ed25519Ix, postReportIx],
      }).compileToV0Message()

      const tx = new VersionedTransaction(messageV0)
      tx.sign([client.keypair])

      const txSig = await client.connection.sendTransaction(tx)
      await client.connection.confirmTransaction(txSig, 'confirmed')
      return txSig
    } catch (err) {
      lastError = err as Error
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
