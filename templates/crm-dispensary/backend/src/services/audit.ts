/**
 * Audit Logging Service (Drizzle)
 * Tracks who changed what when
 */

import { db } from '../../db/index.ts';
import { sql } from 'drizzle-orm';
import { asInstant } from '../shared/instants.ts';
import { auditLog } from '../../db/schema.ts';

export const ACTIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGE: 'password_change',
  STATUS_CHANGE: 'status_change',
  SEND: 'send',
  PAYMENT: 'payment',
  ROLE_CHANGE: 'role_change',
  EXPORT: 'export',
} as const;

export const ENTITIES = {
  USER: 'user',
  CONTACT: 'contact',
  PROJECT: 'project',
  JOB: 'job',
  QUOTE: 'quote',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  TIME_ENTRY: 'time_entry',
  EXPENSE: 'expense',
  DOCUMENT: 'document',
  RFI: 'rfi',
  CHANGE_ORDER: 'change_order',
  TEAM_MEMBER: 'team_member',
  COMPANY: 'company',
} as const;

interface AuditLogInput {
  action: string;
  entity: string;
  entityId?: string;
  entityName?: string;
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  /**
   * The Hono CONTEXT (`c`) — the signed-in user lives on the context, not on the request. A plain
   * `{ user }` is accepted too, for the few callers that have a user but no context. (Dispensary T20)
   */
  req?: any;
}

/**
 * Create audit log entry
 */
/**
 * The originating client address from a proxied request, or null.
 *
 * The left-most x-forwarded-for entry is what the first proxy saw. It is also the one a client can
 * claim for itself — which is a limit of the header, not of this function: an audit row records
 * what was reported, and the alternative (storing the whole chain) made the column useless for the
 * thing it exists for. (T41)
 */
function clientIp(req: any, header: (name: string) => string | null): string | null {
  const direct = header('cf-connecting-ip') || header('x-real-ip')
  if (direct && String(direct).trim()) return String(direct).trim()
  const fwd = header('x-forwarded-for')
  if (fwd) {
    const first = String(fwd).split(',')[0]?.trim()
    if (first) return first
  }
  const own = req?.ip
  return own ? String(own).split(',')[0].trim() : null
}

/**
 * Who did it, from whatever the caller handed over.
 *
 * Nearly every route passed the Hono REQUEST (`c.req`) while this service read req.user.*. Hono keeps
 * the signed-in user on the CONTEXT, not the request, so user, email and company all came out null and the
 * insert then failed the company_id NOT NULL: the action was never recorded at all. Accept the context (what
 * callers now pass), the plain { user } shape, and a bare request, so no caller can quietly write nothing.
 * (Dispensary T20)
 */
function resolveActor(req: any): { userId: string | null; email: string | null; companyId: string | null; ip: string | null; userAgent: string | null } {
  const user = typeof req?.get === 'function' ? req.get('user') : req?.user
  const header = (name: string): string | null => {
    const h = typeof req?.req?.header === 'function' ? req.req.header(name) : typeof req?.header === 'function' ? req.header(name) : req?.headers?.[name]
    return (h as string) || null
  }
  return {
    userId: user?.userId || user?.id || null,
    email: user?.email || null,
    companyId: user?.companyId || null,
    /**
     * THE CLIENT'S ADDRESS, NOT THE WHOLE CHAIN. (T41)
     *
     *   dispensary: "the audit log's IP column shows the proxy chain"
     *
     * Behind Render's edge, x-forwarded-for is "client, hop, hop" — so every audit row read
     * "203.0.113.9, 10.214.3.4" and sometimes a third hop that varies per request. Nobody can match
     * that against a till, and two events from the same person did not even look the same.
     *
     * Left-most entry, trimmed, which is the client as reported by the first proxy and what the
     * rest of the fleet already uses (packages/tenant-backend/src/portal/portal.ts signerIp,
     * crm-roof's rate limiter, the Factory's shared helper). cf-connecting-ip and x-real-ip are
     * single-value headers, so they are taken as they are.
     */
    ip: clientIp(req, header),
    userAgent: header('user-agent'),
  }
}

