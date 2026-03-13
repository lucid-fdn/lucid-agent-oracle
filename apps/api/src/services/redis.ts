import { createHash } from 'node:crypto'
import type { RedisClientType } from 'redis'

/** SHA-256 hex digest of a string. */
function sha256hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Cache key builders. */
export const keys = {
  apiKey: (raw: string) => `oracle:apikey:${sha256hex(raw)}`,
}

export type { RedisClientType }
