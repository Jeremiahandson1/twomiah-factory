import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { discountCodes } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

// Admin CRUD for discount / promo codes. Validation + application happens
// server-side at checkout (routes/public.ts); usage is counted on finalize.
const admin = new Hono()
// Staff can read the codes to answer a shopper; writing one is giving money away, so it is the manager's.
admin.use('*', authenticate, requirePermission('discounts:read'))

// The first problem in words the form can show, not just "Invalid code".
const invalid = (c: any, err: z.ZodError) => c.json({ error: err.errors[0]?.message || 'Invalid code', details: err.flatten() }, 400)

admin.get('/', async (c) => {
  const codes = await db.select().from(discountCodes).orderBy(desc(discountCodes.createdAt))
  return c.json({ codes })
})

/**
 * A CODE IS SOMETHING A SHOPPER TYPES. (Store QA T1, L2: 'POST discount "T1 SP ACE" returned 201; unlikely to be
 * enterable at checkout.') Letters, digits, hyphens and underscores — what fits on a flyer and survives being read
 * out over the phone. Checkout uppercases what it is given (routes/public.ts), so the case is not the shopper's
 * problem; a space inside the code is.
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

admin.post('/', requirePermission('discounts:create'), async (c) => {
  const parsed = codeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return invalid(c, parsed.error)
  const d = parsed.data
  if (d.type === 'percent' && d.value > 100) return c.json({ error: 'A percent discount cannot exceed 100' }, 400)
  const code = d.code
  const existing = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.code, code))
  if (existing.length) return c.json({ error: 'That code already exists' }, 409)
  const [created] = await db.insert(discountCodes).values({
    code, type: d.type, value: d.value,
    active: d.active ?? true,
    minSubtotalCents: d.minSubtotalCents ?? 0,
    maxUses: d.maxUses ?? null,
    expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
  }).returning()
  return c.json({ code: created }, 201)
})

admin.patch('/:id', requirePermission('discounts:update'), async (c) => {
  const parsed = codeSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return invalid(c, parsed.error)
  const [current] = await db.select().from(discountCodes).where(eq(discountCodes.id, c.req.param('id'))).limit(1)
  if (!current) return c.json({ error: 'Not found' }, 404)
  // The create route's rules hold on an edit too. It checked none of them: a 10% code could be edited to 500%, and
  // renamed onto another code's name — no unique index stops that, and checkout takes whichever row it finds first.
  const type = parsed.data.type ?? current.type
  const value = parsed.data.value ?? current.value
  if (type === 'percent' && value > 100) return c.json({ error: 'A percent discount cannot exceed 100' }, 400)
  if (parsed.data.code && parsed.data.code !== current.code) {
    const taken = await db.select({ id: discountCodes.id }).from(discountCodes).where(eq(discountCodes.code, parsed.data.code))
    if (taken.length) return c.json({ error: 'That code already exists' }, 409)
  }
  const patch: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.expiresAt !== undefined) patch.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
  const [updated] = await db.update(discountCodes).set(patch).where(eq(discountCodes.id, c.req.param('id'))).returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ code: updated })
})

admin.delete('/:id', requirePermission('discounts:delete'), async (c) => {
  await db.delete(discountCodes).where(eq(discountCodes.id, c.req.param('id')))
  return c.json({ ok: true })
})

export default admin
