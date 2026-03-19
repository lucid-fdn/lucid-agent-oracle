-- Cross-chain, cross-DEX trading activity tracker.
-- Extends oracle_wallet_transactions with swap classification and token metadata.

-- Swap classification columns
ALTER TABLE oracle_wallet_transactions
  ADD COLUMN IF NOT EXISTS token_decimals INTEGER,
  ADD COLUMN IF NOT EXISTS tx_type TEXT CHECK (tx_type IN ('transfer', 'swap_leg', 'multi_hop_leg')),
  ADD COLUMN IF NOT EXISTS swap_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_swap_group
  ON oracle_wallet_transactions (swap_group_id)
  WHERE swap_group_id IS NOT NULL;

-- Token registry — metadata and pricing for all tracked tokens
CREATE TABLE IF NOT EXISTS oracle_token_registry (
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  decimals INTEGER DEFAULT 18,
  is_stablecoin BOOLEAN DEFAULT false,
  is_base_asset BOOLEAN DEFAULT false,
  last_known_usd_price NUMERIC,
  price_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chain, token_address)
);

-- Seed known Base tokens
INSERT INTO oracle_token_registry (chain, token_address, symbol, name, decimals, is_stablecoin, is_base_asset) VALUES
  ('base', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 'USD Coin', 6, true, false),
  ('base', '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', 'USDbC', 'USD Base Coin', 6, true, false),
  ('base', '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', 'DAI', 'Dai', 18, true, false),
  ('base', '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, false, true),
  ('base', '0x0000000000000000000000000000000000000000', 'ETH', 'Ether', 18, false, true),
  ('base', '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', 'cbBTC', 'Coinbase BTC', 8, false, true),
  ('base', '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4', 'TOSHI', 'Toshi', 18, false, false),
  ('base', '0xba0dda8762c24da9487f5fa026a9b64b695a07ea', 'OLAS', 'Olas', 18, false, false),
  ('base', '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', 'VIRTUAL', 'Virtuals Protocol', 18, false, false)
ON CONFLICT (chain, token_address) DO NOTHING;

-- Seed known Solana tokens
INSERT INTO oracle_token_registry (chain, token_address, symbol, name, decimals, is_stablecoin, is_base_asset) VALUES
  ('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 'USD Coin', 6, true, false),
  ('solana', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT', 'Tether', 6, true, false),
  ('solana', 'So11111111111111111111111111111111111111112', 'SOL', 'Solana', 9, false, true),
  ('solana', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 'JitoSOL', 'Jito Staked SOL', 9, false, true)
ON CONFLICT (chain, token_address) DO NOTHING;

-- Solana harvester checkpoint
INSERT INTO oracle_worker_checkpoints (source_table, watermark_column, last_seen_ts, last_seen_id, updated_at)
VALUES ('solana_tx_harvester', 'created_at', now(), '{}', now())
ON CONFLICT (source_table) DO NOTHING;

INSERT INTO oracle_worker_checkpoints (source_table, watermark_column, last_seen_ts, last_seen_id, updated_at)
VALUES ('base_tx_harvester', 'block_number', now(), '0', now())
ON CONFLICT (source_table) DO NOTHING;
