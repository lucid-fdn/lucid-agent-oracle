/**
 * AdapterSink — the single interface all adapters write through.
 *
 * Adapters are dumb pipes: they normalize events and call sink.writeRawEvent().
 * They never know whether the sink writes to Postgres (DirectSink) or Kafka (BrokerSink).
 */

export interface RawAdapterEvent {
  event_id: string
  source: string              // 'erc8004', 'helius', 'lucid_gateway'
  source_adapter_ver: number
  chain: string
  event_type: string          // 'agent_registered', 'transfer', 'tool_call'
  event_timestamp: string     // ISO 8601
  payload_json: string        // Adapter-specific normalized payload (JSON string)
  block_number?: number
  tx_hash?: string
  log_index?: number
}

export interface AdapterSink {
  writeRawEvent(event: RawAdapterEvent): Promise<void>
  writeRawEvents(events: RawAdapterEvent[]): Promise<void>
  close(): Promise<void>
}
