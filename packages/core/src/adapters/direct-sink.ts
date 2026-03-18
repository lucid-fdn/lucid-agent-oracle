/**
 * DirectSink — writes raw adapter events to the Postgres staging table.
 * Used when no broker (Redpanda/Kafka) is available.
 */
import type pg from 'pg'
import type { AdapterSink, RawAdapterEvent } from './sink.js'

export class DirectSink implements AdapterSink {
  constructor(private pool: pg.Pool) {}

  async writeRawEvent(event: RawAdapterEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO oracle_raw_adapter_events
        (event_id, source, source_adapter_ver, chain, event_type,
         event_timestamp, payload_json, block_number, tx_hash, log_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.event_id,
        event.source,
        event.source_adapter_ver,
        event.chain,
        event.event_type,
        event.event_timestamp,
        event.payload_json,
        event.block_number ?? null,
        event.tx_hash ?? null,
        event.log_index ?? null,
      ],
    )
  }

  async writeRawEvents(events: RawAdapterEvent[]): Promise<void> {
    // v1: per-row insert for simplicity.
    // Upgrade to batched INSERT with unnest/multi-row VALUES when volume exceeds ~1k events/sec.
    for (const e of events) await this.writeRawEvent(e)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
