/**
 * EVERY WRITE LEAVES A TRACE. (T58)
 *
 *   "Contractor: gaps in the audit log."
 *
 * Measured rather than guessed: of 163 write endpoints in this template, 17 wrote an audit row and
 * 146 did not. Whole modules had no audit import at all — draw schedules (including approve and
 * mark-paid), support tickets, selections, call tracking, and every bulk action: assign jobs,
 * reschedule jobs, mark invoices paid, delete quotes, approve time, delete time. An audit log that
 * covers a tenth of the writes is not a gap in the log, it is a log nobody can rely on, and "did
 * somebody mark these invoices paid?" is exactly the question it exists to answer.
 *
 * Hand-writing 146 audit calls would have left a 147th to be added without one, which is how this
 * started. So the floor is a middleware: after any mutating request that SUCCEEDED, one row saying
 * who did what to which record. A handler that writes its own richer entry — with a field-level diff,
 * the entity's name, the old and new status — still does, and that entry is the better one; this only
 * guarantees that something is always written.
 *
 * WHAT IT RECORDS, and what it deliberately does not:
 *
 *   method, path, status, the entity from the mount segment, the record id from the URL, the actor.
 *
 * NOT the request body. Bodies here carry passwords, password resets, API keys, provider secrets and
 * customer PII, and an audit log is read by more people than the data it describes — copying bodies
 * into it would turn a safety feature into a leak. A handler that wants specific values in the log
 * passes them deliberately.
 *
 * IT CANNOT FAIL THE REQUEST. The response is already settled before anything is written, and the
 * write is wrapped: an audit log that can 500 an invoice is worse than one with gaps.
 */
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import audit, { requestAudit } from '../services/audit.ts'
import { db } from '../../db/index.ts'
import * as schema from '../../db/schema.ts'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Paths that must not be logged here, each for its own reason:
 *
 *   /api/auth        bodies are credentials, and auth already records its own sign-in/out events with
 *                    the detail that matters (failed attempts, lockouts) — a second generic row per
 *                    login would bury them.
 *   /api/webhook*    unauthenticated provider callbacks. There is no actor, they arrive in volume,
 *                    and audit_log.company_id is NOT NULL — the row could not be written anyway.
 *   /api/internal    factory-to-tenant sync, not a person doing something.
 *   /api/audit       reading or exporting the log is not itself a change to anything.
 *   /api/support/ai-chat  one row per message of a conversation, saying nothing but "a message was
 *                    sent"; the conversation is already stored.
 */
const SKIP = [/^\/api\/auth(\/|$)/, /^\/api\/internal(\/|$)/, /^\/api\/audit(\/|$)/, /\/webhook(s)?(\/|$)/, /^\/api\/support\/ai-chat$/]

/** The HTTP verb, when the path says nothing more specific. */
const ACTION_FOR: Record<string, string> = {
  POST: audit.ACTIONS?.CREATE || 'create',
  PUT: audit.ACTIONS?.UPDATE || 'update',
  PATCH: audit.ACTIONS?.UPDATE || 'update',
  DELETE: audit.ACTIONS?.DELETE || 'delete',
}

/**
 * WHAT THE PATH SAYS HAPPENED. (T58 follow-up)
 *
 * Owner: "payments, approvals and disabling the portal are all labelled 'create'." They were — the
 * action came from the HTTP verb alone, and every one of those is a POST. A log whose action column
 * says "create" for taking a payment, approving a change order and switching a customer's portal off
 * is a log you cannot scan, which is the only thing an action column is for.
 *
 * REST puts the verb in the last segment of these paths, so that is where it is read from. Anything
 * not named here still falls back to the HTTP verb, so a new endpoint is labelled roughly rather than
 * wrongly.
 */
