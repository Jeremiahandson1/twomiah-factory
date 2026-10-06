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
 * A TIMESTAMP WITH NO ZONE IS UTC, AND THE BROWSER ASSUMES OTHERWISE. (T58c)
 *
 *   Owner: "Audit Log times are 5 hours late (Contractor and Events). /api/audit sends created_at
 *   with no timezone, so the browser reads it in the wrong zone."
 *
 * Exactly the cause, and 5 hours is the reporter's own offset from UTC. These rows come off a raw
 * `db.execute`, so a `timestamp` column arrives as Postgres prints it — `2026-10-06 17:27:56.192932`
 * — with a SPACE separator and no zone marker. `new Date()` on a string in that shape is not
 * ISO-8601, so the spec leaves it implementation-defined and every browser reads it as LOCAL time.
 * The column is UTC. An event at 17:27Z was therefore rendered as 17:27 local, five hours after it
 * happened, and the row ordering looked right the whole time, which is why it read as plausible.
 *
 * Normalised HERE rather than in thirteen template audit routes: this reader is the only consumer,
 * so one fix reaches the whole fleet at once and nothing can diverge from it. A value that already
 * carries a zone is left alone, so a template that starts sending proper ISO is not double-shifted.
 */
export const asInstant = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value ?? '').trim()
  if (!raw) return null

  // Already unambiguous: trailing Z, or a ±hh:mm / ±hhmm offset.
  const hasZone = /[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)
  let iso = raw
  if (!hasZone) {
    // Postgres prints microseconds; JS reads milliseconds. Trim rather than risk an engine refusing it.
    const trimmed = raw.replace(/(\.\d{3})\d+$/, '$1')
    iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? `${trimmed}T00:00:00Z`            // a bare date — midnight UTC, not midnight wherever the reader is
      : `${trimmed.replace(' ', 'T')}Z`
  }
  const d = new Date(iso)
  if (!Number.isNaN(d.getTime())) return d
  // Last resort: whatever the engine makes of the original. Better a time than an em-dash.
  const fallback = new Date(raw)
  return Number.isNaN(fallback.getTime()) ? null : fallback
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
      const v = meta[k]
      if (v === undefined || v === null || v === '') continue
      /**
       * "Status: 200" IS NOT A CHANGE. (T58c)
       *
       *   Owner: "portal enable/disable audit rows show 'Status: 200'."
       *
       * `status` is in this list for a BUSINESS status — "partial" on a payment, "draft" on a
       * quote. The request-level audit floor also writes an HTTP status into metadata, so a
       * disabled customer portal was described to the reader as the number 200. That tells them
       * nothing and actively hides that the row had nothing better to say.
       *
       * An HTTP code is recognisable: a bare integer in 100–599 on a row the floor wrote. Skipped
       * here, and the floor now writes a real sentence instead (middleware/auditWrites.ts), so
       * these rows read "Switched off — portal".
       */
      if (k === 'status' && /^[1-5]\d\d$/.test(String(v).trim())) continue
      if (k === 'method' && /^(GET|POST|PUT|PATCH|DELETE)$/i.test(String(v).trim())) continue
      return `${humanise(k)}: ${String(v).slice(0, 60)}`
    }
  }
  return '—'
}
