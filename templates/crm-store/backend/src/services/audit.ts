/**
 * AUDIT LOG — who did what, when. (Store manager pass, T3)
 *
 * A manager here can refund an order, cancel one, hand out a discount code and recount the stock. Shops that give a
 * seat those powers keep a record of who used them, so an odd refund or a 100%-off code can be traced to a person.
 * The store had none; the rest of the fleet has had one since T32. This is the fleet's service (crm-salon's
 * services/audit.ts) for a database that is one business: no company_id anywhere, so none is asked for.
 *
 * Two layers, as everywhere else:
 *   · the FLOOR (middleware/writeAudit.ts → packages/tenant-backend/src/audit/writeFloor.ts) writes one plain row
 *     for every successful write: who, what record, which verb;
 *   · the money and access events write their OWN row here — what the order went from and to, the code's value,
 *     the stock count before and after — which replaces the floor's row for that request.
 * Never the request body: it carries passwords, provider keys and customer details.
 * An audit row must never be the reason a write fails: every insert is caught.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { sql, desc, and, eq, gte, lte, type SQL } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { auditLog, storeSettings } from '../../db/schema.ts'

/** The live request, for the length of the request (opened in index.ts). log() marks it so the floor stands aside. */
export const requestScope = new AsyncLocalStorage<{ c: any; logged?: boolean }>()

interface AuditLogInput {
  action: string
  entity: string
  entityId?: string | null
  entityName?: string | null
  changes?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  /** The Hono context. Optional: the request in scope is used when it is not passed. */
  req?: any
  /** For events with no signed-in user (a failed sign-in): who it was about. */
  actor?: { userId?: string | null; email?: string | null }
}

/** The client's address as the first proxy saw it (left-most x-forwarded-for), as the fleet records it. (T41) */
function clientIp(header: (name: string) => string | null): string | null {
  const direct = header('cf-connecting-ip') || header('x-real-ip')
  if (direct && direct.trim()) return direct.trim()
  const first = header('x-forwarded-for')?.split(',')[0]?.trim()
  return first || null
}

function resolveActor(req: any) {
  const c = req ?? requestScope.getStore()?.c
  const user = typeof c?.get === 'function' ? c.get('user') : undefined
  const header = (name: string): string | null => {
    try { return (typeof c?.req?.header === 'function' ? c.req.header(name) : null) || null } catch { return null }
  }
  return { userId: user?.userId ?? null, email: user?.email ?? null, ip: clientIp(header), userAgent: header('user-agent') }
}

export async function log({ action, entity, entityId, entityName, changes, metadata, req, actor }: AuditLogInput): Promise<void> {
  const scope = requestScope.getStore()
  if (scope) scope.logged = true
  try {
    const who = resolveActor(req)
    await db.insert(auditLog).values({
      action, entity,
      entityId: entityId ?? null,
      entityName: entityName ?? null,
      changes: changes ?? null,
      metadata: metadata ?? null,
      userId: who.userId ?? actor?.userId ?? null,
      userName: who.email ?? actor?.email ?? null,
      userEmail: who.email ?? actor?.email ?? null,
      ipAddress: who.ip,
      userAgent: who.userAgent,
    })
  } catch (error: unknown) {
    console.error('Audit log error:', (error as Error).message)
  }
}

/**
 * This request changed nothing, so it leaves no row — not even the floor's. (Live, 10/12: a second Refund press on an
 * order already refunded answered 200 as a no-op, and the floor logged it as another 'Status changed', so the log read
 * like two refunds of one order.)
 */
export function nothingToRecord(): void {
  const scope = requestScope.getStore()
  if (scope) scope.logged = true
}

/** { field: { old, new } } for the keys that changed — never secrets or bookkeeping columns. */
export function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, keys?: string[]) {
  if (!before || !after) return null
  const skip = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'refreshToken', 'resetToken', 'resetTokenExp', 'credentialsEnc'])
  const out: Record<string, { old: unknown; new: unknown }> = {}
  for (const k of keys ?? Object.keys(after)) {
    if (skip.has(k)) continue
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { old: before[k] ?? null, new: after[k] ?? null }
  }
  return Object.keys(out).length ? out : null
}

/** The store's currency, for money written into a row's sentence (lib/money.ts formatCents, with its separators). */
export async function storeCurrency(): Promise<string> {
  try { return (await db.select({ currency: storeSettings.currency }).from(storeSettings).limit(1))[0]?.currency || 'usd' } catch { return 'usd' }
}

export async function query(f: { entity?: string; entityId?: string; action?: string; userId?: string; startDate?: string; endDate?: string; page?: number; limit?: number }) {
  const page = Math.max(1, Number.isFinite(f.page) ? Number(f.page) : 1)
  const limit = Math.min(200, Math.max(1, Number.isFinite(f.limit) ? Number(f.limit) : 50))
  const where: SQL[] = []
  if (f.entity) where.push(eq(auditLog.entity, f.entity))
  if (f.entityId) where.push(eq(auditLog.entityId, f.entityId))
  if (f.action) where.push(eq(auditLog.action, f.action))
  if (f.userId) where.push(eq(auditLog.userId, f.userId))
  const from = f.startDate ? new Date(f.startDate) : null
  const to = f.endDate ? new Date(f.endDate) : null
  if (from && !Number.isNaN(from.getTime())) where.push(gte(auditLog.createdAt, from))
  // A bare date for "to" means the whole of that day, not its first instant.
  if (to && !Number.isNaN(to.getTime())) where.push(lte(auditLog.createdAt, /^\d{4}-\d{2}-\d{2}$/.test(f.endDate!) ? new Date(to.getTime() + 86_400_000 - 1) : to))
  const cond = where.length ? and(...where) : undefined
  const data = await db.select().from(auditLog).where(cond).orderBy(desc(auditLog.createdAt)).limit(limit).offset((page - 1) * limit)
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(cond)
  return { data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } }
}

export async function getHistory(entity: string, entityId: string) {
  return db.select().from(auditLog).where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId))).orderBy(desc(auditLog.createdAt)).limit(100)
}

/** What this log can be filtered BY — the actions and record types in its own rows, most-used first. (T51) */
export async function filterOptions() {
  const rows = await db.select({ action: auditLog.action, entity: auditLog.entity, n: sql<number>`count(*)::int` })
    .from(auditLog).groupBy(auditLog.action, auditLog.entity)
  const tally = (key: 'action' | 'entity') => {
    const counts = new Map<string, number>()
    for (const r of rows) if (r[key]) counts.set(r[key], (counts.get(r[key]) || 0) + Number(r.n || 0))
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }))
  }
  return { actions: tally('action'), entities: tally('entity') }
}

export default { log, diff, query, getHistory, filterOptions, storeCurrency, nothingToRecord }