const STATUS_WORDS = [
  'approve', 'reject', 'submit', 'dismiss', 'enable', 'disable', 'complete', 'cancel', 'void',
  'archive', 'restore', 'supersede', 'file', 'review', 'status', 'mark-paid', 'activate',
  'deactivate', 'close', 'reopen', 'publish', 'sign',
]
const ACTION_WORDS: Record<string, string> = {
  payments: 'payment', payment: 'payment', pay: 'payment',
  refund: 'refund', refunds: 'refund', credit: 'credit', credits: 'credit',
  convert: 'convert', assign: 'assign', reschedule: 'reschedule',
  send: 'send', resend: 'send', export: audit.ACTIONS?.EXPORT || 'export',
  duplicate: 'duplicate', merge: 'merge',
}

/**
 * WHAT TO SAY ON THE ROW. (T58c)
 *
 *   Owner: "portal enable/disable audit rows show 'Status: 200', and settings rows show '—'."
 *
 * Both are this middleware's doing. It wrote `metadata: { method, path, status, via }` and nothing
 * else, so the screen had no sentence to show and fell back to the only key it recognised — the HTTP
 * status. "Status: 200" on the row where somebody switched a customer's portal off.
 *
 * A handler that writes its own entry still wins (see `scope.logged`); this is only for the rows
 * nothing else describes. The verb comes from the last path segment, which in REST is where these
 * actions live and is exactly what the person clicked.
 */
const VERB_PHRASE: Record<string, string> = {
  enable: 'Switched on', disable: 'Switched off',
  activate: 'Activated', deactivate: 'Deactivated',
  approve: 'Approved', reject: 'Rejected', submit: 'Submitted', review: 'Reviewed',
  complete: 'Completed', cancel: 'Cancelled', void: 'Voided',
  dismiss: 'Dismissed', archive: 'Archived', restore: 'Restored', supersede: 'Superseded',
  close: 'Closed', reopen: 'Reopened', publish: 'Published', sign: 'Signed', file: 'Filed',
  'mark-paid': 'Marked paid', status: 'Status changed',
  payments: 'Payment recorded', payment: 'Payment recorded', pay: 'Payment recorded',
  refund: 'Refund recorded', refunds: 'Refund recorded', credit: 'Credit recorded', credits: 'Credit recorded',
  send: 'Sent', resend: 'Sent again', export: 'Exported',
  convert: 'Converted', assign: 'Assigned', reschedule: 'Rescheduled',
  duplicate: 'Duplicated', merge: 'Merged',
}
const PLAIN_FOR: Record<string, string> = { POST: 'Created', PUT: 'Updated', PATCH: 'Updated', DELETE: 'Deleted' }

export const describeRequest = (path: string, method: string, entity: string): string => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const last = (parts[parts.length - 1] || '').toLowerCase()
  const subject = entity.replace(/_/g, ' ')
  const phrase = VERB_PHRASE[last]
  // "Switched off — portal". Without a verb segment the HTTP method is the honest fallback, which
  // is a rough description rather than a wrong one.
  return `${phrase || PLAIN_FOR[method] || 'Changed'} — ${subject}`
}

export const actionFromPath = (path: string, method: string): string => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const last = (parts[parts.length - 1] || '').toLowerCase()
  if (ACTION_WORDS[last]) return ACTION_WORDS[last]
  if (STATUS_WORDS.includes(last)) return audit.ACTIONS?.STATUS_CHANGE || 'status_change'
  return ACTION_FOR[method] || 'update'
}

/**
 * The SINGULAR of a mount segment. (T58 follow-up)
 *
 * Owner: *"'Warranty' is spelled 'Warrantie'."* It was: the first version stripped a trailing "s",
 * so `warranties` became `warrantie`. English plurals are not one rule, and the handful this
 * vocabulary actually uses are:
 *
 *   warranties → warranty      -ies becomes -y
 *   addresses  → address       -sses keeps its stem, drop the -es
 *   taxes      → tax           -xes, -ches, -shes, -zes drop the -es
 *   status     → status        -us is already singular
 *   invoices   → invoice       the ordinary case
 */
const singular = (word: string): string => {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|ch|sh|x|z)es$/.test(word)) return word.replace(/es$/, '')
  if (/(us|ss|is)$/.test(word)) return word
  if (/s$/.test(word)) return word.replace(/s$/, '')
  return word
}

