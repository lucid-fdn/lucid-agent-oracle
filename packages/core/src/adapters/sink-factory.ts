/**
 * Factory for creating the appropriate AdapterSink based on environment.
 * One env var (REDPANDA_BROKERS) switches between DirectSink and BrokerSink.
 */
import pg from 'pg'
import type { AdapterSink } from './sink.js'
import { DirectSink } from './direct-sink.js'

export interface SinkConfig {
  databaseUrl: string
  brokers?: string  // If set, use BrokerSink (future)
}

export function createAdapterSink(config: SinkConfig): AdapterSink {
  if (config.brokers) {
    // Future: return new BrokerSink(kafkaProducer, topic)
    // For now, fall through to DirectSink — broker mode not yet implemented
    console.warn('[sink-factory] REDPANDA_BROKERS set but BrokerSink not yet implemented — using DirectSink')
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl })
  return new DirectSink(pool)
}
