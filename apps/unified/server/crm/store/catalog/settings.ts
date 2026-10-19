// The store's commerce settings at /api/admin/settings: currency, flat shipping and the free-shipping line, the tax
// rate, shipping zones and regional tax rates, and the abandoned-cart and review-request switches. Moved from
// templates/crm-store/backend/src/routes/settings.ts.
//
// Kept as the template had it: who sets what, field by field (owner's decision, 10/12) — the shipping rates are the
// shop's day-to-day (shipping:configure, the manager's as well), everything else the owner's (settings:update); a save
// that touches a field the person may not set is refused whole, naming the fields, with nothing saved, and that is
// decided before whether the values are valid (Store QA T3 retest); the validation of each field (money and basis
// points as non-negative integers, a tax rate at most 100%); the audit row in words ('Flat shipping $5.00 → $6.00',
// 'Tax 5% → 5.5%', 'Shipping zones edited (0 zones → 1 zone)'), only for a save that went through.
//
// Changes from the template:
//   · the settings are the company's store_settings row (core.settings, made with its defaults on first read); the
//     business itself is the company row (UNIFIED_STORE_PLAN decision 1). Its name and support email are read and
//     written by the engine's company module — GET / PUT /api/company (`name`, `email`) — and onboarding by
//     POST /api/onboarding/complete. A save here that sends companyName or supportEmail is refused (400, code
//     'company_field', naming /api/company) rather than dropped in silence; storefrontOrigin likewise — the storefront
//     is this app's own website (decision 4), its address the company's domain (/api/admin/domain);
//   · the abandoned-cart and review-request switches (abandonedCartEnabled, abandonedCartDelayMinutes, reviewsEnabled,
//     reviewRequestDays) are settable here, the owner's — the template's row had them and no screen could change them;
//   · a person's own grants count in the field check (permissions.hasPermission with their extra permissions; the
//     template asked the role alone);
//   · replies (RULEBOOK §3): the settings are the record (was { settings }); the field refusal keeps its sentence and
//     code, its `fields` list now the rulebook's fields map ({ taxRateBps: 'Only the store owner can change this' });
//     a validation failure names each box (was 'Invalid settings' with zod's flatten() as `details`).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { storeSettings } from '../../../db/schema/store.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { formatCents } from '../lib/money.ts'
import { changedKeys } from './audit.ts'

const settingsSchema = z.object({
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
  abandonedCartEnabled: z.boolean().optional(),
  abandonedCartDelayMinutes: z.number().int().min(1).max(60 * 24 * 7).optional(),
  reviewsEnabled: z.boolean().optional(),
  reviewRequestDays: z.number().int().min(0).max(365).optional(),
})

/** The business's own fields, which the template's row held and the company row holds here. */
const COMPANY_FIELDS: Record<string, string> = {
  companyName: 'the company name (PUT /api/company { name })',
  supportEmail: 'the support email (PUT /api/company { email })',
  storefrontOrigin: "the storefront's address (the website is this app's own; a domain is /api/admin/domain)",
}

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

/**
 * The audit row in words. The page prints a change as `old → new` through String(), which turns a list of zones into
 * "[object Object]"; money is in cents and tax in basis points. So the row carries its own sentence.
 */
const pct = (v: unknown) => `${Number(v ?? 0) / 100}%`
const count = (v: unknown, one: string) => { const n = Array.isArray(v) ? v.length : 0; return `${n} ${one}${n === 1 ? '' : 's'}` }
const onOff = (v: unknown) => (v ? 'on' : 'off')
const sayFor = (currency: string): Record<string, (o: unknown, n: unknown) => string> => {
  const dollars = (v: unknown) => (v === null || v === undefined ? 'never' : formatCents(Number(v), currency))
  return {
    currency: (o, n) => `Currency ${String(o ?? '').toUpperCase()} → ${String(n ?? '').toUpperCase()}`,
    flatShippingCents: (o, n) => `Flat shipping ${dollars(o)} → ${dollars(n)}`,
    freeShippingThresholdCents: (o, n) => `Free shipping over ${dollars(o)} → ${dollars(n)}`,
    taxRateBps: (o, n) => `Tax ${pct(o)} → ${pct(n)}`,
    shippingZones: (o, n) => `Shipping zones edited (${count(o, 'zone')} → ${count(n, 'zone')})`,
    taxRates: (o, n) => `Regional tax rates edited (${count(o, 'rate')} → ${count(n, 'rate')})`,
    abandonedCartEnabled: (o, n) => `Abandoned-cart reminders ${onOff(o)} → ${onOff(n)}`,
    abandonedCartDelayMinutes: (o, n) => `Abandoned-cart reminder after ${o} → ${n} minutes`,
    reviewsEnabled: (o, n) => `Review requests ${onOff(o)} → ${onOff(n)}`,
    reviewRequestDays: (o, n) => `Review request ${o} → ${n} days after shipping`,
  }
}
export const describeSettings = (changes: Record<string, { old: unknown; new: unknown }> | null, currency = 'usd') => {
  if (!changes) return 'Saved with no change'
  const say = sayFor(currency)
  return Object.entries(changes).map(([k, v]) => (say[k] ? say[k](v.old, v.new) : k)).join('; ')
}

export function createStoreSettingsRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit, permissions } = d
  const app = new Hono<AppEnv>()

  // Every seat reads the settings (the template's GET asked for a session alone): checkout's rates, the currency.
  app.get('/', async (c) => one(c, await core.settings(c.get('user').companyId)))

  app.patch('/', permissions.requireAnyPermission(['settings:update', 'shipping:configure']), async (c) => {
    const u = c.get('user')
    const raw = await c.req.json().catch(() => null)
    // Who may set a field is decided before whether its value is valid (Store QA T3 retest: a manager's bad tax value got
    // 400 "invalid", a good one 403) — a field that is not yours is refused the same way whatever you sent for it.
    const sent = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.keys(raw).filter((k) => k in settingsSchema.shape || k in COMPANY_FIELDS)
      : []
    const extra: string[] = (await permissions.getExtraPermissions(u.userId)) || []
    const refused = sent.filter((k) => !permissions.hasPermission(u.role, permissionForField(k), extra))
    if (refused.length) {
      return fail(c, 403,
        `Only the store owner can change ${refused.length === 1 ? 'this setting' : 'these settings'}: ${refused.join(', ')}. Nothing was saved.`,
        'settings_field_refused', Object.fromEntries(refused.map((k) => [k, 'Only the store owner can change this'])))
    }
    const theCompanys = sent.filter((k) => k in COMPANY_FIELDS)
    if (theCompanys.length) {
      return fail(c, 400,
        `${theCompanys.map((k) => COMPANY_FIELDS[k]).join('; ')} ${theCompanys.length === 1 ? 'is' : 'are'} the company's, saved in the company settings. Nothing was saved.`,
        'company_field', Object.fromEntries(theCompanys.map((k) => [k, 'Saved in the company settings'])))
    }
    const parsed = settingsSchema.safeParse(raw)
    if (!parsed.success) return invalid(c, parsed.error)
    const existing = await core.settings(u.companyId)
    const [updated] = await db.update(storeSettings).set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(storeSettings.id, existing.id), eq(storeSettings.companyId, u.companyId))).returning()
    const changes = changedKeys(existing, updated, Object.keys(parsed.data))
    await audit.log({
      action: audit.ACTIONS.UPDATE, entity: 'store_settings', entityId: updated.id, entityName: 'Store settings', changes,
      metadata: { description: describeSettings(changes, updated.currency) }, req: c,
    })
    return one(c, updated)
  })

  return app
}