/**
 * The thing being changed, from the mount segment: /api/draw-schedules/… → draw_schedule.
 *
 * Singularised and underscored so it sits beside the entities handlers already write ('invoice',
 * 'change_order') and the audit screen's filter groups them together rather than offering
 * "draw-schedules" next to "draw_schedule".
 */
/**
 * WHICH RECORD CHANGED — the collection the id belongs to, not the first segment. (T58 follow-up)
 *
 * `PUT /api/company/users/:id` was filed as entity "company" with the USER's id in entity_id, so the
 * two columns described different things and the screen read a change to a person as a change to
 * company settings. Taking the segment the id actually sits under fixes both at once:
 *
 *   /api/company/users/:id        → user       (not company)
 *   /api/invoices/:id/payments    → invoice    (the id is the invoice's; the ACTION is the payment)
 *   /api/contacts/:id             → contact
 *   /api/contacts                 → contact    (no id, so the mount itself)
 */
export const entityFromPath = (path: string): string => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const id = idFromPath(path)
  const at = id ? parts.indexOf(id) : -1
  const seg = (at > 0 ? parts[at - 1] : parts[0]) || 'request'
  return singular(seg).replace(/-/g, '_')
}

/**
 * The record it happened to, when the URL names one. `/api/jobs/abc123` → abc123;
 * `/api/bulk/jobs/status` → none, because `status` is a verb here, not an id.
 *
 * Only a segment that looks like an id is taken. Guessing wrong would put a word in entity_id and
 * make the per-record history page show an action against a record that does not exist.
 */
const idFromPath = (path: string): string | undefined => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 1; i--) {
    const p = parts[i]
    // a uuid, or the cuid2-ish ids this codebase generates
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return p
    if (/^[a-z0-9]{20,32}$/i.test(p) && /\d/.test(p)) return p
  }
  return undefined
}

/**
 * WHICH RECORD IT WAS. (T58j)
 *
 *   Owner: "quote-create audit rows show 'Quote' instead of the quote number."
 *
 * Verified on ctrtest: every row this floor writes had `entity_name: null`, so the screen's Record
 * column fell back to the humanised entity — "Quote", "Contact", "Invoice" — on 46 of 200 rows. A log
 * that cannot say WHICH quote was created is not much of a log, and the owner reported it against
 * quotes because that is where they happened to look.
 *
 * The name is read from the response the handler already sent. That is the only place the floor can
 * learn it: a middleware knows the path and the status, and a create's identifier exists only in its
 * reply. The alternative — threading an audit hook through the shared quotes, invoices and contacts
 * modules and every template's glue — is a far larger change for one column, and none of those
 * modules audits anything today.
 *
 * Guarded, because this runs after every successful write:
 *   - JSON only, so a PDF, a CSV export or a redirect is never parsed.
 *   - A declared length over 64KB is a list or a report, not one record; skipped.
 *   - `clone()` so the response the client is receiving is untouched.
 *   - An array is not a record, and `{ data: {...} }` is unwrapped because both shapes are in use.
 *   - Any throw returns undefined. The row is still written, just without the name — the floor may
 *     never be the reason a request looks like it failed.
 */
