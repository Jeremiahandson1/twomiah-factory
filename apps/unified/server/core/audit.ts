// Who changed what, and when. The recording half of the audit service the eight newer CRM templates share
// (crm-bar, -basic, -fieldservice, -landscaping, -restaurant, -rv, -salon, -vet: services/audit.ts, one identical
// file), with the database handed in instead of imported. The read half (query, history, filter options) moves with
// the audit screen, through server/data/, so its rows reach the screen in camelCase (RULEBOOK §2).
import { AsyncLocalStorage } from 'node:async_hooks'
import { auditLog } from '../db/schema/index.ts'

/**
 * The live request, for the duration of the request. Opened by the first middleware in app.ts. resolveActor reads
 * it when a caller passes only a user, so a row written from a service function still records the client's
 * address; the shared write floor reads `logged` so a handler's own richer row isn't doubled by a plain one.
 */
export const requestScope = new AsyncLocalStorage<{ c: any; logged?: boolean }>()

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
} as const

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
} as const

export interface AuditLogInput {
  action: string
  entity: string
  entityId?: string | null
  entityName?: string | null
  changes?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  /** Who acted, when the caller looked them up itself (bulk, import, recurring jobs). */
  userId?: string | null
  companyId?: string | null
  /** The Hono context, or a plain `{ user }`. */
  req?: any
}

/** The originating client address: the left-most x-forwarded-for entry, or a single-value proxy header. */
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

/** Who is acting, from a Hono context, a Hono request or a plain `{ user }`; headers fall back to the live request. */
function resolveActor(req: any) {
  const user = typeof req?.get === 'function' ? req.get('user') : req?.user
  const header = (name: string): string | null => {
    const h = typeof req?.req?.header === 'function' ? req.req.header(name)
      : typeof req?.header === 'function' ? req.header(name)
      : req?.headers?.[name]
    if (h) return h as string
    const scoped: any = requestScope.getStore()?.c
    const fromScope = typeof scoped?.req?.header === 'function' ? scoped.req.header(name) : null
    return (fromScope as string) || null
  }
  // Inside a View As (core/viewAs.ts) the request carries the real user behind it; the row names both.
  const scoped: any = requestScope.getStore()?.c
  const viewAs = (typeof req?.get === 'function' ? req.get('viewAs') : null) || (typeof scoped?.get === 'function' ? scoped.get('viewAs') : null)
  return {
    userId: (user?.userId || user?.id || null) as string | null,
    email: (user?.email || null) as string | null,
    companyId: (user?.companyId || null) as string | null,
    ip: clientIp(req, header),
    userAgent: header('user-agent'),
    impersonatorId: (viewAs?.impersonatorId || null) as string | null,
    impersonatorEmail: (viewAs?.impersonatorEmail || null) as string | null,
  }
}

export function createAudit(deps: { db: any }) {
  const { db } = deps

  /** Record one event. Never throws: an audit row must never be the reason a write fails. */
  async function log({ action, entity, entityId, entityName, changes, metadata, userId, companyId, req }: AuditLogInput): Promise<void> {
    // Marked before the first await, so it lands inside the request's own async scope even when not awaited.
    const scope = requestScope.getStore()
    if (scope) scope.logged = true
    try {
      const actor = resolveActor(req)
      const forCompany = actor.companyId || companyId || null
      // company_id is NOT NULL: say so once instead of losing the event inside a swallowed insert error.
      if (!forCompany) {
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
        userId: actor.userId || userId || null,
        userName: actor.email,
        userEmail: actor.email,
        companyId: forCompany,
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
        impersonatorId: actor.impersonatorId,
        impersonatorEmail: actor.impersonatorEmail,
      })
    } catch (error: unknown) {
      console.error('Audit log error:', (error as Error).message)
    }
  }

  return { log, diff, ACTIONS, ENTITIES }
}

/** The fields that changed between two versions of a record; secrets and bookkeeping fields are left out. */
export function diff(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): Record<string, { old: unknown; new: unknown }> | null {
  if (!oldData || !newData) return null
  const changes: Record<string, { old: unknown; new: unknown }> = {}
  const skipFields = ['id', 'createdAt', 'updatedAt', 'companyId', 'passwordHash', 'refreshToken', 'resetToken']
  for (const key of Object.keys(newData)) {
    if (skipFields.includes(key)) continue
    if (JSON.stringify(oldData[key] ?? null) !== JSON.stringify(newData[key] ?? null)) {
      changes[key] = { old: oldData[key] ?? null, new: newData[key] ?? null }
    }
  }
  return Object.keys(changes).length > 0 ? changes : null
}

export type Audit = ReturnType<typeof createAudit>
