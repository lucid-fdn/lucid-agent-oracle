-- Plan 3E: SSE Streaming & Webhook Alerts
-- Extends oracle_subscriptions for webhook management + creates delivery audit log

-- ── Extend oracle_subscriptions ──────────────────────────────

ALTER TABLE oracle_subscriptions
  ADD COLUMN IF NOT EXISTS channel TEXT CHECK (channel IN ('feeds', 'agent_events', 'reports')),
  ADD COLUMN IF NOT EXISTS secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS conditions_json JSONB,
  ADD COLUMN IF NOT EXISTS filter_json JSONB,
  ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 5;

-- Backfill channel from feed_id for any existing rows
UPDATE oracle_subscriptions
  SET channel = 'feeds'
  WHERE feed_id IS NOT NULL AND channel IS NULL;

-- ── Create webhook delivery audit log ────────────────────────

CREATE TABLE IF NOT EXISTS oracle_webhook_deliveries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  subscription_id TEXT NOT NULL REFERENCES oracle_subscriptions(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  status_code INT,
  error TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'failed')) DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  UNIQUE (subscription_id, event_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_sub
  ON oracle_webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_state
  ON oracle_webhook_deliveries(state) WHERE state = 'pending';
