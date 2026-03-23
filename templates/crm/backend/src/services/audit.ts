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
  req?: {
    user?: { userId?: string; email?: string; companyId?: string };
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
  };
}

/**
 * Create audit log entry
 */
export async function log({ action, entity, entityId, entityName, changes, metadata, req }: AuditLogInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action,
      entity,
      entityId: entityId || null,
      entityName: entityName || null,
      changes: changes || null,
      metadata: metadata || null,
      userId: req?.user?.userId || null,
      userName: req?.user?.email || null,
      userEmail: req?.user?.email || null,
      companyId: req?.user?.companyId || '',
      ipAddress: (req?.ip || req?.headers?.['x-forwarded-for']) as string || null,
      userAgent: req?.headers?.['user-agent'] as string || null,
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
