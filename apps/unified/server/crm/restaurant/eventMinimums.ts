// Food-and-beverage minimums (restaurant-bar-depth #6, Tripleseat: per-category minimum, the shortfall as a line on the
// bill and taxed; SevenRooms: by day and season). A room has rules — "Saturdays May to October, $5,000", "dinner
// category, $3,000" — and the most specific rule that fits the event's date applies; the room's single minimumSpend is the
// fallback. What the event spends on food and drink (the room hire does not count) short of it becomes a line on the
// event's invoice ("Food and beverage minimum shortfall"), recomputed whenever the menu changes, taxed or not as the
// venue sets (eventSettings.shortfallTaxed). Behind the 'event_minimums' feature (not ready).
import { Hono } from 'hono'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { round2 } from '@twomiah/tenant-backend'
import { eventSpace, eventSpaceMinimum, menuPackage } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { getEventSettings, featureOn } from './eventSettings.ts'
import { moneyRefusal } from './eventBooking.ts'

export const MINIMUM_CATEGORIES = ['canape', 'lunch', 'dinner', 'buffet', 'bar', 'dessert', 'other'] as const
const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

type Rule = { id: string; label: string | null; daysOfWeek: number[]; seasonStart: string | null; seasonEnd: string | null; category: string | null; amount: string | number }

/** Is the day inside a season ("05-01" to "10-31"; one that runs past New Year, "11-01" to "02-28", wraps)? */
export function inSeason(date: string, start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const md = date.slice(5)
  return start <= end ? md >= start && md <= end : md >= start || md <= end
}

/** Does a rule fit this date? */
export function ruleFits(r: Pick<Rule, 'daysOfWeek' | 'seasonStart' | 'seasonEnd'>, date: string): boolean {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay()
  const days = Array.isArray(r.daysOfWeek) ? r.daysOfWeek : []
  return (!days.length || days.includes(dow)) && inSeason(date, r.seasonStart, r.seasonEnd)
}

/** The most specific rules by category that fit the date: a day of the week and a season each count; ties go to the larger. */
export function bestRules(rules: Rule[], date: string): Map<string | null, Rule> {
  const best = new Map<string | null, Rule>()
  const score = (r: Rule) => (r.daysOfWeek?.length ? 2 : 0) + (r.seasonStart && r.seasonEnd ? 1 : 0)
  for (const r of rules) {
    if (!ruleFits(r, date)) continue
    const cur = best.get(r.category ?? null)
    if (!cur || score(r) > score(cur) || (score(r) === score(cur) && Number(r.amount) > Number(cur.amount))) best.set(r.category ?? null, r)
  }
  return best
}

export interface MinimumResult {
  /** Total the rules ask across the categories they cover; null when the room has no minimum on this day. */
  required: number | null
  spend: number
  shortfall: number
  /** One entry per category the minimum is held to. */
  parts: Array<{ category: string | null; label: string | null; required: number; spend: number; shortfall: number }>
  /** The invoice line for the shortfall (empty when there is none). */
  lines: Array<{ description: string; quantity: number; unitPrice: number; taxable: boolean }>
}
const NONE: MinimumResult = { required: null, spend: 0, shortfall: 0, parts: [], lines: [] }

/**
 * What the event owes against the room's minimum. `menu` is the event's lines (room hire = spaceId set, not counted);
 * `topUp` is the quoted-total balance not yet on a menu line, which counts as food and drink.
 */
export async function minimumFor(exec: any, companyId: string, ev: { eventDate: string; spaceId: string | null }, menu: any[], topUp = 0): Promise<MinimumResult> {
  if (!ev.spaceId || !(await featureOn(exec, companyId, 'event_minimums'))) return NONE
  const [space] = await exec.select().from(eventSpace).where(and(eq(eventSpace.id, ev.spaceId), eq(eventSpace.companyId, companyId))).limit(1)
  if (!space) return NONE
  const rules: Rule[] = await exec.select().from(eventSpaceMinimum).where(and(eq(eventSpaceMinimum.spaceId, ev.spaceId), eq(eventSpaceMinimum.companyId, companyId)))
  const best = bestRules(rules, ev.eventDate)
  const fallback = Number(space.minimumSpend || 0)
  if (!best.size && !(fallback > 0)) return NONE
  const pkgIds = [...new Set(menu.map((l: any) => l.packageId).filter(Boolean))]
  const cats = new Map<string, string>()
  if (pkgIds.length) for (const p of await exec.select({ id: menuPackage.id, category: menuPackage.category }).from(menuPackage).where(inArray(menuPackage.id, pkgIds))) cats.set(p.id, p.category)
  const fb = menu.filter((l: any) => !l.spaceId)
  const line = (l: any) => Number(l.unitPrice || 0) * Number(l.quantity || 0)
  const total = round2(fb.reduce((s: number, l: any) => s + line(l), 0) + Math.max(0, topUp))
  const parts: MinimumResult['parts'] = []
  if (!best.size) parts.push({ category: null, label: 'Room minimum', required: fallback, spend: total, shortfall: 0 })
  for (const [category, r] of best) {
    const spend = category === null ? total : round2(fb.filter((l: any) => (l.packageId ? cats.get(l.packageId) || 'other' : 'other') === category).reduce((s: number, l: any) => s + line(l), 0))
    parts.push({ category, label: r.label, required: Number(r.amount), spend, shortfall: 0 })
  }
  for (const p of parts) p.shortfall = round2(Math.max(0, p.required - p.spend))
  const shortfall = round2(parts.reduce((s, p) => s + p.shortfall, 0))
  const taxed = (await getEventSettings(exec, companyId)).shortfallTaxed
  const lines = parts.filter((p) => p.shortfall > 0.004).map((p) => ({
    description: p.category ? `Food and beverage minimum shortfall — ${p.category}` : 'Food and beverage minimum shortfall',
    quantity: 1, unitPrice: p.shortfall, taxable: taxed,
  }))
  return { required: round2(parts.reduce((s, p) => s + p.required, 0)), spend: total, shortfall, parts, lines }
}

