// What the bar's WEBSITE reads, live: GET /api/public/bar/{live,menu,menu/:slug,taps,hours,events} and the
// speakeasy door's POST. No sign-in — a customer's phone, through the website's server — so every answer is
// public fields only: no keg levels, no blown kegs, no inactive items, no password. The contract both sides
// keep is scratchpad BAR_CONTRACT.md; the website (templates/website-premium-bar) caches each answer ~20 s.
//
// The company is the oldest row in this database (one bar per tenant database), the same rule as the
// dispensary's public menu (T45 H24). A cancelled company's live facts stop (402 ACCOUNT_LOCKED) — the
// website falls back to its static page — and a feature the owner switched off answers 404.
import { Hono } from 'hono'
import { and, asc, eq, gte, or } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { company, barSettings, barTap, barEvent, barMenuSection, barMenuItem } from '../../db/schema.ts'
import { accountLockOf } from '../shared/index.ts'
import { buildLiveState, formatPrice, hoursFor, PUBLIC_TAP_STATUSES } from '../services/barLive.ts'
import { tapSizes } from '../services/barTapSizes.ts'

const app = new Hono()

async function theBar(): Promise<{ id: string; enabledFeatures: unknown; settings: unknown } | null> {
  const [co] = await db.select({ id: company.id, enabledFeatures: company.enabledFeatures, settings: company.settings })
    .from(company).orderBy(asc(company.createdAt)).limit(1)
  return co || null
}
const featureOn = (co: { enabledFeatures: unknown }, id: string) => {
  let list = co.enabledFeatures as unknown
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = null } }
  return Array.isArray(list) && list.includes(id)
}

/** The company, or the answer to give instead (no bar / locked / feature off). */
async function gate(c: any, feature: string): Promise<{ id: string } | Response> {
  const co = await theBar()
  if (!co) return c.json({ error: 'Not set up yet' }, 404)
  if (accountLockOf(co.settings)) return c.json({ error: 'This bar\'s page is paused', code: 'ACCOUNT_LOCKED' }, 402)
  if (!featureOn(co, feature)) return c.json({ error: 'Not available' }, 404)
  return co
}
const isResponse = (x: any): x is Response => x instanceof Response

const publicItem = (i: typeof barMenuItem.$inferSelect) => ({
  slug: i.slug, name: i.name, description: i.description, priceCents: i.priceCents, priceLabel: i.priceLabel,
  price: i.priceLabel || formatPrice(i.priceCents), dietary: Array.isArray(i.dietary) ? i.dietary : [],
  imageUrl: i.imageUrl, heroImageUrl: i.heroImageUrl, story: i.story, isSignature: i.isSignature, is86ed: i.is86ed,
  variations: (Array.isArray(i.variations) ? i.variations : []).map((v: any) => ({ name: String(v?.name || ''), priceCents: Number(v?.priceCents) || 0 })),
})

app.get('/live', async (c) => {
  const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
  return c.json(await buildLiveState(co.id))
})

app.get('/menu', async (c) => {
  const co = await gate(c, 'bar_menu'); if (isResponse(co)) return co
  const sections = await db.select().from(barMenuSection)
    .where(and(eq(barMenuSection.companyId, co.id), eq(barMenuSection.isActive, true))).orderBy(asc(barMenuSection.sortOrder), asc(barMenuSection.name))
  const items = await db.select().from(barMenuItem)
    .where(and(eq(barMenuItem.companyId, co.id), eq(barMenuItem.isActive, true))).orderBy(asc(barMenuItem.sortOrder), asc(barMenuItem.name))
  const stamps = [...sections.map((s) => s.updatedAt), ...items.map((i) => i.updatedAt)].filter(Boolean) as Date[]
  return c.json({
    updatedAt: stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))).toISOString() : null,
    sections: sections.map((s) => ({
      slug: s.slug, name: s.name, description: s.description, kind: s.kind === 'drink' ? 'drink' : 'food',
      items: items.filter((i) => i.sectionId === s.id).map(publicItem),
    })),
  })
})

