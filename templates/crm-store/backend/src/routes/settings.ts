import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { storeSettings } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireAnyPermission, hasPermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { formatCents } from '../lib/money.ts'

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

/**
 * WHO SETS WHAT. (Owner's decision, 10/12, after the T3 manager pass: "split shipping rates out.")
 *
 * Shipping rates are the shop's day-to-day — a manager already connects the carrier account (shipping:configure) and
 * was then refused the rates the carrier is billed against. Tax rates, the currency, the store's name and where its
 * storefront lives are the owner's: tax is a legal matter, and the rest is what the business IS. So the one PATCH
 * asks, field by field, the permission that field belongs to — the Settings screen sends only the fields a person
 * changed, so a manager editing a zone sends only shipping fields and is let through, and one that also touched the
 * tax rate is refused, naming it, with nothing saved.
 */
const SHIPPING_FIELDS = ['flatShippingCents', 'freeShippingThresholdCents', 'shippingZones'] as const
export const permissionForField = (key: string) => (SHIPPING_FIELDS as readonly string[]).includes(key) ? 'shipping:configure' : 'settings:update'

admin.patch('/', requireAnyPermission(['settings:update', 'shipping:configure']), async (c) => {
  const raw = await c.req.json().catch(() => null)
  const user = c.get('user') as any
  // Who may set a field is decided before whether its value is valid (Store QA T3 retest: a manager's bad tax value got
  // 400 "invalid", a good one 403) — a field that is not yours is refused the same way whatever you sent for it.
  const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).filter((k) => k in settingsSchema.shape) : []
  const refused = sent.filter((k) => !hasPermission(user?.role, permissionForField(k)))
  if (refused.length) {
    return c.json({
      error: `Only the store owner can change ${refused.length === 1 ? 'this setting' : 'these settings'}: ${refused.join(', ')}. Nothing was saved.`,
      code: 'settings_field_refused', fields: refused,
    }, 403)
  }
  const parsed = settingsSchema.safeParse(raw)
  if (!parsed.success) return c.json({ error: 'Invalid settings', details: parsed.error.flatten() }, 400)
  const [existing] = await db.select().from(storeSettings).limit(1)
  if (!existing) {
    const [created] = await db.insert(storeSettings)
      .values({ companyName: parsed.data.companyName ?? 'My Store', ...parsed.data }).returning()
    await audit.log({ action: 'create', entity: 'store_settings', entityId: created.id, entityName: created.companyName, metadata: { fields: Object.keys(parsed.data) }, req: c })
    return c.json({ settings: created })
  }
  const [updated] = await db.update(storeSettings)
    .set({ ...parsed.data, updatedAt: new Date() }).where(eq(storeSettings.id, existing.id)).returning()
  const changes = audit.diff(existing as any, updated as any, Object.keys(parsed.data))
  await audit.log({
    action: 'update', entity: 'store_settings', entityId: updated.id, entityName: updated.companyName, changes,
    metadata: { description: describeSettings(changes, updated.currency) }, req: c,
  })
  return c.json({ settings: updated })
})

/**
 * The audit row in words. The page prints a change as `old → new` through String(), which turns a list of zones into
 * "[object Object]"; money is in cents and tax in basis points. So the row carries its own sentence.
 */
const pct = (v: unknown) => `${Number(v ?? 0) / 100}%`
const count = (v: unknown, one: string) => { const n = Array.isArray(v) ? v.length : 0; return `${n} ${one}${n === 1 ? '' : 's'}` }
const sayFor = (currency: string): Record<string, (o: unknown, n: unknown) => string> => {
  const dollars = (v: unknown) => (v === null || v === undefined ? 'never' : formatCents(Number(v), currency))
  return {
    companyName: (o, n) => `Store name "${o ?? ''}" → "${n ?? ''}"`,
    supportEmail: (o, n) => `Support email ${o || '—'} → ${n || '—'}`,
    currency: (o, n) => `Currency ${String(o ?? '').toUpperCase()} → ${String(n ?? '').toUpperCase()}`,
    flatShippingCents: (o, n) => `Flat shipping ${dollars(o)} → ${dollars(n)}`,
    freeShippingThresholdCents: (o, n) => `Free shipping over ${dollars(o)} → ${dollars(n)}`,
    taxRateBps: (o, n) => `Tax ${pct(o)} → ${pct(n)}`,
    shippingZones: (o, n) => `Shipping zones edited (${count(o, 'zone')} → ${count(n, 'zone')})`,
    taxRates: (o, n) => `Regional tax rates edited (${count(o, 'rate')} → ${count(n, 'rate')})`,
    storefrontOrigin: (o, n) => `Storefront address ${o || '—'} → ${n || '—'}`,
  }
}
export const describeSettings = (changes: Record<string, { old: unknown; new: unknown }> | null, currency = 'usd') => {
  if (!changes) return 'Saved with no change'
  const say = sayFor(currency)
  return Object.entries(changes).map(([k, v]) => (say[k] ? say[k](v.old, v.new) : k)).join('; ')
}

export default admin