function ruleRefusal(b: any, creating: boolean): string | null {
  if (creating || 'amount' in b) {
    const m = moneyRefusal(b.amount, 'Minimum', { zeroAllowed: false })
    if (m) return m
    if (b.amount == null || b.amount === '' || !(Number(b.amount) > 0)) return 'Minimum must be more than $0.00.'
  }
  if ('daysOfWeek' in b && !(Array.isArray(b.daysOfWeek) && b.daysOfWeek.every((n: any) => Number.isInteger(n) && n >= 0 && n <= 6))) return 'Days of the week must be numbers from 0 (Sunday) to 6 (Saturday).'
  const s = b.seasonStart || null, e = b.seasonEnd || null
  if (('seasonStart' in b || 'seasonEnd' in b) && (!!s !== !!e)) return 'A season needs both a first and a last day.'
  if ((s && !MD_RE.test(s)) || (e && !MD_RE.test(e))) return 'Season days are month-day, like 05-01.'
  if (b.category && !(MINIMUM_CATEGORIES as readonly string[]).includes(b.category)) return `Category must be one of: ${MINIMUM_CATEGORIES.join(', ')}.`
  return null
}

export function createEventMinimumRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // A minimum is a price: invoices:read, like the room's own minimum spend.
  app.get('/', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const spaceId = c.req.query('spaceId')
    const rows = await db.select().from(eventSpaceMinimum)
      .where(and(eq(eventSpaceMinimum.companyId, u.companyId), ...(spaceId ? [eq(eventSpaceMinimum.spaceId, spaceId)] : []))).orderBy(asc(eventSpaceMinimum.createdAt))
    return listAll(c, rows)
  })

  app.post('/', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [space] = typeof b.spaceId === 'string' ? await db.select().from(eventSpace).where(and(eq(eventSpace.id, b.spaceId), eq(eventSpace.companyId, u.companyId))).limit(1) : []
    if (!space) return fail(c, 404, 'Space not found')
    const bad = ruleRefusal(b, true)
    if (bad) return fail(c, 400, bad)
    const [row] = await db.insert(eventSpaceMinimum).values({
      id: createId(), spaceId: space.id, label: b.label ? String(b.label).slice(0, 120) : null, daysOfWeek: b.daysOfWeek || [],
      seasonStart: b.seasonStart || null, seasonEnd: b.seasonEnd || null, category: b.category || null, amount: round2(Number(b.amount)).toString(), companyId: u.companyId,
    }).returning()
    await audit.log({ action: 'create', entity: 'event_space_minimum', entityId: row.id, entityName: `${space.name} minimum`, metadata: row, req: { user: u } })
    return one(c, row, 201)
  })

  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [existing] = await db.select().from(eventSpaceMinimum).where(and(eq(eventSpaceMinimum.id, c.req.param('id')), eq(eventSpaceMinimum.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Minimum not found')
    const bad = ruleRefusal(b, false)
    if (bad) return fail(c, 400, bad)
    const set: any = { updatedAt: new Date() }
    for (const k of ['label', 'daysOfWeek', 'seasonStart', 'seasonEnd', 'category'] as const) if (k in b) set[k] = b[k] === '' ? null : b[k]
    if ('amount' in b) set.amount = round2(Number(b.amount)).toString()
    const [row] = await db.update(eventSpaceMinimum).set(set).where(eq(eventSpaceMinimum.id, existing.id)).returning()
    await audit.log({ action: 'update', entity: 'event_space_minimum', entityId: row.id, entityName: row.label || 'Minimum', changes: audit.diff(existing, row), req: { user: u } })
    return one(c, row)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const [existing] = await db.select().from(eventSpaceMinimum).where(and(eq(eventSpaceMinimum.id, c.req.param('id')), eq(eventSpaceMinimum.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Minimum not found')
    await db.delete(eventSpaceMinimum).where(eq(eventSpaceMinimum.id, existing.id))
    await audit.log({ action: 'delete', entity: 'event_space_minimum', entityId: existing.id, entityName: existing.label || 'Minimum', metadata: existing, req: { user: u } })
    return done(c)
  })

  return app
}
