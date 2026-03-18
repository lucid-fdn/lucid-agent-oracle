/**
 * Ponder adapter sink — writes raw events through the AdapterSink interface.
 * Replaces the old redpanda-sink.ts that published to Kafka topics.
 */
import { createAdapterSink, type AdapterSink, type RawAdapterEvent } from '@lucid/oracle-core'

let sink: AdapterSink | null = null

export function getSink(): AdapterSink {
  if (sink) return sink

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL required for Ponder adapter sink')

  sink = createAdapterSink({
    databaseUrl,
    brokers: process.env.REDPANDA_BROKERS,
  })
  return sink
}

export async function writeERC8004Event(event: RawAdapterEvent): Promise<void> {
  await getSink().writeRawEvent(event)
}

export async function writeWalletEvent(event: RawAdapterEvent): Promise<void> {
  await getSink().writeRawEvent(event)
}

export async function closeSink(): Promise<void> {
  await sink?.close()
  sink = null
}
