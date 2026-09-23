/**
 * Audit Logging Service (Drizzle)
 * Tracks who changed what when
 */

import { db } from '../../db/index.ts';
import { sql } from 'drizzle-orm';
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
    ip: req?.ip || header('x-forwarded-for'),
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
  return `${verb} ${what}${name}${transition}`.replace(/\s+/g, ' ').trim()
}

export function presentLog(row: any): any {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  // both spellings stay on the row: older callers read snake_case, the page reads camelCase
  Object.assign(out, row)
  out.description = describeLog(row)
  return out
}

export async function query({
  companyId,
  entity,
  entityId,
  action,
  userId,
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
  if (startDate) conditions.push(sql`created_at >= ${new Date(startDate)}`);
  if (endDate)   conditions.push(sql`created_at <= ${new Date(endDate)}`);

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

export default { log, diff, query, getHistory, ACTIONS, ENTITIES };