export async function log({ action, entity, entityId, entityName, changes, metadata, req }: AuditLogInput): Promise<void> {
  try {
    const actor = resolveActor(req)
    // No company means no row: the column is NOT NULL, so this would throw and be swallowed below. Say so
    // once, loudly, rather than losing the event in silence.
    if (!actor.companyId) {
      console.error(`Audit log skipped (no company on the actor): ${action} ${entity}`)
      return
    }
    await db.insert(auditLog).values({
      action,
      entity,
      // T46 L-i: the table carries BOTH `entity` and `entity_type`, and only `entity` was ever
      // written — so the Audit Log screen's "filter by type" dropdown, which reads entity_type,
      // returned nothing for every value in it. One fact, two columns, one of them always null.
      // Written together so neither the filter nor anything reading the older name can be wrong.
      entityType: entity,
      entityId: entityId || null,
      entityName: entityName || null,
      changes: changes || null,
      metadata: metadata || null,
      userId: actor.userId,
      userName: actor.email,
      userEmail: actor.email,
      companyId: actor.companyId,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
  } catch (error: unknown) {
    console.error('Audit log error:', (error as Error).message);
  }
}

/**
 * Calculate diff between old and new objects
 */
export function diff(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): Record<string, { old: unknown; new: unknown }> | null {
  if (!oldData || !newData) return null;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const skipFields = ['id', 'createdAt', 'updatedAt', 'companyId', 'passwordHash', 'refreshToken', 'resetToken'];

  for (const key of Object.keys(newData)) {
    if (skipFields.includes(key)) continue;

    const oldVal = JSON.stringify(oldData[key] ?? null);
    const newVal = JSON.stringify(newData[key] ?? null);

    if (oldVal !== newVal) {
      changes[key] = { old: oldData[key] ?? null, new: newData[key] ?? null };
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Query audit logs
 */
/**
 * A log row as the Audit Log page reads it.
 *
 * The rows come back from raw SQL in snake_case and were returned exactly as they came, while the page reads
 * log.createdAt, log.userName / log.userEmail and log.description — so every one of 262 events rendered with
 * an em-dash for its time, "System" for its user and an em-dash for what happened. The data was all there.
 * (Dispensary T20 H — same class as the camel() note in kiosk.ts and cash.ts.)
 *
 * `description` is composed here because no column holds one: the row knows the action, the kind of thing and
 * often its name, which is the sentence a person wants to read.
 */
const ACTION_WORDS: Record<string, string> = {
  create: 'Created', update: 'Updated', delete: 'Deleted', login: 'Signed in', logout: 'Signed out',
  refund: 'Refunded', void: 'Voided', complete: 'Completed', export: 'Exported', status_change: 'Changed the status of',
}
const readable = (s: unknown) => String(s || '').replace(/_/g, ' ').trim()

/** The recorded before/after for one field, if the row carries it. `changes` is json or a json string. */
function changeOf(row: any, field: string): { old?: unknown; new?: unknown } | null {
  let changes = row?.changes
  if (typeof changes === 'string') { try { changes = JSON.parse(changes) } catch { return null } }
  const hit = changes && typeof changes === 'object' ? (changes as any)[field] : null
  return hit && typeof hit === 'object' ? hit : null
}

export function describeLog(row: any): string {
  if (row?.details) return String(row.details)
  const what = readable(row?.entity || row?.entity_type) || 'record'
  const verb = ACTION_WORDS[String(row?.action || '').toLowerCase()] || (readable(row?.action) ? readable(row.action).replace(/^./, (ch) => ch.toUpperCase()) : 'Changed')
  const name = row?.entity_name ? ` "${row.entity_name}"` : ''
  // "Changed the status of order ORD-1173" tells a reader nothing they could not see from the row
  // itself — and status is the one field an audit log is read to reconstruct. The before/after has
  // always been recorded in `changes`; it simply was never said out loud. (Dispensary T29 L13)
  const status = changeOf(row, 'status')
  const transition = status && (status.old || status.new)
    ? ` from ${readable(status.old) || 'unset'} to ${readable(status.new) || 'unset'}`
    : ''
  // …and WHY, when somebody was made to say.
  //
  // T48 Q14: releasing a batch over a failed lab test demands a written reason, records it on the
  // batch AND passes it to the audit row's metadata — and the audit entry still read "Changed batch
  // T47-LAB-1 from quarantine to active". The reason was in the row the whole time; the sentence
  // built from that row simply never mentioned it, so the one place a regulator would look for it
  // showed a bare status flip. Every reason the product now insists on — a lifted recall, a
  // superseded filing, a lab release — says itself here.
  const why = reasonOf(row)
  const because = why ? ` — ${why}` : ''
  // An attempt that was REFUSED did not happen, and must not be described as though it did. (T56 S4)
  //
  // The refused date-of-birth change is recorded so an owner can see that somebody tried — and it
  // rendered as `Updated contact "T56 Age18"`, which says the opposite of what the row means. The
  // rule is general: any row whose metadata carries `refused` says so first, because every refusal
  // this product decides to keep will land here.
  const refusal = refusalOf(row)
  if (refusal) return `Refused: ${refusal} on ${what}${name}`.replace(/\s+/g, ' ').trim()
  return `${verb} ${what}${name}${transition}${because}`.replace(/\s+/g, ' ').trim()
}

/** The words for a refused attempt, when the row records one. */
const REFUSAL_WORDS: Record<string, string> = {
  dob_change_needs_manager: 'a date of birth change, which needs a manager',
}
function refusalOf(row: any): string | null {
  const raw = row?.metadata ?? row?.meta_data
  if (!raw) return null
  let meta: any = raw
  if (typeof raw === 'string') { try { meta = JSON.parse(raw) } catch { return null } }
  const code = meta && typeof meta === 'object' ? meta.refused : null
  if (!code) return null
  const what = REFUSAL_WORDS[String(code)] || readable(String(code)) || 'the change'
  const detail = meta.recorded || meta.attempted
    ? ` (on file ${meta.recorded || 'nothing'}, attempted ${meta.attempted || 'nothing'})`
    : ''
  return `${what}${detail}`
}

/** The reason an action was taken, when one was recorded. Stored in metadata, which arrives as an object or as JSON text depending on the driver. */
function reasonOf(row: any): string | null {
  const raw = row?.metadata ?? row?.meta_data
  if (!raw) return null
  let meta: any = raw
  if (typeof raw === 'string') { try { meta = JSON.parse(raw) } catch { return null } }
  const why = meta && typeof meta === 'object' ? meta.reason : null
  if (!why) return null
  const text = String(why).trim().replace(/\s+/g, ' ')
  if (!text) return null
  // A description is a line in a list, not the record itself — the full text stays in metadata.
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

export function presentLog(row: any): any {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  // both spellings stay on the row: older callers read snake_case, the page reads camelCase
  Object.assign(out, row)
  out.description = describeLog(row)
  /**
   * BOTH spellings leave with their zone. `created_at` is `timestamp` — no zone — so the driver hands
   * it back as the bare text Postgres printed, which `new Date()` then reads as LOCAL time. This row
   * deliberately carries the field twice, so fixing only one would hand the next reader a row whose
   * two timestamps disagree about what moment they describe. See shared/instants.ts for the report.
   */
  if ('created_at' in out) out.created_at = asInstant(out.created_at)
  if ('createdAt' in out) out.createdAt = asInstant(out.createdAt)
  return out
}

/**
 * The two date bounds, as conditions — shared by the list and the CSV export so they can never
 * disagree about which rows a date range contains.
 *
 * THE UPPER BOUND IS EXCLUSIVE AND A DAY LATER when the caller sends a bare date. The screen's
 * To field is an <input type="date">, so it sends '2026-10-03', which as a timestamp is that day at
 * 00:00 — and `created_at <= '2026-10-03 00:00'` excludes everything that happened on the 3rd.
 * Picking From = To = today therefore returned nothing at all, and picking any range silently
 * dropped its last day. (T41)
 *
 * Stated plainly: the boundary is UTC, because this service is not given the shop's timezone. For a
 * dispensary in a western timezone the last few hours of the final day land in the next UTC day and
 * fall outside the range. That is a smaller error than dropping the whole day, and it is the same
 * assumption the rest of this table already makes by storing bare `created_at`; narrowing it
 * further needs the company row, which belongs to a separate change.
 */
export function dateConditions(startDate?: string, endDate?: string) {
  const out: any[] = [];
  const bare = /^\d{4}-\d{2}-\d{2}$/;
  if (startDate) out.push(sql`created_at >= ${new Date(startDate)}`);
  if (endDate) {
    if (bare.test(endDate)) {
      const end = new Date(`${endDate}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      out.push(sql`created_at < ${end}`);
    } else {
      out.push(sql`created_at <= ${new Date(endDate)}`);
    }
  }
  return out;
}

/**
 * The search condition, or nothing. Shared for the same reason as the dates.
 *
 * Matches what a person can actually read on the row: the record's name, who did it, and the id.
 * %, _ and \ are escaped so a search for "50%" is a search for "50%", not for everything.
 */
export function searchCondition(search?: string) {
  if (!search || !search.trim()) return null;
  const like = `%${search.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  return sql`(
    COALESCE(entity_name, '') ILIKE ${like} ESCAPE '\\'
    OR COALESCE(user_name, '') ILIKE ${like} ESCAPE '\\'
    OR COALESCE(user_email, '') ILIKE ${like} ESCAPE '\\'
    OR COALESCE(entity_id, '') ILIKE ${like} ESCAPE '\\'
  )`;
}

export async function query({
  companyId,
  entity,
  entityId,
  action,
  userId,
  search,
  startDate,
  endDate,
  page = 1,
  limit = 50,
}: {
  companyId: string;
  entity?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}) {
  // Build conditions using sql tagged template (parameterised) instead of sql.raw
  const conditions = [sql`company_id = ${companyId}`];
  if (entity)    conditions.push(sql`entity = ${entity}`);
  if (entityId)  conditions.push(sql`entity_id = ${entityId}`);
  if (action)    conditions.push(sql`action = ${action}`);
  if (userId)    conditions.push(sql`user_id = ${userId}`);
  conditions.push(...dateConditions(startDate, endDate));
  // The Audit Log screen has always had a search box and this query had no `search` at all — so the
  // box was sent, dropped, and every keystroke returned the unfiltered log. A filter that is ignored
  // rather than refused looks exactly like an answer, which is the note already written above the
  // entity/entityType aliasing in routes/audit.ts. (T41)
  const searchCond = searchCondition(search);
  if (searchCond) conditions.push(searchCond);

  const where = conditions.reduce((acc, cond, i) => i === 0 ? cond : sql`${acc} AND ${cond}`);
  const offset = (page - 1) * limit;

  const dataResult = await db.execute(
    sql`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  );
  const countResult = await db.execute(
    sql`SELECT COUNT(*)::int as total FROM audit_log WHERE ${where}`
  );

  const data = ((dataResult as any).rows || dataResult).map(presentLog);
  const total = Number((countResult as any).rows?.[0]?.total || 0);

  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * What this company's log can actually be filtered BY — the distinct actions and record types
 * present in its own rows, most-used first.
 *
 * WHY THIS EXISTS. The Audit Log screen hard-coded its filter list as composite values —
 * 'order_created', 'product_updated', 'inventory_adjusted', fifteen of them. Nothing writes those:
 * the log stores `action` ('create', 'update', 'status_change', …) and `entity` ('order', 'product',
 * …) in two separate columns. So every single option in that dropdown matched zero rows, and
 * choosing any of them emptied the screen. T41 reported it as "filters return nothing".
 *
 * Correcting the hard-coded list by hand is how it was written in the first place, and the entity
 * vocabulary is ~110 values that grows with every module. So the screen now asks what is there.
 * A filter built from the data cannot disagree with the data.
 */
export async function filterOptions(companyId: string) {
  const result = await db.execute(sql`
    SELECT action, entity, COUNT(*)::int AS n
    FROM audit_log
    WHERE company_id = ${companyId}
    GROUP BY action, entity
  `);
  const rows = ((result as any).rows || result) as any[];

  const tally = (key: 'action' | 'entity') => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[key];
      if (!v) continue;
      counts.set(String(v), (counts.get(String(v)) || 0) + Number(r.n || 0));
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, count }));
  };

  return { actions: tally('action'), entities: tally('entity') };
}

/**
 * Get history for specific entity
 */
export async function getHistory(companyId: string, entity: string, entityId: string) {
  const result = await db.execute(sql`
    SELECT * FROM audit_log
    WHERE company_id = ${companyId} AND entity = ${entity} AND entity_id = ${entityId}
    ORDER BY created_at DESC
    LIMIT 100
  `);
  // the same shape the list returns, so an entity's history is readable too
  return ((result as any).rows || result).map(presentLog);
}

export default { log, diff, query, filterOptions, getHistory, ACTIONS, ENTITIES };
