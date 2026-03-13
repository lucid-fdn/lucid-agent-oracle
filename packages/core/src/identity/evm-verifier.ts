import { ethers } from 'ethers'
import type { WalletVerifier } from './wallet-verifier.js'

const EVM_CHAINS = ['base', 'ethereum', 'arbitrum', 'polygon', 'gnosis', 'optimism'] as const

/** EVM personal_sign (EIP-191) verifier -- stateless, pure function */
export const evmVerifier: WalletVerifier = {
  chains: EVM_CHAINS,

  async verify(address: string, message: string, signature: string): Promise<boolean> {
    try {
      const recovered = ethers.verifyMessage(message, signature)
      return recovered.toLowerCase() === address.toLowerCase()
    } catch {
      return false
    }
  },
}
