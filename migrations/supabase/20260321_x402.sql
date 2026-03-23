-- x402 Payment Protocol Tables
-- Tracks discovered x402-compatible endpoints and correlated agent-to-agent payments.

-- ── Discovered x402 Endpoints ──────────────────────────────────
CREATE TABLE IF NOT EXISTS oracle_x402_endpoints (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity  TEXT NOT NULL,
  chain         TEXT NOT NULL,
  endpoint_url  TEXT NOT NULL,
  pay_to_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  max_amount    TEXT NOT NULL,
  description   TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (agent_entity, endpoint_url)
);

CREATE INDEX IF NOT EXISTS idx_x402_endpoints_pay_to
  ON oracle_x402_endpoints (LOWER(pay_to_address), chain);
CREATE INDEX IF NOT EXISTS idx_x402_endpoints_active
  ON oracle_x402_endpoints (is_active) WHERE is_active = true;

-- ── Correlated x402 Payments (agent-to-agent micropayments) ────
CREATE TABLE IF NOT EXISTS oracle_x402_payments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payer_agent     TEXT NOT NULL,
  payee_agent     TEXT NOT NULL,
  endpoint_url    TEXT NOT NULL,
  amount          TEXT NOT NULL,
  amount_usd      NUMERIC,
  token_address   TEXT NOT NULL,
  chain           TEXT NOT NULL,
  tx_hash         TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (chain, tx_hash)
);

CREATE INDEX IF NOT EXISTS idx_x402_payments_payer
  ON oracle_x402_payments (payer_agent);
CREATE INDEX IF NOT EXISTS idx_x402_payments_payee
  ON oracle_x402_payments (payee_agent);
CREATE INDEX IF NOT EXISTS idx_x402_payments_timestamp
  ON oracle_x402_payments (event_timestamp DESC);
