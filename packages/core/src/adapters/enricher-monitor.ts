/**
 * Enricher Health Monitor — lightweight tracker for enricher loop health.
 *
 * Tracks last-run time, consecutive errors, and items processed for each
 * enricher.  Exposes a simple API for the health endpoint to consume.
 */

export interface EnricherStatus {
  name: string
  lastRunAt: Date | null
  lastSuccessAt: Date | null
  lastError: string | null
  itemsProcessed: number
  consecutiveErrors: number
}

const enricherStatus = new Map<string, EnricherStatus>()

function getOrCreate(name: string): EnricherStatus {
  let s = enricherStatus.get(name)
  if (!s) {
    s = {
      name,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      itemsProcessed: 0,
      consecutiveErrors: 0,
    }
    enricherStatus.set(name, s)
  }
  return s
}

/**
 * Report a successful enricher cycle.
 */
export function reportEnricherRun(name: string, itemsProcessed: number): void {
  const s = getOrCreate(name)
  s.lastRunAt = new Date()
  s.lastSuccessAt = new Date()
  s.lastError = null
  s.itemsProcessed += itemsProcessed
  s.consecutiveErrors = 0
}

/**
 * Report an enricher error.
 */
export function reportEnricherError(name: string, error: string): void {
  const s = getOrCreate(name)
  s.lastRunAt = new Date()
  s.lastError = error
  s.consecutiveErrors++
}

/**
 * Get current health status for all known enrichers.
 */
export function getEnricherHealth(): EnricherStatus[] {
  return Array.from(enricherStatus.values())
}

/**
 * Check for stale enrichers — any enricher that hasn't run in 3x its
 * expected interval is considered stale and a warning is logged.
 */
export function checkStaleEnrichers(
  expectedIntervals: Record<string, number>,
): string[] {
  const warnings: string[] = []
  const now = Date.now()
  for (const [name, intervalMs] of Object.entries(expectedIntervals)) {
    const s = enricherStatus.get(name)
    if (!s || !s.lastRunAt) continue
    const elapsed = now - s.lastRunAt.getTime()
    if (elapsed > intervalMs * 3) {
      const msg = `[enricher-monitor] WARNING: "${name}" is stale — last ran ${Math.round(elapsed / 60_000)}min ago (expected every ${Math.round(intervalMs / 60_000)}min)`
      console.warn(msg)
      warnings.push(msg)
    }
  }
  return warnings
}

/** Reset all state — for testing. */
export function _resetEnricherStatus(): void {
  enricherStatus.clear()
}
