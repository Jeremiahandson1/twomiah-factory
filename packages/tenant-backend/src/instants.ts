/**
 * A TIMESTAMP LEAVING THIS API CARRIES ITS ZONE. (T58j)
 *
 *   Owner, twice: *"/api/audit created_at still has no timezone (on all tenants). The pages now
 *   display it correctly, but the API still sends "2026-10-07 08:22:16.838688". The 2FA createdAt
 *   has the same problem."*
 *
 * Both true, and verified against a live tenant rather than reasoned about — GET /api/audit on
 * ctrtest returned `"created_at":"2026-10-07 12:26:26.457646"` while the real instant was
 * 12:27:04 UTC, which is what proves the stored value is UTC and not the reporter's local time.
 *
 * WHY IT HAPPENS. `audit_log.created_at` is `timestamp` — no zone — defaulting to `now()`. These
 * rows come off a raw `db.execute`, and under Bun the driver hands the column back as the literal
 * text Postgres printed: a SPACE separator and no zone marker. That is not ISO-8601, so `new Date()`
 * on it is implementation-defined and every browser reads it as LOCAL time. The column is UTC, so an
 * event at 12:26Z rendered five hours late for a reader in ET — and the row ORDER stayed correct the
 * whole time, which is exactly why it read as plausible for so long.
 *
 * WHY HERE AND NOT ONLY IN THE READER. packages/tenant-ui/src/audit/auditFields.ts already repairs
 * this for the Audit Log screen, and that fix stays — it deliberately leaves a value that already
 * carries a zone alone, so serving proper ISO from here cannot double-shift it. But a reader-side
 * repair only helps the one screen that imports it. The API is consumed by exports, by scripts, and
 * by whatever is written next, and every one of those would have to rediscover that the field lies
 * about its zone. An instant that leaves the server ambiguous is a defect at the server.
 *
 * MICROSECONDS ARE KEPT. Postgres prints 6 fractional digits and JS Dates hold 3, so a
 * `new Date(...).toISOString()` round-trip would silently drop precision the column actually stores.
 * The zone marker is appended textually instead, which is lossless and needs no Date at all.
 */

/** Matches Postgres' zone-less rendering: `YYYY-MM-DD[ T]HH:MM:SS[.ffffff]`, nothing after it. */
const ZONELESS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/
/** A bare date, which must mean midnight UTC — not midnight wherever the reader happens to be. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * One value as an unambiguous instant.
 *
 * Anything already unambiguous is returned untouched — a trailing `Z`, a ±hh:mm offset, a null, a
 * number, an object. Only the zone-less shape above is changed, so this is safe to run over a column
 * whose type later becomes `timestamptz` and starts arriving correct on its own.
 */
export const asInstant = (value: unknown): unknown => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : value.toISOString()
  if (typeof value !== 'string') return value

  const raw = value.trim()
  if (!raw) return value
  if (BARE_DATE.test(raw)) return `${raw}T00:00:00Z`

  const m = ZONELESS.exec(raw)
  return m ? `${m[1]}T${m[2]}Z` : value
}

/**
 * The same, over the timestamp fields of a result set.
 *
 * Snake_case AND camelCase are both named by default because these rows come off a raw `db.execute`
 * (so `created_at`) while hand-built response objects spell it `createdAt` — the 2FA device list is
 * exactly that second shape. Naming both costs nothing and means neither spelling can be missed.
 */
export const withInstants = <T>(rows: T[], fields: string[] = ['created_at', 'createdAt']): T[] => {
  /**
   * Call sites read `(result as any).rows || result`, which exists because the drivers disagree about
   * whether a result IS the array or merely HOLDS it. If that fallback ever yields a non-array, a
   * `.map` here would turn a working audit log into a 500 — so a shape this cannot improve is simply
   * handed back untouched. Repairing a timestamp is never worth taking the endpoint down.
   */
  if (!Array.isArray(rows)) return rows
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row
    let out: any = row
    for (const f of fields) {
      if (!(f in (row as any))) continue
      const fixed = asInstant((row as any)[f])
      if (fixed === (row as any)[f]) continue
      if (out === row) out = { ...(row as any) }
      out[f] = fixed
    }
    return out
  })
}
