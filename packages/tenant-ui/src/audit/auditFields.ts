/**
 * READING AN AUDIT ROW. Pure, so it can be tested without a browser. (T58 follow-up)
 *
 * Owner, on the first version of the Audit Log page: *"it shows '—' and 'System' in every row. The
 * data is in the API, so the page is probably reading the wrong field names."* Exactly right. The
 * rows come off a raw `db.execute`, so they arrive snake_case — `created_at`, `user_name`,
 * `user_email`, `entity_name`, `ip_address` — and the page asked for `createdAt`, `userName`,
 * `entityName`, `ipAddress`. Every one was undefined and it printed its fallbacks.
 *
 * That was the SECOND shape mismatch on this page; the filter options differed per template too. The
 * reason both happened is that these readers lived inside a .tsx that nothing could execute without
 * React, so they were only ever checked by looking at them. They live here now, with no imports at
 * all, and scripts/check-audit-page-reads-both-shapes.ts runs real rows through them in CI.
 *
 * Both spellings are accepted. Nine templates feed this screen and a shared screen cannot assume a
 * shape — accepting either costs nothing and cannot be wrong whichever way a route is written.
 */

/** 'status_change' → 'Status change', 'kiosk_age_denied' → 'Kiosk age denied'. */
export const humanise = (v: string) => v.replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase())

/** A field by its camelCase name, however the API spelled it. */
export const field = (log: any, camel: string): any => {
  const snake = camel.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)
  return log?.[camel] ?? log?.[snake]
}

/**
 * Who acted.
 *
 * Falls back to the record's own name before "System", because on a sign-in row the user columns are
 * null and `entity_name` holds the account that signed in — naming it is strictly better than
 * calling a person "System".
 */
export const who = (log: any): string =>
  field(log, 'userName') || field(log, 'userEmail') || field(log, 'entityName') || 'System'

/**
 * WHAT CHANGED — the column that was always "—".
 *
 * It read `log.description || log.details`, and the API sends neither: a description lives inside
 * `metadata`, and a field-level edit is in `changes` as { field: { old, new } }. So the one column
 * that says what actually happened was empty on every row of a log that had plenty to say.
 */
export const whatChanged = (log: any): string => {
  const meta = log?.metadata && typeof log.metadata === 'object' ? log.metadata : null
  if (meta?.description) return String(meta.description)

  const changes = log?.changes && typeof log.changes === 'object' ? log.changes : null
  if (changes) {
    const parts = Object.entries(changes).slice(0, 3).map(([k, v]: [string, any]) => {
      const from = v && typeof v === 'object' ? v.old : undefined
      const to = v && typeof v === 'object' ? v.new : v
      const show = (x: unknown) => (x === null || x === undefined || x === '' ? '—' : String(x).slice(0, 40))
      return from === undefined ? `${humanise(k)}: ${show(to)}` : `${humanise(k)}: ${show(from)} → ${show(to)}`
    })
    if (parts.length) return parts.join(', ') + (Object.keys(changes).length > 3 ? ' …' : '')
  }

  if (meta) {
    // A money entry says its amount; anything else falls back to the few keys worth reading.
    for (const k of ['amount', 'total', 'reason', 'status', 'confirmationNumber', 'method']) {
      if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') return `${humanise(k)}: ${String(meta[k]).slice(0, 60)}`
    }
  }
  return '—'
}
