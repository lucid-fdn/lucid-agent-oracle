/** Canonical agent entity — resolved from multiple identity sources.
 *  Represents a single economic actor across protocols. */
export interface AgentEntity {
  /** Canonical entity ID (format: ae_{random}) */
  id: string
  /** Number of wallets linked to this entity */
  wallet_count: number
  /** Number of protocols this entity is active on */
  protocol_count: number
  /** Cumulative USD economic output (string for precision) */
  total_economic_output_usd: string
  /** Composite reputation score [0, 1000] */
  reputation_score: number
  /** When this entity was first observed */
  first_seen_at: Date
  created_at: Date
  updated_at: Date
}

/** Wallet → Entity mapping — links a blockchain address to a canonical entity */
export interface WalletMapping {
  wallet_address: string
  chain: string
  entity_id: string
  /** Resolution confidence [0.0, 1.0] */
  confidence: number
  /** Method used to establish this link */
  link_type: LinkType
  /** Hash of the evidence supporting this link */
  evidence_hash: string | null
  created_at: Date
}

/** Cross-protocol identity link — associates an external ID with a canonical entity */
export interface IdentityLink {
  id: string
  entity_id: string
  /** ID in the external system */
  external_id: string
  /** External system name (e.g., 'erc8004', 'virtuals', 'olas') */
  external_system: string
  /** Resolution confidence [0.0, 1.0] */
  confidence: number
  /** Method used to establish this link */
  link_type: LinkType
  created_at: Date
}

/** Method used to establish identity links, ordered by trust level */
export type LinkType =
  | 'explicit_claim'
  | 'onchain_proof'
  | 'gateway_correlation'
  | 'behavioral_heuristic'
