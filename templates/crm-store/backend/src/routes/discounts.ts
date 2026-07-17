import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { discountCodes } from '../../db/schema.ts'
import { eq, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

// Admin CRUD for discount / promo codes. Validation + application happens
// server-side at checkout (routes/public.ts); usage is counted on finalize.
const admin = new Hono()
admin.use('*', authenticate)

admin.get('/', async (c) => {
  const codes = await db.select().from(discountCodes).orderBy(desc(discountCodes.createdAt))
  return c.json({ codes })
})

const codeSchema = z.object({
  code: z.string().min(1).max(64),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  active: z.boolean().optional(),
  minSubtotalCents: z.number().int().nonnegative().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
})

admin.post('/', async (c) => {
  const parsed = codeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid code', details: parsed.error.flatten() }, 400)
  const d = parsed.data
  if (d.type === 'percent' && d.value > 100) return c.json({ error: 'A percent discount cannot exceed 100' }, 400)
  const code = d.code.trim().toUpperCase()
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

admin.patch('/:id', async (c) => {
  const parsed = codeSchema.partial().safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid code' }, 400)
  const patch: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.code) patch.code = parsed.data.code.trim().toUpperCase()
  if (parsed.data.expiresAt !== undefined) patch.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
  const [updated] = await db.update(discountCodes).set(patch).where(eq(discountCodes.id, c.req.param('id'))).returning()
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json({ code: updated })
})

admin.delete('/:id', async (c) => {
  await db.delete(discountCodes).where(eq(discountCodes.id, c.req.param('id')))
  return c.json({ ok: true })
})

export default admin
