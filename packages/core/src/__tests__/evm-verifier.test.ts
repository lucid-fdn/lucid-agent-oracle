import { describe, it, expect } from 'vitest'
import { evmVerifier } from '../identity/evm-verifier.js'

describe('EvmVerifier', () => {
  it('has correct chain list', () => {
    expect(evmVerifier.chains).toEqual(['base', 'ethereum', 'arbitrum', 'polygon', 'gnosis', 'optimism'])
  })

  it('verifies a valid personal_sign signature', async () => {
    const { ethers } = await import('ethers')
    const wallet = ethers.Wallet.createRandom()
    const message = 'Lucid Agent Oracle -- test message'
    const signature = await wallet.signMessage(message)

    const result = await evmVerifier.verify(wallet.address, message, signature)
    expect(result).toBe(true)
  })

  it('rejects a signature from a different address', async () => {
    const { ethers } = await import('ethers')
    const wallet = ethers.Wallet.createRandom()
    const message = 'Lucid Agent Oracle -- test message'
    const signature = await wallet.signMessage(message)

    const otherWallet = ethers.Wallet.createRandom()
    const result = await evmVerifier.verify(otherWallet.address, message, signature)
    expect(result).toBe(false)
  })

  it('returns false for malformed signature', async () => {
    const result = await evmVerifier.verify('0x1234', 'test', 'not-a-sig')
    expect(result).toBe(false)
  })
})
