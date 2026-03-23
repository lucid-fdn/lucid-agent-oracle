/**
 * Enricher Base Utilities — shared patterns extracted from enricher modules.
 *
 * Provides advisory locking, batch processing, timer loops, and Moralis API
 * helpers that were previously duplicated across every enricher file.
 */
import type pg from 'pg'
import { reportEnricherRun, reportEnricherError } from './enricher-monitor.js'
import { trackApiCall } from './rate-tracker.js'

/** Standard enricher pattern: advisory lock + connect + release in finally */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  lockName: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect()
  try {
    const lockResult = await client.query(`SELECT pg_try_advisory_lock(hashtext($1::text))`, [lockName])
    if (!lockResult.rows[0].pg_try_advisory_lock) return null
    const result = await fn(client)
    await client.query(`SELECT pg_advisory_unlock(hashtext($1::text))`, [lockName])
    return result
  } finally {
    client.release()
  }
}

/** Standard rate-limited batch processor */
export async function processBatch<T>(
  items: T[],
  batchSize: number,
  delayMs: number,
  processor: (item: T) => Promise<void>,
): Promise<number> {
  let processed = 0
  for (const item of items.slice(0, batchSize)) {
    try {
      await processor(item)
      processed++
    } catch (err) {
      console.error('[enricher] Item error:', (err as Error).message)
    }
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
  }
  return processed
}

/** Standard enricher timer loop */
export function startEnricherLoop(
  name: string,
  intervalMs: number,
  fn: () => Promise<number | null>,
): { stop: () => void } {
  let running = true
  const loop = async () => {
    while (running) {
      try {
        const n = await fn()
        if (n != null && n > 0) console.log(`[${name}] Processed ${n} items`)
        reportEnricherRun(name, n ?? 0)
      } catch (err) {
        const msg = (err as Error).message
        console.error(`[${name}] Error:`, msg)
        reportEnricherError(name, msg)
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }
  loop()
  return { stop: () => { running = false } }
}

/** Moralis API fetch with standard auth + timeout */
export async function fetchMoralis(path: string, apiKey: string, timeoutMs = 10000): Promise<any> {
  trackApiCall('moralis')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://deep-index.moralis.io/api/v2.2${path}`, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
