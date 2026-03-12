-- migrations/clickhouse/004_published_feed_values_v2.sql
-- Plan 2B: Add pub_status_rev column, change ReplacingMergeTree version column.
-- DESTRUCTIVE: drops and recreates published_feed_values.
-- Safe in Plan 2B — no production data exists yet.

DROP TABLE IF EXISTS published_feed_values;

CREATE TABLE published_feed_values (
  feed_id             LowCardinality(String),
  feed_version        UInt16,
  computed_at         DateTime64(3),
  revision            UInt16 DEFAULT 0,
  pub_status_rev      UInt16 DEFAULT 0,
  value_json          String,
  value_usd           Nullable(Float64),
  value_index         Nullable(Float64),
  confidence          Float32,
  completeness        Float32,
  freshness_ms        UInt32,
  staleness_risk      LowCardinality(String),
  revision_status     LowCardinality(String) DEFAULT 'preliminary',
  methodology_version UInt16,
  input_manifest_hash String,
  computation_hash    String,
  signer_set_id       String,
  signatures_json     String,
  source_coverage     String,
  published_solana    Nullable(String),
  published_base      Nullable(String)
) ENGINE = ReplacingMergeTree(pub_status_rev)
ORDER BY (feed_id, feed_version, computed_at);
