/**
 * Base Transaction Harvester — indexes ERC-20 transfers to/from resolved agent wallets.
 *
 * Uses eth_getLogs with address filters (not Ponder) to avoid indexing all USDC transfers.
 * Only queries transfers involving known agent wallet addresses.
 *
 * Checkpointed via oracle_worker_checkpoints table.
 */
import type pg from 'pg'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase()
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const CHECKPOINT_KEY = 'base_tx_harvester'

export interface TxHarvesterConfig {
  intervalMs: number
  blockBatchSize: number  // blocks per RPC query
  rpcUrl: string
}

const DEFAULT_CONFIG: TxHarvesterConfig = {
  intervalMs: 30_000,
  blockBatchSize: 2000,
  rpcUrl: '',
}

export async function harvestBaseTransactions(
  pool: pg.Pool,
  config: TxHarvesterConfig,
): Promise<number> {
  if (!config.rpcUrl) return 0

  const client = await pool.connect()
  let harvested = 0

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext('base_tx_harvester'))")
    if (!lockResult.rows[0].pg_try_advisory_lock) {
      client.release()
      return 0
    }

    // Load active Base wallets
    const walletsResult = await client.query(
      "SELECT DISTINCT LOWER(address) as address, agent_entity FROM oracle_wallet_mappings WHERE chain = 'base' AND removed_at IS NULL",
    )
    if (walletsResult.rows.length === 0) {
      await client.query("SELECT pg_advisory_unlock(hashtext('base_tx_harvester'))")
      client.release()
      return 0
    }

    const walletMap = new Map<string, string>() // address → agent_entity
    for (const row of walletsResult.rows) {
      walletMap.set(row.address, row.agent_entity as string)
    }
    const addresses = Array.from(walletMap.keys())

    // Get checkpoint (last harvested block)
    const cpResult = await client.query(
      "SELECT value FROM oracle_worker_checkpoints WHERE key = $1",
      [CHECKPOINT_KEY],
    )
    let fromBlock = cpResult.rows.length > 0 ? parseInt(cpResult.rows[0].value as string, 10) + 1 : 0

    // Get current block
    const currentBlock = await getCurrentBlock(config.rpcUrl)
    if (fromBlock === 0 || fromBlock > currentBlock) {
      // Start from 1000 blocks ago if no checkpoint
      fromBlock = Math.max(currentBlock - 1000, 0)
    }

    const toBlock = Math.min(fromBlock + config.blockBatchSize, currentBlock)
    if (fromBlock >= toBlock) {
      await client.query("SELECT pg_advisory_unlock(hashtext('base_tx_harvester'))")
      client.release()
      return 0
    }

    // Query USDC transfers involving agent wallets
    // Split into batches of 50 addresses (RPC topic filter limit)
    for (let i = 0; i < addresses.length; i += 50) {
      const batch = addresses.slice(i, i + 50)
      const paddedAddresses = batch.map((a) => '0x' + '0'.repeat(24) + a.slice(2))

      // Query transfers FROM agent wallets
      const outbound = await queryLogs(config.rpcUrl, {
        address: USDC_BASE,
        topics: [TRANSFER_TOPIC, paddedAddresses, null],
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: '0x' + toBlock.toString(16),
      })

      // Query transfers TO agent wallets
      const inbound = await queryLogs(config.rpcUrl, {
        address: USDC_BASE,
        topics: [TRANSFER_TOPIC, null, paddedAddresses],
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: '0x' + toBlock.toString(16),
      })

      // Process outbound
      for (const log of outbound) {
        const from = '0x' + log.topics[1].slice(26).toLowerCase()
        const to = '0x' + log.topics[2].slice(26).toLowerCase()
        const entityId = walletMap.get(from)
        if (!entityId) continue

        const amount = BigInt(log.data).toString()
        const blockNum = parseInt(log.blockNumber, 16)
        const logIndex = parseInt(log.logIndex, 16)

        await client.query(
          `INSERT INTO oracle_wallet_transactions
           (agent_entity, chain, wallet_address, tx_hash, block_number, log_index, direction, counterparty, token_address, token_symbol, amount, event_timestamp)
           VALUES ($1, 'base', $2, $3, $4, $5, 'outbound', $6, $7, 'USDC', $8, to_timestamp($9))
           ON CONFLICT (chain, tx_hash, log_index) DO NOTHING`,
          [entityId, from, log.transactionHash, blockNum, logIndex, to, USDC_BASE, amount, blockNum], // TODO: use actual block timestamp
        )
        harvested++
      }

      // Process inbound
      for (const log of inbound) {
        const from = '0x' + log.topics[1].slice(26).toLowerCase()
        const to = '0x' + log.topics[2].slice(26).toLowerCase()
        const entityId = walletMap.get(to)
        if (!entityId) continue

        const amount = BigInt(log.data).toString()
        const blockNum = parseInt(log.blockNumber, 16)
        const logIndex = parseInt(log.logIndex, 16)

        await client.query(
          `INSERT INTO oracle_wallet_transactions
           (agent_entity, chain, wallet_address, tx_hash, block_number, log_index, direction, counterparty, token_address, token_symbol, amount, event_timestamp)
           VALUES ($1, 'base', $2, $3, $4, $5, 'inbound', $6, $7, 'USDC', $8, to_timestamp($9))
           ON CONFLICT (chain, tx_hash, log_index) DO NOTHING`,
          [entityId, to, log.transactionHash, blockNum, logIndex, from, USDC_BASE, amount, blockNum],
        )
        harvested++
      }
    }

    // Update checkpoint
    await client.query(
      `INSERT INTO oracle_worker_checkpoints (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [CHECKPOINT_KEY, String(toBlock)],
    )

    await client.query("SELECT pg_advisory_unlock(hashtext('base_tx_harvester'))")
  } finally {
    client.release()
  }

  return harvested
}

async function getCurrentBlock(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  })
  const d = await res.json() as { result: string }
  return parseInt(d.result, 16)
}

interface LogEntry {
  topics: string[]
  data: string
  transactionHash: string
  blockNumber: string
  logIndex: string
}

async function queryLogs(
  rpcUrl: string,
  params: { address: string; topics: (string | string[] | null)[]; fromBlock: string; toBlock: string },
): Promise<LogEntry[]> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [params],
    }),
  })
  const d = await res.json() as { result?: LogEntry[]; error?: { message: string } }
  if (d.error) {
    console.error('[tx-harvester] RPC error:', d.error.message)
    return []
  }
  return d.result ?? []
}

/**
 * Start the transaction harvester on a timer.
 */
export function startTxHarvester(
  pool: pg.Pool,
  config: TxHarvesterConfig,
): { stop: () => void } {
  let running = true

  const loop = async () => {
    while (running) {
      try {
        const n = await harvestBaseTransactions(pool, config)
        if (n > 0) console.log(`[tx-harvester] Harvested ${n} USDC transfers`)
      } catch (err) {
        console.error('[tx-harvester] Error:', (err as Error).message)
      }
      await new Promise((r) => setTimeout(r, config.intervalMs))
    }
  }

  loop()
  return { stop: () => { running = false } }
}
