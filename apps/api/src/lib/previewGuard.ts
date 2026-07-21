// Concurrency + cache guard for the PUBLIC, unauthenticated preview endpoint.
//
// A preview runs the full generator (template copy → zip → extract → render),
// which is real CPU + disk per call. Per-IP rate limiting is handled by the
// shared rateLimit() middleware on the route; this module adds the two defenses
// that middleware does not provide:
//   1. global in-flight cap  — a burst can't run more than N renders at once
//   2. short-lived cache     — identical inputs never re-render
//
// The factory API is a single in-process Render service, so in-memory state is
// authoritative. All state is bounded and self-pruning.

const GLOBAL_INFLIGHT_MAX = 3        // concurrent renders across all callers
const CACHE_TTL_MS = 15 * 60_000     // identical-input cache lifetime
const CACHE_MAX = 200                // most cached previews retained

const cache = new Map<string, { html: string; at: number }>()
let inflight = 0

/** Return cached HTML for `key` if still fresh, else null. */
export function cacheGet(key: string): string | null {
  const e = cache.get(key)
  if (!e) return null
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  // Refresh LRU position.
  cache.delete(key)
  cache.set(key, e)
  return e.html
}

/** Store rendered HTML under `key`, evicting the oldest entry past capacity. */
export function cacheSet(key: string, html: string): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { html, at: Date.now() })
}

/** Try to reserve one of the global render slots; false if all are busy. */
export function acquireInflight(): boolean {
  if (inflight >= GLOBAL_INFLIGHT_MAX) return false
  inflight++
  return true
}

/** Release a render slot reserved by acquireInflight(). */
export function releaseInflight(): void {
  inflight = Math.max(0, inflight - 1)
}
