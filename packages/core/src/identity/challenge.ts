export interface ChallengeMessageParams {
  agentEntity: string  // entity ID or 'new'
  address: string
  chain: string
  environment: string
  nonce: string
  issuedAt: string     // ISO 8601 UTC
  expiresAt: string    // ISO 8601 UTC
}

export interface AuthMessageParams {
  targetEntity: string
  newAddress: string
  newChain: string
  authAddress: string
  authChain: string
  environment: string
  timestamp: string    // ISO 8601 UTC
}

/** Format the challenge message the NEW wallet signs */
export function formatChallengeMessage(params: ChallengeMessageParams): string {
  return `Lucid Agent Oracle — Wallet Verification

Action: Link wallet to agent identity
Agent: ${params.agentEntity}
Wallet: ${params.address}
Chain: ${params.chain}
Environment: ${params.environment}
Domain: oracle.lucid.foundation
Nonce: ${params.nonce}
Issued: ${params.issuedAt}
Expires: ${params.expiresAt}`
}

/** Format the auth message the EXISTING wallet signs to authorize attachment */
export function formatAuthMessage(params: AuthMessageParams): string {
  return `Lucid Agent Oracle — Entity Authorization

Action: Authorize wallet attachment
Entity: ${params.targetEntity}
New Wallet: ${params.newAddress}
New Chain: ${params.newChain}
Auth Wallet: ${params.authAddress}
Auth Chain: ${params.authChain}
Environment: ${params.environment}
Timestamp: ${params.timestamp}`
}

/** Challenge validity window in milliseconds (5 minutes) */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Auth signature max age in milliseconds (5 minutes) */
export const AUTH_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000
