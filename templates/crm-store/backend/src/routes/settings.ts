import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { storeSettings } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const admin = new Hono()
admin.use('*', authenticate)

admin.get('/', async (c) => {
  const [s] = await db.select().from(storeSettings).limit(1)
  return c.json({ settings: s ?? null })
})

const settingsSchema = z.object({
  companyName: z.string().min(1).optional(),
  supportEmail: z.string().email().optional().nullable(),
  currency: z.string().length(3).optional(),
  flatShippingCents: z.number().int().nonnegative().optional(),
  freeShippingThresholdCents: z.number().int().nonnegative().optional().nullable(),
  taxRateBps: z.number().int().nonnegative().max(10000).optional(),
  // Region-based overrides (win over the flat rates above when the buyer's
  // ship-to region matches).
  shippingZones: z.array(z.object({
    name: z.string(),
    countries: z.array(z.string()),
    states: z.array(z.string()),
    rateCents: z.number().int().nonnegative(),
    freeThresholdCents: z.number().int().nonnegative().nullable().optional(),
  })).optional().nullable(),
  taxRates: z.array(z.object({
    country: z.string(),
    state: z.string(),
    rateBps: z.number().int().nonnegative().max(10000),
  })).optional().nullable(),
  storefrontOrigin: z.string().optional().nullable(),
})

admin.patch('/', async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid settings', details: parsed.error.flatten() }, 400)
  const [existing] = await db.select().from(storeSettings).limit(1)
  if (!existing) {
    const [created] = await db.insert(storeSettings)
      .values({ companyName: parsed.data.companyName ?? 'My Store', ...parsed.data }).returning()
    return c.json({ settings: created })
  }
  const [updated] = await db.update(storeSettings)
    .set({ ...parsed.data, updatedAt: new Date() }).where(eq(storeSettings.id, existing.id)).returning()
  return c.json({ settings: updated })
})

export default admin
