import { Kafka, type Producer } from 'kafkajs'

const TOPICS = {
  ERC8004: 'raw.erc8004.events',
  AGENT_WALLETS: 'raw.agent_wallets.events',
}

let producer: Producer | null = null

export async function getProducer(): Promise<Producer> {
  if (producer) return producer

  const kafka = new Kafka({
    clientId: 'oracle-ponder-indexer',
    brokers: (process.env.REDPANDA_BROKERS ?? 'localhost:9092').split(','),
  })

  producer = kafka.producer()
  await producer.connect()
  return producer
}

export async function publishToERC8004(key: string, event: unknown): Promise<void> {
  const p = await getProducer()
  await p.send({
    topic: TOPICS.ERC8004,
    messages: [{ key, value: JSON.stringify(event) }],
  })
}

export async function publishToWalletActivity(key: string, event: unknown): Promise<void> {
  const p = await getProducer()
  await p.send({
    topic: TOPICS.AGENT_WALLETS,
    messages: [{ key, value: JSON.stringify(event) }],
  })
}

/** Gracefully disconnect the shared producer (call on process exit). */
export async function disconnectProducer(): Promise<void> {
  await producer?.disconnect()
  producer = null
}
