-- Wallet resolution + transaction tracking for ERC-8004 agents.
-- Phase 2 of the Oracle data pipeline: identity → wallets → transactions.

-- URI resolution tracking
ALTER TABLE oracle_agent_entities
  ADD COLUMN IF NOT EXISTS uri_resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_entities_unresolved_uri
  ON oracle_agent_entities (agent_uri)
  WHERE agent_uri IS NOT NULL AND uri_resolved_at IS NULL;

-- Expand link_type CHECK constraints for new wallet sources
ALTER TABLE oracle_wallet_mappings
  DROP CONSTRAINT IF EXISTS oracle_wallet_mappings_link_type_check;
ALTER TABLE oracle_wallet_mappings
  ADD CONSTRAINT oracle_wallet_mappings_link_type_check
  CHECK (link_type IN ('explicit_claim', 'onchain_proof', 'gateway_correlation', 'behavioral_heuristic', 'uri_declared'));

ALTER TABLE oracle_identity_links
  DROP CONSTRAINT IF EXISTS oracle_identity_links_link_type_check;
ALTER TABLE oracle_identity_links
  ADD CONSTRAINT oracle_identity_links_link_type_check
  CHECK (link_type IN ('explicit_claim', 'onchain_proof', 'gateway_correlation', 'behavioral_heuristic', 'uri_declared'));

-- Agent wallet transactions (ERC-20 transfers to/from agent wallets)
CREATE TABLE IF NOT EXISTS oracle_wallet_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity TEXT NOT NULL REFERENCES oracle_agent_entities(id),
  chain TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  counterparty TEXT,
  token_address TEXT,
  token_symbol TEXT,
  amount TEXT NOT NULL,
  amount_usd NUMERIC,
  event_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_entity
  ON oracle_wallet_transactions (agent_entity);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_timestamp
  ON oracle_wallet_transactions (event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet
  ON oracle_wallet_transactions (chain, wallet_address);
