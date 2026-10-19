// Discount / promo codes at /api/admin/discounts. Moved from templates/crm-store/backend/src/routes/discounts.ts.
// Validation and application happen server-side at checkout (the checkout group); usage is counted when an order is
// paid.
//
// Kept as the template had it: the permissions (discounts:read for everyone who may see the codes — staff answer a
// shopper with them; writing one is giving money away, discounts:create / update / delete, the manager's); a code is
// letters, digits, hyphens and underscores, trimmed and stored upper case (Store QA T1 L2); a percent code is at most
// 100, on the create and on an edit — including an edit that changes only the type (a $5.00 code is not 500%); a code's
// name is unique, on the create and on a rename; the audit rows in words ('Code SPRING15 created — 15% off', the
// edit's changes, 'Code FIVER deleted — it was $5.00 off, used 0 times').
//
// Changes from the template:
//   · every code is the company's (company_id; the unique index is per company);
//   · replies (RULEBOOK §3): the list is { data, pagination } (was { codes }); a code is the record (was { code });
//     a delete is { success: true } (was { ok: true }); a validation failure names each box, the sentence leading with
//     the first problem's field (was the first message alone, with zod's flatten() as `details`);
//   · deleting a code that is not there is a 404 (the template answered ok: true having deleted nothing).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { discountCode } from '../../../db/schema/store.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import { changedKeys } from './audit.ts'

/**
 * A CODE IS SOMETHING A SHOPPER TYPES. (Store QA T1, L2: 'POST discount "T1 SP ACE" returned 201; unlikely to be
 * enterable at checkout.') Letters, digits, hyphens and underscores — what fits on a flyer and survives being read
 * out over the phone. Checkout uppercases what it is given, so the case is not the shopper's problem; a space inside
 * the code is.
 */
const CODE_SHAPE = /^[A-Z0-9_-]+$/
const codeField = z.string().trim().min(1).max(64).transform((v) => v.toUpperCase())
  .refine((v) => CODE_SHAPE.test(v), { message: 'A code is letters, numbers, hyphens or underscores — no spaces or symbols' })

const codeSchema = z.object({
  code: codeField,
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  active: z.boolean().optional(),
  minSubtotalCents: z.number().int().nonnegative().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

/** What a code gives away, in the audit log's words: '15% off', '$5.00 off'. value is a whole percent or cents. */
const worth = (d: { type: string; value: number }, currency: string) => d.type === 'percent' ? `${d.value}% off` : `${formatCents(d.value, currency)} off`

export function createDiscountRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Staff can read the codes to answer a shopper; writing one is giving money away, so it is the manager's.
  app.use('*', requirePermission('discounts:read'))

  const currency = async (companyId: string) => (await core.settings(companyId)).currency || 'usd'
  const named = async (companyId: string, code: string) =>
    (await db.select({ id: discountCode.id }).from(discountCode).where(and(eq(discountCode.companyId, companyId), eq(discountCode.code, code))).limit(1))[0]

  app.get('/', async (c) => {
    const u = c.get('user')
    const codes = await db.select().from(discountCode).where(eq(discountCode.companyId, u.companyId)).orderBy(desc(discountCode.createdAt))
    return list(c, codes, { page: 1, limit: Math.max(codes.length, 1), total: codes.length })
  })

  app.post('/', requirePermission('discounts:create'), async (c) => {
    const u = c.get('user')
    const parsed = codeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data
    if (v.type === 'percent' && v.value > 100) return fail(c, 400, 'A percent discount cannot exceed 100')
    if (await named(u.companyId, v.code)) return fail(c, 409, 'That code already exists')
    const [created] = await db.insert(discountCode).values({
      companyId: u.companyId, code: v.code, type: v.type, value: v.value,
      active: v.active ?? true,
      minSubtotalCents: v.minSubtotalCents ?? 0,
      maxUses: v.maxUses ?? null,
      expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
    }).returning()
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'discount_code', entityId: created.id, entityName: created.code, metadata: { description: `Code ${created.code} created — ${worth(created, await currency(u.companyId))}` }, req: c })
    return one(c, created, 201)
  })

  app.patch('/:id', requirePermission('discounts:update'), async (c) => {
    const u = c.get('user')
    const parsed = codeSchema.partial().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const mine = and(eq(discountCode.id, c.req.param('id')), eq(discountCode.companyId, u.companyId))
    const [current] = await db.select().from(discountCode).where(mine).limit(1)
    if (!current) return fail(c, 404, 'Not found')
    // The create route's rules hold on an edit too. It checked none of them: a 10% code could be edited to 500%, and
    // renamed onto another code's name — and checkout takes whichever row it finds first.
    const type = parsed.data.type ?? current.type
    const value = parsed.data.value ?? current.value
    if (type === 'percent' && value > 100) return fail(c, 400, 'A percent discount cannot exceed 100')
    if (parsed.data.code && parsed.data.code !== current.code && (await named(u.companyId, parsed.data.code))) return fail(c, 409, 'That code already exists')
    const patch: Record<string, unknown> = { ...parsed.data }
    if (parsed.data.expiresAt !== undefined) patch.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
    const [updated] = await db.update(discountCode).set(patch).where(mine).returning()
    if (!updated) return fail(c, 404, 'Not found')
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'discount_code', entityId: updated.id, entityName: updated.code, changes: changedKeys(current, updated), req: c })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('discounts:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(discountCode).where(and(eq(discountCode.id, c.req.param('id')), eq(discountCode.companyId, u.companyId))).returning()
    if (!gone) return fail(c, 404, 'Not found')
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'discount_code', entityId: gone.id, entityName: gone.code, metadata: { description: `Code ${gone.code} deleted — it was ${worth(gone, await currency(u.companyId))}, used ${gone.usedCount} time${gone.usedCount === 1 ? '' : 's'}` }, req: c })
    return done(c)
  })

  return app
}
