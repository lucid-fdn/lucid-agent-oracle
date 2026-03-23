/**
 * Rate Limit Tracker — simple daily call counter per external API.
 *
 * Tracks usage against known daily limits and logs warnings when usage
 * exceeds 80% of the daily limit.
 */

export type ApiName = 'moralis' | 'helius' | 'quicknode' | 'graph'

interface ApiCounter {
  count: number
  resetAt: Date
}

const apiCalls = new Map<string, ApiCounter>()

const DAILY_LIMITS: Record<ApiName, number> = {
  moralis: 40_000,
  helius: 100_000,
  quicknode: 50_000_000,
  graph: 100_000,
}

const WARNING_THRESHOLD = 0.8

function getOrReset(api: string): ApiCounter {
  const now = new Date()
  let counter = apiCalls.get(api)
  if (!counter || now >= counter.resetAt) {
    // Reset at midnight UTC
    const tomorrow = new Date(now)
    tomorrow.setUTCHours(24, 0, 0, 0)
    counter = { count: 0, resetAt: tomorrow }
    apiCalls.set(api, counter)
  }
  return counter
}

/**
 * Track a single API call. Logs a warning when usage exceeds 80% of the
 * daily limit for known APIs.
 */
export function trackApiCall(api: ApiName): void {
  const counter = getOrReset(api)
  counter.count++

  const limit = DAILY_LIMITS[api]
  if (limit && counter.count === Math.ceil(limit * WARNING_THRESHOLD)) {
    console.warn(
      `[rate-tracker] WARNING: ${api} usage at 80% of daily limit (${counter.count}/${limit})`,
    )
  }
}

/**
 * Get current usage across all tracked APIs.
 */
export function getApiUsage(): Record<string, { calls_today: number; limit: number }> {
  const result: Record<string, { calls_today: number; limit: number }> = {}
  for (const api of Object.keys(DAILY_LIMITS) as ApiName[]) {
    const counter = getOrReset(api)
    result[api] = {
      calls_today: counter.count,
      limit: DAILY_LIMITS[api],
    }
  }
  return result
}

/** Reset all counters — for testing. */
export function _resetApiCalls(): void {
  apiCalls.clear()
}
