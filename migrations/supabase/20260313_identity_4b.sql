-- Plan 4B: Self-Registration + Identity Evidence + Conflict Review
-- Depends on: 20260312_agent_identity.sql (Plan 4A tables)

-- 1. Add UNIQUE constraint on lucid_tenant (was indexed but not unique in 4A)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_entities_lucid_unique
  ON agent_entities(lucid_tenant) WHERE lucid_tenant IS NOT NULL;

-- 2. registration_challenges — nonce-based challenge-response
CREATE TABLE IF NOT EXISTS registration_challenges (
  nonce           TEXT PRIMARY KEY,
  chain           TEXT NOT NULL,
  address         TEXT NOT NULL,
  target_entity   TEXT,
  auth_chain      TEXT,
  auth_address    TEXT,
  message         TEXT NOT NULL,
  environment     TEXT NOT NULL,
  issued_at       TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_challenges_lookup
  ON registration_challenges(chain, address) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_challenges_expiry
  ON registration_challenges(expires_at) WHERE consumed_at IS NULL;

-- 3. identity_evidence — first-class evidence table (replaces inline evidence_json)
CREATE TABLE IF NOT EXISTS identity_evidence (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity    TEXT NOT NULL REFERENCES agent_entities(id),
  evidence_type   TEXT NOT NULL,
  chain           TEXT,
  address         TEXT,
  signature       TEXT,
  message         TEXT,
  nonce           TEXT,
  verified_at     TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  metadata_json   JSONB
);

CREATE INDEX IF NOT EXISTS idx_evidence_entity ON identity_evidence(agent_entity);
CREATE INDEX IF NOT EXISTS idx_evidence_chain_address ON identity_evidence(chain, address);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_dedup_correlation
  ON identity_evidence(agent_entity, evidence_type, chain, address)
  WHERE evidence_type = 'gateway_correlation' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_dedup_signed
  ON identity_evidence(agent_entity, evidence_type, chain, address)
  WHERE evidence_type = 'signed_message' AND revoked_at IS NULL;

-- 4. identity_conflicts — conservative conflict handling
CREATE TABLE IF NOT EXISTS identity_conflicts (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain               TEXT NOT NULL,
  address             TEXT NOT NULL,
  existing_entity     TEXT NOT NULL REFERENCES agent_entities(id),
  claiming_entity     TEXT NOT NULL REFERENCES agent_entities(id),
  existing_confidence REAL NOT NULL,
  claiming_confidence REAL NOT NULL,
  claim_evidence_id   BIGINT REFERENCES identity_evidence(id),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution          TEXT
                      CHECK (resolution IS NULL OR resolution IN ('keep_existing', 'keep_claiming', 'merge')),
  resolved_by         TEXT,
  resolution_reason   TEXT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_status ON identity_conflicts(status) WHERE status = 'open';
