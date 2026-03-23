/**
 * x402 Payment Harvester — placeholder for HTTP payment protocol support.
 *
 * x402 enables pay-per-request micropayments between agents.
 * This harvester will:
 * 1. Discover agents with x402-compatible service endpoints (from agent_uri JSON)
 * 2. Monitor settlement transactions on-chain
 * 3. Track payment flows between agents
 *
 * Not yet implemented — requires agents to expose x402 endpoints.
 * See: https://www.x402.org/
 */

export interface X402PaymentEvent {
  payer_agent: string
  payee_agent: string
  amount_usd: number
  endpoint: string
  settlement_tx: string
  chain: string
  timestamp: string
}

// Placeholder — will be implemented when x402 adoption grows
export function startX402Harvester(): { stop: () => void } {
  console.log('[x402] Payment harvester not yet active — waiting for x402 adoption')
  return { stop: () => {} }
}
