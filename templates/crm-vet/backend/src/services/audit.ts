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
  // Who did it: pass req (user + ip/user-agent), or the user's ids directly — inventory, recurring invoices, bulk, import
  // and migration pass userId/companyId, and without them company_id (NOT NULL) failed and the entry was lost.
  userId?: string;
  companyId?: string;
  /**
   * The Hono CONTEXT (`c`), which is where the signed-in user lives — `c.get('user')`.
   *
   * This used to be typed as `{ user, ip, headers }`, an Express request, and read as `req.user.*`.
   * A Hono request has no `.user` and neither does a Hono context, so every caller that handed this
   * `c.req` (or `c`) produced companyId null, the NOT NULL insert threw, and the catch below ate it.
   * Contact creates, updates, deletes and conversions recorded nothing at all. (T32)
   *
   * Still accepts a plain `{ user }` object so the callers that build one by hand keep working.
   */
  req?: any;
}

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
 * Work out who is acting from whatever the caller handed us: a Hono context, a Hono request, or a
 * plain object with a `user` on it. Deliberately duck-typed — the alternative is 50 call sites all
 * having to know which of the three they hold.
 */
function resolveActor(req: any): { userId: string | null; email: string | null; companyId: string | null; ip: string | null; userAgent: string | null } {
  const user = typeof req?.get === 'function' ? req.get('user') : req?.user;
  const header = (name: string): string | null => {
    const h = typeof req?.req?.header === 'function' ? req.req.header(name)
      : typeof req?.header === 'function' ? req.header(name)
      : req?.headers?.[name];
    return (h as string) || null;
  };
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
  };
}

/**
 * Create audit log entry
 */
export async function log({ action, entity, entityId, entityName, changes, metadata, userId, companyId, req }: AuditLogInput): Promise<void> {
  try {
    const actor = resolveActor(req);
    // The explicit userId/companyId arguments stay as the fallback, not the other way round: bulk,
    // export, import and migration pass them because they act for a user they looked up themselves.
    const forCompany = actor.companyId || companyId || null;
    // No company means no row — the column is NOT NULL, so the insert below would throw and be
    // swallowed. Say so once, loudly, instead of losing the event in silence.
    if (!forCompany) {
      console.error(`Audit log skipped (no company on the actor): ${action} ${entity}`);
      return;
    }
    await db.insert(auditLog).values({
      action,
      entity,
      entityId: entityId || null,
      entityName: entityName || null,
      changes: changes || null,
      metadata: metadata || null,
      userId: actor.userId || userId || null,
      userName: actor.email,
      userEmail: actor.email,
      companyId: forCompany,
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

  const data = (dataResult as any).rows || dataResult;
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
  return (result as any).rows || result;
}

export default { log, diff, query, getHistory, ACTIONS, ENTITIES };
