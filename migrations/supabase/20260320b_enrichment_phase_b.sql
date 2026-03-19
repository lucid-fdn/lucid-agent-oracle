-- Phase B: Premium Enrichment — ENS resolution, gas metrics, contract interactions.

-- 1. ENS / Basename resolution cache
CREATE TABLE IF NOT EXISTS oracle_name_resolution (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  resolved_name TEXT,
  avatar_url TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain, address)
);

CREATE INDEX IF NOT EXISTS idx_name_resolution_name
  ON oracle_name_resolution (resolved_name)
  WHERE resolved_name IS NOT NULL;

-- 2. Gas / activity metrics per agent (24h / 7d / 30d windows)
CREATE TABLE IF NOT EXISTS oracle_gas_metrics (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity TEXT NOT NULL REFERENCES oracle_agent_entities(id),
  period TEXT NOT NULL CHECK (period IN ('24h', '7d', '30d')),
  tx_count INTEGER NOT NULL DEFAULT 0,
  unique_contracts INTEGER NOT NULL DEFAULT 0,
  active_chains TEXT[] NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_entity, period)
);

CREATE INDEX IF NOT EXISTS idx_gas_metrics_entity
  ON oracle_gas_metrics (agent_entity);
CREATE INDEX IF NOT EXISTS idx_gas_metrics_txcount
  ON oracle_gas_metrics (tx_count DESC)
  WHERE period = '24h';

-- 3. Contract interaction tracking per agent
CREATE TABLE IF NOT EXISTS oracle_contract_interactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity TEXT NOT NULL REFERENCES oracle_agent_entities(id),
  chain TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  contract_name TEXT,
  interaction_count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_entity, chain, contract_address)
);

CREATE INDEX IF NOT EXISTS idx_contract_interactions_entity
  ON oracle_contract_interactions (agent_entity);
CREATE INDEX IF NOT EXISTS idx_contract_interactions_count
  ON oracle_contract_interactions (interaction_count DESC);
CREATE INDEX IF NOT EXISTS idx_contract_interactions_contract
  ON oracle_contract_interactions (chain, contract_address);
