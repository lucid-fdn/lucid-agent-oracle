import { onchainTable } from '@ponder/core'

// Minimal schema — Ponder requires at least one table.
// We use Ponder as adapter-only (publish to Redpanda, not store here),
// but need a schema to satisfy Ponder's startup requirements.
export const indexerState = onchainTable('indexer_state', (t) => ({
  key: t.text().primaryKey(),
  value: t.text(),
}))