app.get('/menu/:slug', async (c) => {
  const co = await gate(c, 'bar_menu'); if (isResponse(co)) return co
  const [item] = await db.select().from(barMenuItem)
    .where(and(eq(barMenuItem.companyId, co.id), eq(barMenuItem.slug, c.req.param('slug')), eq(barMenuItem.isActive, true))).limit(1)
  if (!item) return c.json({ error: 'Not on the menu' }, 404)
  const [section] = item.sectionId ? await db.select().from(barMenuSection).where(and(eq(barMenuSection.id, item.sectionId), eq(barMenuSection.companyId, co.id))).limit(1) : []
  if (section && !section.isActive) return c.json({ error: 'Not on the menu' }, 404)
  return c.json({ ...publicItem(item), section: section ? { slug: section.slug, name: section.name } : null })
})

app.get('/taps', async (c) => {
  const co = await gate(c, 'bar_menu'); if (isResponse(co)) return co
  const rows = await db.select().from(barTap)
    .where(and(eq(barTap.companyId, co.id), eq(barTap.isActive, true))).orderBy(asc(barTap.sortOrder), asc(barTap.lineNumber))
  const shown = rows.filter((t) => (PUBLIC_TAP_STATUSES as readonly string[]).includes(t.status))
  const stamp = rows.reduce<Date | null>((m, t) => (!m || t.updatedAt > m ? t.updatedAt : m), null)
  return c.json({
    updatedAt: stamp ? stamp.toISOString() : null,
    taps: shown.map((t) => ({
      lineNumber: t.lineNumber, beerName: t.beerName, brewery: t.brewery, style: t.style, abv: t.abv,
      originCountry: t.originCountry, description: t.description, badge: t.badge, price: formatPrice(t.priceCents), status: t.status,
      // Every pour size, for a tap list that shows "Pint $5.50 · Pitcher $18" (price above stays the usual pour).
      sizes: tapSizes(t).map((s) => ({ name: s.name, oz: s.oz, price: formatPrice(s.priceCents) })),
    })),
  })
})

app.get('/hours', async (c) => {
  const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
  const h = await hoursFor(co.id)
  return c.json({ timezone: h.timezone, bar: h.bar || {}, kitchen: h.kitchen || {}, overrides: h.holidays || [] })
})

app.get('/events', async (c) => {
  const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
  // Upcoming one-offs, ones still running, and every published recurring night.
  const since = new Date(Date.now() - 6 * 3600000)
  const rows = await db.select().from(barEvent)
    .where(and(eq(barEvent.companyId, co.id), eq(barEvent.isPublished, true), or(gte(barEvent.startsAt, since), gte(barEvent.endsAt, since), eq(barEvent.isRecurring, true))))
    .orderBy(asc(barEvent.startsAt)).limit(100)
  return c.json({
    events: rows.map((e) => ({
      slug: e.slug, title: e.title, description: e.description, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt ? e.endsAt.toISOString() : null,
      imageUrl: e.imageUrl, isRecurring: e.isRecurring, recurrenceDays: e.recurrenceDays,
    })),
  })
})

// The speakeasy door: a riddle on the website, the password checked here so it never leaves the CRM.
// Ten tries per address per ten minutes; a wrong answer is just "no", never a hint.
const tries = new Map<string, { n: number; resetAt: number }>()
app.post('/speakeasy', async (c) => {
  const co = await gate(c, 'bar_tonight'); if (isResponse(co)) return co
  const ip = (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown'
  const now = Date.now()
  const t = tries.get(ip)
  if (t && t.resetAt > now && t.n >= 10) return c.json({ ok: false, error: 'Too many knocks. Try again later.' }, 429)
  tries.set(ip, t && t.resetAt > now ? { n: t.n + 1, resetAt: t.resetAt } : { n: 1, resetAt: now + 10 * 60_000 })
  if (tries.size > 5000) for (const [k, v] of tries) if (v.resetAt <= now) tries.delete(k)
  const body = await c.req.json().catch(() => ({}))
  const answer = String(body?.answer ?? '').trim().toLowerCase().slice(0, 60)
  const [s] = await db.select({ hash: barSettings.speakeasyPasswordHash, note: barSettings.speakeasyNote }).from(barSettings).where(eq(barSettings.companyId, co.id)).limit(1)
  if (!s?.hash) return c.json({ error: 'Not available' }, 404)
  const ok = !!answer && await Bun.password.verify(answer, s.hash)
  return c.json(ok ? { ok: true, note: s.note || null } : { ok: false })
})

export default app
