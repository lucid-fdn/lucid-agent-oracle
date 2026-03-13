interface RateLimitEntry {
  timestamps: number[]
}

/** In-memory sliding-window rate limiter. No Redis dependency. */
export class RateLimiter {
  private readonly store = new Map<string, RateLimitEntry>()
  private readonly windowMs: number
  private readonly maxRequests: number

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  /** Returns true if the request is allowed, false if rate limited */
  check(key: string): boolean {
    const now = Date.now()
    const cutoff = now - this.windowMs

    let entry = this.store.get(key)
    if (!entry) {
      entry = { timestamps: [] }
      this.store.set(key, entry)
    }

    // Prune old timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

    if (entry.timestamps.length >= this.maxRequests) {
      return false
    }

    entry.timestamps.push(now)
    return true
  }

  /** Milliseconds until the next request would be allowed */
  retryAfterMs(key: string): number {
    const entry = this.store.get(key)
    if (!entry || entry.timestamps.length === 0) return 0
    const oldest = entry.timestamps[0]
    return Math.max(0, oldest + this.windowMs - Date.now())
  }
}