const nameFromResponse = async (c: Context): Promise<string | undefined> => {
  try {
    if (!(c.res.headers.get('content-type') || '').includes('application/json')) return undefined
    if (Number(c.res.headers.get('content-length') || '0') > 64_000) return undefined
    const body = (await c.res.clone().json()) as any
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
    const rec = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body
    // `number` first: a quote, invoice or change order is known by it, and a name would be the client's.
    for (const k of ['number', 'name', 'title', 'email']) {
      const v = rec[k]
      if (typeof v === 'number' && Number.isFinite(v)) return String(v)
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120)
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * WHAT WAS DELETED. (T59)
 *
 *   Owner: "Delete rows in the audit log still don't name what was deleted."
 *
 * They could not: the name is read from the response, and a DELETE answers 204 with no body — and by
 * then the row is gone, so there is nothing left to read it from. Measured on ctrtest after T58k: every
 * project and change-order delete read "Deleted — change order" with entity_name null.
 *
 * So for a DELETE the floor reads the record BEFORE the handler runs: the table is the one the path
 * names (entityFromPath → its export in db/schema.ts, e.g. change_order → changeOrder), the row is the
 * id in the URL, and the name is the same `number` / `name` / `title` / `email` the response reader
 * prefers. This is a rule for every delete the floor records, not a patch to the two the owner saw.
 *
 * Guarded like the rest of this file: a path that names no table, a table with no such column, or a
 * row that is not there gives undefined, and any throw does too — the delete itself is untouched. The
 * company is checked after the handler (the user is not known until auth has run), so a row is only
 * ever named to the company it belongs to.
 */
const recordBeforeDelete = async (path: string): Promise<{ name: string; companyId?: string } | undefined> => {
  try {
    const id = idFromPath(path)
    if (!id) return undefined
    const key = entityFromPath(path).replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase())
    const table: any = (schema as any)[key]
    if (!table || !table.id) return undefined
    const col = ['number', 'name', 'title', 'email'].find((k) => table[k])
    if (!col) return undefined
    const [row] = await db.select({ v: table[col], companyId: table.companyId ?? table.id }).from(table).where(eq(table.id, id)).limit(1)
    const v = row?.v
    const name = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : ''
    return name ? { name, companyId: table.companyId ? row.companyId : undefined } : undefined
  } catch {
    return undefined
  }
}

export async function auditWrites(c: Context, next: Next) {
  const deleting = c.req.method.toUpperCase() === 'DELETE'
  const before = deleting && !SKIP.some((re) => re.test(new URL(c.req.url).pathname))
    ? await recordBeforeDelete(new URL(c.req.url).pathname)
    : undefined

  /**
   * The request runs inside a scope any audit.log can mark, whatever it was handed. (T58 follow-up)
   *
   * A handler that writes its own entry — with the amount, the old and new status, the field diff —
   * must not get a second, duller row beside it. The owner saw every payment and every settings
   * change logged twice, and that is the floor writing over work already done properly.
   */
  const scope = { logged: false }
  await requestAudit.run(scope, next)

  try {
    const method = c.req.method.toUpperCase()
    if (!MUTATING.has(method)) return
    const path = new URL(c.req.url).pathname
    if (SKIP.some((re) => re.test(path))) return
    // Already recorded, and better than this would. The floor is a floor, not a second opinion.
    if (scope.logged) return
    // Only what actually happened. A refused write is the gate doing its job, not a change to record —
    // and 401/403/404 would otherwise fill the log with noise from scanners and stale tabs.
    const status = c.res.status
    if (status < 200 || status >= 300) return

    const user = c.get('user') as any
    // No actor, no company: audit_log.company_id is NOT NULL, so there is nothing to write against.
    if (!user?.companyId) return

    const entity = entityFromPath(path)
    await audit.log({
      action: actionFromPath(path, method),
      entity,
      entityId: idFromPath(path),
      entityName: (await nameFromResponse(c))
        ?? (before && (!before.companyId || before.companyId === user.companyId) ? before.name : undefined),
      // `description` is what the screen reads first, so the row says what happened in words rather
      // than leaving the reader to infer it from an HTTP status. (T58c)
      metadata: { description: describeRequest(path, method, entity), method, path, status, via: 'request' },
      companyId: user.companyId,
      /**
       * THE FLOOR'S ROWS HAD NO IP. (T58j)
       *
       *   Owner: "request-level audit rows have no IP."
       *
       * They could not have had one. This passed `{ user }` — a bare object — and resolveActor()
       * reads the address from the request it is given: `req.req.header(…)` for a Hono context,
       * `req.header(…)` for anything else, `req.headers[…]` for Express. A plain object answers
       * none of those, so the actor resolved with a name and a null address on every row the floor
       * wrote, which is most of them. Handing it the header reader satisfies the second branch
       * without passing the whole context, so the body — passwords, resets, provider secrets —
       * still cannot be reached from in here.
       */
      req: { user, header: (name: string) => c.req.header(name) },
    } as any)
  } catch (err: any) {
    // The response has already gone. Never let the log break the thing it is recording.
    console.warn('[auditWrites] not recorded:', err?.message || err)
  }
}

export default auditWrites
