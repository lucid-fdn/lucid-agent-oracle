-- Position ledger for realized execution gain computation.
-- Matches sells against prior buys using FIFO cost basis.

CREATE TABLE IF NOT EXISTS oracle_position_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity TEXT NOT NULL REFERENCES oracle_agent_entities(id),
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  -- Buy side
  buy_tx_hash TEXT NOT NULL,
  buy_block_number BIGINT NOT NULL,
  buy_timestamp TIMESTAMPTZ NOT NULL,
  buy_quantity NUMERIC NOT NULL,        -- token quantity matched
  buy_price_usd NUMERIC,               -- per-token execution price at buy
  buy_notional_usd NUMERIC,            -- total USD spent on this matched quantity
  -- Sell side (NULL until matched)
  sell_tx_hash TEXT,
  sell_block_number BIGINT,
  sell_timestamp TIMESTAMPTZ,
  sell_quantity NUMERIC,                -- should equal buy_quantity when matched
  sell_price_usd NUMERIC,              -- per-token execution price at sell
  sell_notional_usd NUMERIC,           -- total USD received for this matched quantity
  -- Computed
  realized_delta_usd NUMERIC,          -- sell_notional - buy_notional (NOT profit: excludes gas)
  accounting_method TEXT NOT NULL DEFAULT 'fifo' CHECK (accounting_method IN ('fifo', 'lifo', 'avg_cost')),
  -- State
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'partial')),
  created_at TIMESTAMPTZ DEFAULT now(),
  matched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_position_ledger_agent
  ON oracle_position_ledger (agent_entity, token_address);
CREATE INDEX IF NOT EXISTS idx_position_ledger_open
  ON oracle_position_ledger (agent_entity, chain, token_address)
  WHERE status = 'open';

-- Per-swap execution prices (clean, computable now)
ALTER TABLE oracle_wallet_transactions
  ADD COLUMN IF NOT EXISTS execution_price_usd NUMERIC; -- per-token price at time of swap
