// Small pieces the hr routers share. Nothing here reads anything but the session and the company's own rows.
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { seatRefusal } from '@twomiah/tenant-backend'
import { company, user } from '../../../db/schema/index.ts'
import { listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

/** The signed-in person. */
export const me = (c: Context) => c.get('user' as never) as any

/** The signed-in person's company. */
export const companyOf = (c: Context): string => me(c).companyId

/** The path's :id (typed loosely after an untyped guard such as requireAdminOrSelf). */
export const idOf = (c: Context): string => c.req.param('id') ?? ''

/** A whole list (no paging in the template) as the rulebook's list reply: one page holding every row. */
export const all = <T>(c: Context, rows: T[]) => listAll(c, rows)

/** The request body as an object; a missing or broken body is {} (as the template's `.catch(() => ({}))`). */
export const body = async (c: Context): Promise<any> => {
  const b = await c.req.json().catch(() => ({}))
  return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
}

/** YYYY-MM-DD, or null. */
export const dayOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** The client's address, from the proxy's header (the template's clientIp). */
export const clientIp = (c: Context) => (c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '').split(',')[0].trim() || null

/** Is this person, by id, one of the company's logins? Their id, or null. */
export async function personInCompany(d: CrmDeps, companyId: string, id: string): Promise<string | null> {
  const [row] = await d.db.select({ id: user.id }).from(user).where(and(eq(user.id, id), eq(user.companyId, companyId))).limit(1)
  return row?.id ?? null
}

/** Does this person hold `permission` (their role's, plus what the owner granted them by name)? */
export async function holds(d: CrmDeps, c: Context, permission: string): Promise<boolean> {
  const u = me(c)
  if (!u?.role) return false
  return d.permissions.hasPermission(u.role, permission, await d.permissions.getExtraPermissions(u.userId))
}

/**
 * A new active login (a caregiver, a hire, an office admin), held to the plan's seats — the rule the team screen
 * applies (packages/tenant-backend company/seats.ts). The template made caregivers without it, so a plan's seat count
 * held on the team screen and nowhere else. The count and the insert run under a lock on the company row.
 */
export async function insertSeatedUser(d: CrmDeps, companyId: string, values: Record<string, unknown>, returning?: Record<string, any>): Promise<{ refusal: string } | { row: any }> {
  return d.db.transaction(async (tx: any) => {
    const [co] = await tx.select().from(company).where(eq(company.id, companyId)).limit(1).for('update')
    const full = await seatRefusal(tx, { company, user }, co)
    if (full) return { refusal: full.error }
    const [row] = await tx.insert(user).values({ ...values, companyId } as any).returning(returning as any)
    return { row }
  })
}
