-- No-broker adapter mode: staging table for raw adapter events.
-- Replaces Redpanda topics as the ingestion queue for Ponder, Helius, and future adapters.
-- The resolver polls this table and is the single writer to identity tables.

CREATE TABLE IF NOT EXISTS oracle_raw_adapter_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_adapter_ver INTEGER NOT NULL DEFAULT 1,
  chain TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  block_number BIGINT,
  tx_hash TEXT,
  log_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  failed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_raw_adapter_unprocessed
  ON oracle_raw_adapter_events (created_at)
  WHERE processed_at IS NULL AND failed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_adapter_source
  ON oracle_raw_adapter_events (source, chain, event_type);

CREATE INDEX IF NOT EXISTS idx_raw_adapter_failed
  ON oracle_raw_adapter_events (failed_at)
  WHERE failed_at IS NOT NULL;
