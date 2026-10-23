// What the Factory makes of a CRM's reply to POST /api/internal/sync-features (routes/factory/admin.ts, the admin
// feature save): verify-after-push. The CRM answers with the list it actually stored — `features` — and the save is in
// sync only when every feature sent is in it. One a CRM did not store (a feature its industry is not offered, dropped by
// the unified app's withinOffer; or one silently lost) is named as missing, so a save can never look synced when the
// business does not have what the admin switched on. Pure: the route does the fetch; the unified app's tests run its own
// reply through this (apps/unified/tests/features-within-offer.test.ts).
export interface SyncVerdict {
  synced: boolean
  /** The CRM's stored list, when its reply carried one. */
  received: string[]
  /** Sent and not stored. */
  missing: string[]
  /** The sentence the admin sees and the audit row keeps; null when in sync. */
  error: string | null
}

export function featureSyncVerdict(sent: string[], status: number, body: any): SyncVerdict {
  if (status < 200 || status >= 300) return { synced: false, received: [], missing: [], error: body?.error || `HTTP ${status}` }
  const received: string[] = Array.isArray(body?.features) ? body.features.filter((f: unknown): f is string => typeof f === 'string') : []
  const missing = sent.filter((f) => !received.includes(f))
  return missing.length
    ? { synced: false, received, missing, error: `CRM returned divergent feature list (missing: ${missing.join(', ')})` }
    : { synced: true, received, missing, error: null }
}
