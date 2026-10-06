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
import audit from '../services/audit.ts'

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

/** POST → create, DELETE → delete, PUT/PATCH → update. The log's own vocabulary. */
const ACTION_FOR: Record<string, string> = {
  POST: audit.ACTIONS?.CREATE || 'create',
  PUT: audit.ACTIONS?.UPDATE || 'update',
  PATCH: audit.ACTIONS?.UPDATE || 'update',
  DELETE: audit.ACTIONS?.DELETE || 'delete',
}

/**
 * The thing being changed, from the mount segment: /api/draw-schedules/… → draw_schedule.
 *
 * Singularised and underscored so it sits beside the entities handlers already write ('invoice',
 * 'change_order') and the audit screen's filter groups them together rather than offering
 * "draw-schedules" next to "draw_schedule".
 */
const entityFromPath = (path: string): string => {
  const seg = path.replace(/^\/api\//, '').split('/')[0] || 'request'
  const base = seg.replace(/-/g, '_')
  // crude but right for this vocabulary: strip a trailing plural 's', keep 'address'/'status' intact
  return /(ss|us|s_s)$/.test(base) ? base : base.replace(/s$/, '')
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

export async function auditWrites(c: Context, next: Next) {
  await next()

  try {
    const method = c.req.method.toUpperCase()
    if (!MUTATING.has(method)) return
    const path = new URL(c.req.url).pathname
    if (SKIP.some((re) => re.test(path))) return
    // Only what actually happened. A refused write is the gate doing its job, not a change to record —
    // and 401/403/404 would otherwise fill the log with noise from scanners and stale tabs.
    const status = c.res.status
    if (status < 200 || status >= 300) return

    const user = c.get('user') as any
    // No actor, no company: audit_log.company_id is NOT NULL, so there is nothing to write against.
    if (!user?.companyId) return

    await audit.log({
      action: ACTION_FOR[method] || 'update',
      entity: entityFromPath(path),
      entityId: idFromPath(path),
      metadata: { method, path, status, via: 'request' },
      companyId: user.companyId,
      req: { user },
    } as any)
  } catch (err: any) {
    // The response has already gone. Never let the log break the thing it is recording.
    console.warn('[auditWrites] not recorded:', err?.message || err)
  }
}

export default auditWrites
