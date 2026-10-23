// /api/bar — the bar's own records, for staff: the menu and 86, taps, specials, games, public events, hours, and the
// Tonight console (open/closed overrides, how busy, the note). The website reads the same rows live through
// /api/public/bar (barPublicRoutes.ts) — one input, every output.
//
// Permissions (packages/tenant-backend/src/auth/permissions.ts):
//   bar:read     everyone signed in — the console and the menu are the shift's working screens
//   bar:console  the bartender's one-tap controls: 86 an item, tap/blow a keg, room, note, overrides, special
//   bar:update   managers and up: the menu, taps, specials, games, events, hours, the speakeasy password
//
// Moved from templates/crm-bar/backend/src/routes/bar.ts. Each action keeps its feature (bar_tonight or bar_menu) and
// its permission. Replies in the rulebook's shapes: the tap, special, game and event lists are list replies
// ({ data, pagination }), deletes are { success: true }.
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, ne } from 'drizzle-orm'
import { barSettings, barStatus, barTap, barSpecial, barGame, barEvent, barMenuSection, barMenuItem, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { endOfBusinessDay, ROOM_STATUSES, TAP_STATUSES } from './barLive.ts'
import { isHoursConfig, type HoursConfig } from './barHours.ts'
import { slugify, sizesFromLabel } from './barMenuSizes.ts'
import { tapSizesInput } from './barTapSizes.ts'
import type { BarServices } from './services.ts'

type Ctx = any
type Status = 400 | 403 | 404 | 409
const me = (c: Ctx) => c.get('user') as { userId: string; companyId: string; email: string; role: string }
const bad = (c: Ctx, error: string, status: Status = 400) => fail(c, status, error)
const all = <T,>(c: Ctx, rows: T[]) => listAll(c, rows)

// ─── input readers: each returns the clean value, or a refusal the page can show ─────────────────────
const str = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}
/** A typed price is always DOLLARS ("9", 9, "$9.50"); cents arrive only as priceCents. */
const cents = (v: unknown): number | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0 || n > 100000) return 'bad'
  return Math.round(n * 100)
}
/** priceCents arrives in cents (a number) from the screens; a typed "$9.50" is dollars. */
const priceIn = (body: any): number | null | 'bad' => {
  if (body.priceCents !== undefined) {
    if (body.priceCents === null || body.priceCents === '') return null
    const n = Number(body.priceCents)
    return Number.isInteger(n) && n >= 0 && n <= 10000000 ? n : 'bad'
  }
  if (body.price !== undefined) return cents(body.price)
  return null
}
const when = (v: unknown): Date | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? 'bad' : d
}
const DAYS_RE = /^(SU|MO|TU|WE|TH|FR|SA)(,(SU|MO|TU|WE|TH|FR|SA))*$/
const days = (v: unknown): string | null | 'bad' => {
  const s = str(v, 40)
  if (!s) return null
  const up = s.toUpperCase().replace(/\s+/g, '')
  return DAYS_RE.test(up) ? up : 'bad'
}
const bool = (v: unknown, dflt: boolean): boolean => (v === undefined ? dflt : v === true || v === 'true')

type Input = { ok: true; value: Record<string, any> } | { ok: false; error: string; status?: Status }

function sectionInput(body: any): Input {
  const name = str(body.name, 120)
  if (body.name !== undefined && !name) return { ok: false, error: 'A section needs a name' }
  const kind = body.kind === undefined ? undefined : body.kind === 'drink' ? 'drink' : body.kind === 'food' ? 'food' : null
  if (kind === null) return { ok: false, error: 'A section is food or drink' }
  const v: Record<string, any> = {}
  if (name) v.name = name
  if (body.description !== undefined) v.description = str(body.description, 2000)
  if (kind) v.kind = kind
  if (body.sortOrder !== undefined) v.sortOrder = Math.max(0, Math.min(10000, Number(body.sortOrder) || 0))
  if (body.isActive !== undefined) v.isActive = bool(body.isActive, true)
  return { ok: true, value: v }
}

function tapInput(body: any, creating: boolean): Input {
  const v: Record<string, any> = {}
  const beer = str(body.beerName, 120)
  if ((creating || body.beerName !== undefined) && !beer) return { ok: false, error: 'A tap needs the beer\'s name' }
  if (beer) v.beerName = beer
  if (creating || body.lineNumber !== undefined) {
    const n = Number(body.lineNumber)
    if (!Number.isInteger(n) || n < 1 || n > 200) return { ok: false, error: 'The tap line is a number from 1 to 200' }
    v.lineNumber = n
  }
  for (const [k, max] of [['brewery', 120], ['style', 80], ['originCountry', 60], ['description', 1000], ['badge', 160]] as const) if (body[k] !== undefined) v[k] = str(body[k], max)
  if (body.abv !== undefined) {
    if (body.abv === null || body.abv === '') v.abv = null
    else { const a = Number(body.abv); if (!Number.isFinite(a) || a < 0 || a > 70) return { ok: false, error: 'ABV is a percentage from 0 to 70' }; v.abv = a.toFixed(1) }
  }
  if (body.priceCents !== undefined || body.price !== undefined) { const p = priceIn(body); if (p === 'bad') return { ok: false, error: 'That price is not a price' }; v.priceCents = p }
  if (body.sizes !== undefined) {
    // Pour sizes (Bar Run 1: one price, no pitcher). The first is the usual pour: written to price_cents / pour_oz too,
    // which stock costing and the website's price read.
    const sz = tapSizesInput(body.sizes); if (!sz.ok) return { ok: false, error: sz.error }
    v.sizes = sz.sizes
    if (sz.sizes.length) { v.priceCents = sz.sizes[0].priceCents; v.pourOz = String(sz.sizes[0].oz) }
  }
  if (body.status !== undefined) { if (!(TAP_STATUSES as readonly string[]).includes(body.status)) return { ok: false, error: 'Status: pouring, just tapped, last keg, or blown' }; v.status = body.status }
  if (body.isActive !== undefined) v.isActive = bool(body.isActive, true)
  if (body.sortOrder !== undefined) v.sortOrder = Math.max(0, Math.min(10000, Number(body.sortOrder) || 0))
  return { ok: true, value: v }
}

function specialInput(body: any, creating: boolean): Input {
  const v: Record<string, any> = {}
  const title = str(body.title, 160)
  if ((creating || body.title !== undefined) && !title) return { ok: false, error: 'A special needs a name' }
  if (title) v.title = title
  if (body.description !== undefined) v.description = str(body.description, 1000)
  if (body.priceCents !== undefined || body.price !== undefined) { const p = priceIn(body); if (p === 'bad') return { ok: false, error: 'That price is not a price' }; v.priceCents = p }
  if (body.startsAt !== undefined || creating) { const d = body.startsAt === undefined ? new Date() : when(body.startsAt); if (d === 'bad' || d === null) return { ok: false, error: 'When it starts is not a time' }; v.startsAt = d }
  if (body.endsAt !== undefined) { const d = when(body.endsAt); if (d === 'bad') return { ok: false, error: 'When it ends is not a time' }; v.endsAt = d }
  if (body.isRecurring !== undefined) v.isRecurring = bool(body.isRecurring, false)
  if (body.recurrenceDays !== undefined) { const d = days(body.recurrenceDays); if (d === 'bad') return { ok: false, error: 'Weekdays as MO,TU,WE,TH,FR,SA,SU' }; v.recurrenceDays = d }
  if (v.endsAt && v.startsAt && v.endsAt <= v.startsAt) return { ok: false, error: 'A special has to end after it starts' }
  return { ok: true, value: v }
}

function gameInput(body: any, creating: boolean): Input {
  const v: Record<string, any> = {}
  for (const k of ['league', 'home', 'away'] as const) {
    const s = str(body[k], 60)
    if ((creating || body[k] !== undefined) && !s) return { ok: false, error: 'A game needs the league and both teams' }
    if (s) v[k] = s
  }
  if (creating || body.startsAt !== undefined) { const d = when(body.startsAt); if (d === 'bad' || d === null) return { ok: false, error: 'When the game starts is not a time' }; v.startsAt = d }
  if (body.isFeatured !== undefined) v.isFeatured = bool(body.isFeatured, false)
  if (body.note !== undefined) v.note = str(body.note, 200)
  for (const k of ['barHours', 'kitchenHours'] as const) {
    if (body[k] === undefined) continue
    if (body[k] !== null && !Array.isArray(body[k])) return { ok: false, error: 'Game-day hours are a list of open/close times' }
    v[k] = body[k]
  }
  return { ok: true, value: v }
}

function eventInput(body: any, creating: boolean): Input {
  const v: Record<string, any> = {}
  const title = str(body.title, 160)
  if ((creating || body.title !== undefined) && !title) return { ok: false, error: 'An event needs a name' }
  if (title) v.title = title
  if (body.description !== undefined) v.description = str(body.description, 4000)
  if (body.imageUrl !== undefined) v.imageUrl = str(body.imageUrl, 1000)
  if (creating || body.startsAt !== undefined) { const d = when(body.startsAt); if (d === 'bad' || d === null) return { ok: false, error: 'When it starts is not a time' }; v.startsAt = d }
  if (body.endsAt !== undefined) { const d = when(body.endsAt); if (d === 'bad') return { ok: false, error: 'When it ends is not a time' }; v.endsAt = d }
  if (body.isRecurring !== undefined) v.isRecurring = bool(body.isRecurring, false)
  if (body.recurrenceDays !== undefined) { const d = days(body.recurrenceDays); if (d === 'bad') return { ok: false, error: 'Weekdays as MO,TU,WE,TH,FR,SA,SU' }; v.recurrenceDays = d }
  if (body.isPublished !== undefined) v.isPublished = bool(body.isPublished, true)
  if (v.endsAt && v.startsAt && v.endsAt <= v.startsAt) return { ok: false, error: 'An event has to end after it starts' }
  return { ok: true, value: v }
}

// ─── settings: hours and the speakeasy door ──────────────────────────────────────────────────────
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
function hoursRefusal(h: any): string | null {
  if (!isHoursConfig(h)) return 'Hours need a bar and a kitchen week'
  if (h.timezone !== undefined && h.timezone !== null && h.timezone !== '') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(h.timezone) }) } catch { return `"${h.timezone}" is not a time zone` }
  }
  const ranges = (list: any) => Array.isArray(list) && list.every((r: any) => r && TIME_RE.test(r.open) && TIME_RE.test(r.close))
  for (const dept of ['bar', 'kitchen'] as const) {
    for (const [day, list] of Object.entries((h as any)[dept] || {})) {
      if (!['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(day)) return `"${day}" is not a day`
      if (!ranges(list)) return `${dept === 'bar' ? 'Bar' : 'Kitchen'} hours on ${day}: times as HH:MM, 24-hour`
    }
  }
  for (const o of (h as any).holidays || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o?.date || '')) return 'A holiday needs its date as YYYY-MM-DD'
    for (const dept of ['bar', 'kitchen'] as const) if (o[dept] !== undefined && o[dept] !== null && !ranges(o[dept])) return `Holiday ${o.date}: times as HH:MM, 24-hour`
  }
  return null
}

export function createBarRoutes(d: CrmDeps, bar: BarServices) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const requireEnabledFeature = d.features.requireEnabledFeature
  const { buildLiveState, hoursFor } = bar.live
  const app = new Hono<AppEnv>()

  async function uniqueSlug(table: any, companyId: string, base: string, exceptId?: string): Promise<string> {
    const root = slugify(base) || 'item'
    for (let i = 0; i < 50; i++) {
      const slug = i === 0 ? root : `${root}-${i + 1}`
      const where = exceptId ? and(eq(table.companyId, companyId), eq(table.slug, slug), ne(table.id, exceptId)) : and(eq(table.companyId, companyId), eq(table.slug, slug))
      const [hit] = await db.select({ id: table.id }).from(table).where(where).limit(1)
      if (!hit) return slug
    }
    return `${root}-${Date.now()}`
  }

  async function actorName(userId: string): Promise<string | null> {
    const [u] = await db.select({ firstName: user.firstName, email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
    return u?.firstName || u?.email || null
  }

  async function itemInput(body: any, companyId: string, creating: boolean): Promise<Input> {
    const v: Record<string, any> = {}
    const name = str(body.name, 160)
    if (creating && !name) return { ok: false, error: 'An item needs a name' }
    if (body.name !== undefined && !name) return { ok: false, error: 'An item needs a name' }
    if (name) v.name = name
    if (body.sectionId !== undefined) {
      if (body.sectionId === null || body.sectionId === '') v.sectionId = null
      else {
        const [sec] = await db.select({ id: barMenuSection.id }).from(barMenuSection).where(and(eq(barMenuSection.id, String(body.sectionId)), eq(barMenuSection.companyId, companyId))).limit(1)
        if (!sec) return { ok: false, error: 'That section does not exist' }
        v.sectionId = sec.id
      }
    }
    if (body.priceCents !== undefined || body.price !== undefined) {
      const p = priceIn(body); if (p === 'bad') return { ok: false, error: 'That price is not a price' }
      v.priceCents = p
    }
    for (const [k, max] of [['description', 2000], ['priceLabel', 120], ['imageUrl', 1000], ['heroImageUrl', 1000], ['story', 20000]] as const) {
      if (body[k] !== undefined) v[k] = str(body[k], max)
    }
    if (body.dietary !== undefined) {
      if (!Array.isArray(body.dietary)) return { ok: false, error: 'Dietary marks are a list' }
      v.dietary = body.dietary.map((x: unknown) => str(x, 20)).filter(Boolean).slice(0, 10)
    }
    if (body.variations !== undefined) {
      if (!Array.isArray(body.variations)) return { ok: false, error: 'Sizes are a list' }
      const out = []
      for (const s of body.variations.slice(0, 12)) {
        const nm = str(s?.name, 60); const pc = Number(s?.priceCents)
        if (!nm || !(Number.isInteger(pc) && pc >= 0)) return { ok: false, error: 'Each size needs a name and a price' }
        out.push({ id: slugify(nm), name: nm, priceCents: pc })
      }
      v.variations = out
    }
    for (const k of ['isSignature', 'is86ed', 'isActive'] as const) if (body[k] !== undefined) v[k] = bool(body[k], false)
    if (body.sortOrder !== undefined) v.sortOrder = Math.max(0, Math.min(10000, Number(body.sortOrder) || 0))
    // The grill (barKitchen.ts): null = by its section (food goes, drinks don't); true/false = this item says.
    if (body.toKitchen !== undefined) v.toKitchen = body.toKitchen === null || body.toKitchen === '' ? null : bool(body.toKitchen, true)
    // Minutes on the grill, as the owner sets it (pacing learns the real time from bumps). Blank = the house default.
    if (body.prepMinutes !== undefined) {
      if (body.prepMinutes === null || String(body.prepMinutes).trim() === '') v.prepSeconds = null
      else {
        const m = Number(String(body.prepMinutes).trim())
        if (!Number.isFinite(m) || m < 0.5 || m > 90) return { ok: false, error: 'Minutes on the grill is between half a minute and 90' }
        v.prepSeconds = Math.round(m * 60)
      }
    }
    return { ok: true, value: v }
  }

  // ─── the Tonight console ──────────────────────────────────────────────────────────────────────────
  app.get('/tonight', requireEnabledFeature('bar_tonight'), requirePermission('bar:read'), async (c) => {
    const { companyId } = me(c)
    const [status] = await db.select().from(barStatus).where(eq(barStatus.companyId, companyId)).limit(1)
    return one(c, {
      live: await buildLiveState(companyId),
      status: status ? {
        kitchenOpen: status.kitchenOpen, kitchenClosesAt: status.kitchenClosesAt, barOpen: status.barOpen, barClosesAt: status.barClosesAt,
        overrideUntil: status.overrideUntil, roomStatus: status.roomStatus, note: status.note, updatedAt: status.updatedAt, updatedByName: status.updatedByName,
      } : null,
    })
  })

  // One tap from the console. Every override lapses at the end of the business day (4 AM) unless the
  // bartender clears it first — a Friday "kitchen closed" never leaves Saturday's board wrong.
  app.put('/tonight', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId, userId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    const patch: Record<string, any> = {}
    for (const k of ['kitchenOpen', 'barOpen'] as const) {
      if (body[k] === undefined) continue
      if (body[k] !== null && typeof body[k] !== 'boolean') return bad(c, `${k} must be open, closed, or follow the hours`)
      patch[k] = body[k]
    }
    for (const k of ['kitchenClosesAt', 'barClosesAt'] as const) {
      if (body[k] === undefined) continue
      const dt = when(body[k]); if (dt === 'bad') return bad(c, 'That closing time is not a time')
      patch[k] = dt
    }
    if (body.roomStatus !== undefined) {
      if (!ROOM_STATUSES.includes(body.roomStatus)) return bad(c, 'How busy: plenty of seats, filling up, or packed')
      patch.roomStatus = body.roomStatus
    }
    if (body.note !== undefined) patch.note = str(body.note, 200)
    if (!Object.keys(patch).length) return bad(c, 'Nothing to change')

    const tz = (await hoursFor(companyId)).timezone!
    const overrides = ['kitchenOpen', 'barOpen', 'kitchenClosesAt', 'barClosesAt'].some((k) => k in patch)
    if (overrides) {
      const [cur] = await db.select().from(barStatus).where(eq(barStatus.companyId, companyId)).limit(1)
      const any = (['kitchenOpen', 'barOpen', 'kitchenClosesAt', 'barClosesAt'] as const).some((k) => (k in patch ? patch[k] : cur?.[k]) !== null && (k in patch ? patch[k] : cur?.[k]) !== undefined)
      patch.overrideUntil = any ? endOfBusinessDay(new Date(), tz) : null
    }
    patch.updatedAt = new Date()
    patch.updatedById = userId
    patch.updatedByName = await actorName(userId)

    const [existing] = await db.select({ id: barStatus.id }).from(barStatus).where(eq(barStatus.companyId, companyId)).limit(1)
    if (existing) await db.update(barStatus).set(patch).where(eq(barStatus.id, existing.id))
    else await db.insert(barStatus).values({ companyId, ...patch } as any)
    audit.log({ req: c, action: 'update', entity: 'bar_status', entityName: 'Tonight', changes: patch })
    return one(c, { live: await buildLiveState(companyId) })
  })

  // ─── menu ─────────────────────────────────────────────────────────────────────────────────────────
  app.get('/menu', requireEnabledFeature('bar_menu'), requirePermission('bar:read'), async (c) => {
    const { companyId } = me(c)
    const sections: Array<typeof barMenuSection.$inferSelect> = await db.select().from(barMenuSection).where(eq(barMenuSection.companyId, companyId)).orderBy(asc(barMenuSection.sortOrder), asc(barMenuSection.name))
    const items: Array<typeof barMenuItem.$inferSelect> = await db.select().from(barMenuItem).where(eq(barMenuItem.companyId, companyId)).orderBy(asc(barMenuItem.sortOrder), asc(barMenuItem.name))
    return one(c, {
      sections: sections.map((s) => ({ ...s, items: items.filter((i) => i.sectionId === s.id) })),
      unsectioned: items.filter((i) => !i.sectionId || !sections.some((s) => s.id === i.sectionId)),
    })
  })

  app.post('/menu/sections', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    if (!str(body.name, 120)) return bad(c, 'A section needs a name')
    const v = sectionInput(body); if (!v.ok) return bad(c, v.error)
    const [row] = await db.insert(barMenuSection).values({ companyId, slug: await uniqueSlug(barMenuSection, companyId, str(body.slug, 80) || body.name), ...v.value } as any).returning()
    audit.log({ req: c, action: 'create', entity: 'bar_menu_section', entityId: row.id, entityName: row.name })
    return one(c, row, 201)
  })

  app.put('/menu/sections/:id', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const v = sectionInput(body); if (!v.ok) return bad(c, v.error)
    if (body.slug !== undefined) v.value.slug = await uniqueSlug(barMenuSection, companyId, str(body.slug, 80) || '', id)
    const [row] = await db.update(barMenuSection).set({ ...v.value, updatedAt: new Date() }).where(and(eq(barMenuSection.id, id), eq(barMenuSection.companyId, companyId))).returning()
    if (!row) return bad(c, 'Section not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_menu_section', entityId: row.id, entityName: row.name, changes: v.value })
    return one(c, row)
  })

  app.delete('/menu/sections/:id', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const id = c.req.param('id')
    const [inUse] = await db.select({ id: barMenuItem.id }).from(barMenuItem).where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.sectionId, id))).limit(1)
    if (inUse) return bad(c, 'Move or delete the items in this section first', 409)
    const [row] = await db.delete(barMenuSection).where(and(eq(barMenuSection.id, id), eq(barMenuSection.companyId, companyId))).returning()
    if (!row) return bad(c, 'Section not found', 404)
    audit.log({ req: c, action: 'delete', entity: 'bar_menu_section', entityId: row.id, entityName: row.name })
    return done(c)
  })

  app.post('/menu/items', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    const v = await itemInput(body, companyId, true); if (!v.ok) return bad(c, v.error, v.status)
    if (!v.value.variations) v.value.variations = sizesFromLabel(v.value.priceCents ?? null, v.value.priceLabel ?? null, null).filter((s) => s.priceCents !== null)
    const [row] = await db.insert(barMenuItem).values({ companyId, slug: await uniqueSlug(barMenuItem, companyId, str(body.slug, 80) || v.value.name), ...v.value } as any).returning()
    audit.log({ req: c, action: 'create', entity: 'bar_menu_item', entityId: row.id, entityName: row.name })
    return one(c, row, 201)
  })

  app.put('/menu/items/:id', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const v = await itemInput(body, companyId, false); if (!v.ok) return bad(c, v.error, v.status)
    if (body.slug !== undefined) v.value.slug = await uniqueSlug(barMenuItem, companyId, str(body.slug, 80) || '', id)
    // A changed price or printed label re-derives the sizes, unless the sizes themselves were sent.
    if (!v.value.variations && ('priceCents' in v.value || 'priceLabel' in v.value)) {
      const [cur] = await db.select({ priceCents: barMenuItem.priceCents, priceLabel: barMenuItem.priceLabel }).from(barMenuItem).where(and(eq(barMenuItem.id, id), eq(barMenuItem.companyId, companyId))).limit(1)
      if (cur) {
        const pc = 'priceCents' in v.value ? v.value.priceCents : cur.priceCents
        const label = 'priceLabel' in v.value ? v.value.priceLabel : cur.priceLabel
        v.value.variations = sizesFromLabel(pc ?? null, label ?? null, null).filter((s) => s.priceCents !== null)
      }
    }
    const [row] = await db.update(barMenuItem).set({ ...v.value, updatedAt: new Date() }).where(and(eq(barMenuItem.id, id), eq(barMenuItem.companyId, companyId))).returning()
    if (!row) return bad(c, 'Menu item not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_menu_item', entityId: row.id, entityName: row.name, changes: v.value })
    return one(c, row)
  })

  // 86 — the bartender's control: out of it now, back on later. Reaches the website on its next read.
  app.put('/menu/items/:id/86', requireEnabledFeature('bar_menu'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    if (typeof body.is86ed !== 'boolean') return bad(c, 'Say whether it is 86ed: true or false')
    const [row] = await db.update(barMenuItem).set({ is86ed: body.is86ed, updatedAt: new Date() }).where(and(eq(barMenuItem.id, id), eq(barMenuItem.companyId, companyId))).returning()
    if (!row) return bad(c, 'Menu item not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_menu_item', entityId: row.id, entityName: row.name, changes: { is86ed: body.is86ed } })
    return one(c, row)
  })

  app.delete('/menu/items/:id', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const [row] = await db.delete(barMenuItem).where(and(eq(barMenuItem.id, c.req.param('id')), eq(barMenuItem.companyId, companyId))).returning()
    if (!row) return bad(c, 'Menu item not found', 404)
    audit.log({ req: c, action: 'delete', entity: 'bar_menu_item', entityId: row.id, entityName: row.name })
    return done(c)
  })

  // ─── taps ─────────────────────────────────────────────────────────────────────────────────────────
  app.get('/taps', requireEnabledFeature('bar_menu'), requirePermission('bar:read'), async (c) => {
    const { companyId } = me(c)
    return all(c, await db.select().from(barTap).where(eq(barTap.companyId, companyId)).orderBy(asc(barTap.sortOrder), asc(barTap.lineNumber)))
  })

  app.post('/taps', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const v = tapInput(await c.req.json().catch(() => ({})), true); if (!v.ok) return bad(c, v.error)
    const [row] = await db.insert(barTap).values({ companyId, tappedAt: new Date(), ...v.value } as any).returning()
    audit.log({ req: c, action: 'create', entity: 'bar_tap', entityId: row.id, entityName: row.beerName })
    return one(c, row, 201)
  })

  app.put('/taps/:id', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const v = tapInput(await c.req.json().catch(() => ({})), false); if (!v.ok) return bad(c, v.error)
    const [row] = await db.update(barTap).set({ ...v.value, updatedAt: new Date() }).where(and(eq(barTap.id, c.req.param('id')), eq(barTap.companyId, companyId))).returning()
    if (!row) return bad(c, 'Tap not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_tap', entityId: row.id, entityName: row.beerName, changes: v.value })
    return one(c, row)
  })

  // Tap / blow a keg — the console's control. A new beer on the line is a PUT by a manager; this only moves
  // the status, and stamps when it was tapped or blown.
  app.put('/taps/:id/status', requireEnabledFeature('bar_menu'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    if (!(TAP_STATUSES as readonly string[]).includes(body.status)) return bad(c, 'Status: pouring, just tapped, last keg, or blown')
    const stamp = body.status === 'blown' ? { blownAt: new Date() } : body.status === 'just_tapped' ? { tappedAt: new Date(), blownAt: null } : {}
    const [row] = await db.update(barTap).set({ status: body.status, ...stamp, updatedAt: new Date() }).where(and(eq(barTap.id, c.req.param('id')), eq(barTap.companyId, companyId))).returning()
    if (!row) return bad(c, 'Tap not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_tap', entityId: row.id, entityName: row.beerName, changes: { status: body.status } })
    return one(c, row)
  })

  app.delete('/taps/:id', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const [row] = await db.delete(barTap).where(and(eq(barTap.id, c.req.param('id')), eq(barTap.companyId, companyId))).returning()
    if (!row) return bad(c, 'Tap not found', 404)
    audit.log({ req: c, action: 'delete', entity: 'bar_tap', entityId: row.id, entityName: row.beerName })
    return done(c)
  })

  // ─── specials (the console posts tonight's; managers set recurring ones) ─────────────────────────────
  app.get('/specials', requireEnabledFeature('bar_tonight'), requirePermission('bar:read'), async (c) => {
    const { companyId } = me(c)
    return all(c, await db.select().from(barSpecial).where(eq(barSpecial.companyId, companyId)).orderBy(desc(barSpecial.startsAt)).limit(200))
  })

  app.post('/specials', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId, userId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    const v = specialInput(body, true); if (!v.ok) return bad(c, v.error)
    // "Tonight's special" from the console: no end given → it ends with the business day.
    if (!v.value.isRecurring && !v.value.endsAt) v.value.endsAt = endOfBusinessDay(new Date(), (await hoursFor(companyId)).timezone!)
    const [row] = await db.insert(barSpecial).values({ companyId, createdById: userId, ...v.value } as any).returning()
    audit.log({ req: c, action: 'create', entity: 'bar_special', entityId: row.id, entityName: row.title })
    return one(c, row, 201)
  })

  app.put('/specials/:id', requireEnabledFeature('bar_tonight'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const v = specialInput(await c.req.json().catch(() => ({})), false); if (!v.ok) return bad(c, v.error)
    // An edit with nothing in it was a 500 in the template (an empty update); it is a refusal the page can show.
    if (!Object.keys(v.value).length) return bad(c, 'Nothing to change')
    const [row] = await db.update(barSpecial).set(v.value).where(and(eq(barSpecial.id, c.req.param('id')), eq(barSpecial.companyId, companyId))).returning()
    if (!row) return bad(c, 'Special not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_special', entityId: row.id, entityName: row.title, changes: v.value })
    return one(c, row)
  })

  app.delete('/specials/:id', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const [row] = await db.delete(barSpecial).where(and(eq(barSpecial.id, c.req.param('id')), eq(barSpecial.companyId, companyId))).returning()
    if (!row) return bad(c, 'Special not found', 404)
    audit.log({ req: c, action: 'delete', entity: 'bar_special', entityId: row.id, entityName: row.title })
    return done(c)
  })

  // ─── games ────────────────────────────────────────────────────────────────────────────────────────
  app.get('/games', requireEnabledFeature('bar_tonight'), requirePermission('bar:read'), async (c) => {
    const { companyId } = me(c)
    const since = new Date(Date.now() - 7 * 86400000)
    return all(c, await db.select().from(barGame).where(and(eq(barGame.companyId, companyId), gte(barGame.startsAt, since))).orderBy(asc(barGame.startsAt)).limit(200))
  })

  app.post('/games', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const v = gameInput(await c.req.json().catch(() => ({})), true); if (!v.ok) return bad(c, v.error)
    const [row] = await db.insert(barGame).values({ companyId, ...v.value } as any).returning()
    audit.log({ req: c, action: 'create', entity: 'bar_game', entityId: row.id, entityName: `${row.away} at ${row.home}` })
    return one(c, row, 201)
  })

  app.put('/games/:id', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const v = gameInput(await c.req.json().catch(() => ({})), false); if (!v.ok) return bad(c, v.error)
    // An edit with nothing in it was a 500 in the template (an empty update); it is a refusal the page can show.
    if (!Object.keys(v.value).length) return bad(c, 'Nothing to change')
    const [row] = await db.update(barGame).set(v.value).where(and(eq(barGame.id, c.req.param('id')), eq(barGame.companyId, companyId))).returning()
    if (!row) return bad(c, 'Game not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_game', entityId: row.id, entityName: `${row.away} at ${row.home}`, changes: v.value })
    return one(c, row)
  })

  app.delete('/games/:id', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const [row] = await db.delete(barGame).where(and(eq(barGame.id, c.req.param('id')), eq(barGame.companyId, companyId))).returning()
    if (!row) return bad(c, 'Game not found', 404)
    audit.log({ req: c, action: 'delete', entity: 'bar_game', entityId: row.id, entityName: `${row.away} at ${row.home}` })
    return done(c)
  })

  // ─── public events (trivia, live music, the fish fry) ─────────────────────────────────────────────
  app.get('/events', requireEnabledFeature('bar_tonight'), requirePermission('bar:read'), async (c) => {
    const { companyId } = me(c)
    return all(c, await db.select().from(barEvent).where(eq(barEvent.companyId, companyId)).orderBy(desc(barEvent.startsAt)).limit(300))
  })

  app.post('/events', requireEnabledFeature('bar_tonight'), requirePermission('bar:console'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    const v = eventInput(body, true); if (!v.ok) return bad(c, v.error)
    const [row] = await db.insert(barEvent).values({ companyId, slug: await uniqueSlug(barEvent, companyId, str(body.slug, 80) || v.value.title), ...v.value } as any).returning()
    audit.log({ req: c, action: 'create', entity: 'bar_event', entityId: row.id, entityName: row.title })
    return one(c, row, 201)
  })

  app.put('/events/:id', requireEnabledFeature('bar_tonight'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    const v = eventInput(body, false); if (!v.ok) return bad(c, v.error)
    if (body.slug !== undefined) v.value.slug = await uniqueSlug(barEvent, companyId, str(body.slug, 80) || '', id)
    const [row] = await db.update(barEvent).set({ ...v.value, updatedAt: new Date() }).where(and(eq(barEvent.id, id), eq(barEvent.companyId, companyId))).returning()
    if (!row) return bad(c, 'Event not found', 404)
    audit.log({ req: c, action: 'update', entity: 'bar_event', entityId: row.id, entityName: row.title, changes: v.value })
    return one(c, row)
  })

  app.delete('/events/:id', requireEnabledFeature('bar_tonight'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const [row] = await db.delete(barEvent).where(and(eq(barEvent.id, c.req.param('id')), eq(barEvent.companyId, companyId))).returning()
    if (!row) return bad(c, 'Event not found', 404)
    audit.log({ req: c, action: 'delete', entity: 'bar_event', entityId: row.id, entityName: row.title })
    return done(c)
  })

  // ─── settings: hours and the speakeasy door ──────────────────────────────────────────────────────
  const settingsReply = async (companyId: string) => {
    const [s] = await db.select().from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    return { hours: await hoursFor(companyId), speakeasy: { enabled: !!s?.speakeasyPasswordHash, note: s?.speakeasyNote || null }, updatedAt: s?.updatedAt || null }
  }

  app.get('/settings', requireEnabledFeature('bar_tonight'), requirePermission('bar:read'), async (c) => {
    return one(c, await settingsReply(me(c).companyId))
  })

  app.put('/settings', requireEnabledFeature('bar_tonight'), requirePermission('bar:update'), async (c) => {
    const { companyId } = me(c)
    const body = await c.req.json().catch(() => ({}))
    const patch: Record<string, any> = {}
    if (body.hours !== undefined) {
      const why = hoursRefusal(body.hours); if (why) return bad(c, why)
      // No zone of its own: the bar keeps time on the company's (barLive.ts hoursFor).
      const h: HoursConfig = { bar: body.hours.bar || {}, kitchen: body.hours.kitchen || {}, holidays: body.hours.holidays || [] }
      patch.hours = h
    }
    if (body.speakeasyPassword !== undefined) {
      if (body.speakeasyPassword === null || body.speakeasyPassword === '') patch.speakeasyPasswordHash = null
      else {
        const pw = String(body.speakeasyPassword).trim()
        if (pw.length < 3 || pw.length > 60) return bad(c, 'The password is 3 to 60 characters')
        // Bun's own bcrypt, the same the sign-in uses (shared auth.ts) — no extra dependency.
        patch.speakeasyPasswordHash = await Bun.password.hash(pw.toLowerCase(), 'bcrypt')
      }
    }
    if (body.speakeasyNote !== undefined) patch.speakeasyNote = str(body.speakeasyNote, 200)
    if (!Object.keys(patch).length) return bad(c, 'Nothing to change')
    patch.updatedAt = new Date()
    const [existing] = await db.select({ id: barSettings.id }).from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
    if (existing) await db.update(barSettings).set(patch).where(eq(barSettings.id, existing.id))
    else await db.insert(barSettings).values({ companyId, ...patch } as any)
    // The audit row says what changed, never the password.
    const changes = { ...patch }; if ('speakeasyPasswordHash' in changes) changes.speakeasyPasswordHash = changes.speakeasyPasswordHash ? '(set)' : '(cleared)'
    audit.log({ req: c, action: 'update', entity: 'bar_settings', entityName: 'Hours & speakeasy', changes })
    return one(c, await settingsReply(companyId))
  })

  // ─── import: a whole menu / tap list / hours / event list in one go (moving a bar onto Twomiah) ─────────
  // Upserts by slug (menu sections and items, events) and by line number (taps), so running it twice changes
  // nothing. Owner/admin only (bar:update is held by managers too; an import rewrites the whole menu).
  app.post('/import', requireEnabledFeature('bar_menu'), requirePermission('bar:update'), async (c) => {
    const { companyId, role } = me(c)
    if (!['owner', 'admin'].includes(role)) return bad(c, 'Only an owner or admin can import a whole menu', 403)
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad(c, 'Send the menu, taps, hours or events as JSON')
    const counts = { sections: 0, items: 0, taps: 0, events: 0, hours: false }

    if (body.hours !== undefined) {
      const why = hoursRefusal(body.hours); if (why) return bad(c, why)
    }
    const sections = Array.isArray(body.menu?.sections) ? body.menu.sections : []
    for (const s of sections) if (!str(s?.name, 120)) return bad(c, 'Every menu section needs a name')
    for (const s of sections) for (const i of (Array.isArray(s.items) ? s.items : [])) if (!str(i?.name, 160)) return bad(c, `An item in "${s.name}" has no name`)
    const taps = Array.isArray(body.taps) ? body.taps : []
    for (const t of taps) { const v = tapInput(t, true); if (!v.ok) return bad(c, `Tap ${t?.lineNumber ?? '?'}: ${v.error}`) }
    const events = Array.isArray(body.events) ? body.events : []
    for (const e of events) { const v = eventInput(e, true); if (!v.ok) return bad(c, `Event "${e?.title ?? '?'}": ${v.error}`) }

    await db.transaction(async (tx: any) => {
      let si = 0
      for (const s of sections) {
        const slug = slugify(str(s.slug, 80) || s.name)
        const values = { name: str(s.name, 120)!, description: str(s.description, 2000), kind: s.kind === 'drink' ? 'drink' : 'food', sortOrder: s.sortOrder ?? si++, isActive: s.isActive !== false, updatedAt: new Date() }
        const [hit] = await tx.select({ id: barMenuSection.id }).from(barMenuSection).where(and(eq(barMenuSection.companyId, companyId), eq(barMenuSection.slug, slug))).limit(1)
        const sectionId = hit ? (await tx.update(barMenuSection).set(values).where(eq(barMenuSection.id, hit.id)).returning())[0].id
          : (await tx.insert(barMenuSection).values({ companyId, slug, ...values }).returning())[0].id
        counts.sections++
        let ii = 0
        for (const i of (Array.isArray(s.items) ? s.items : [])) {
          const islug = slugify(str(i.slug, 80) || i.name)
          const pc = i.priceCents === undefined || i.priceCents === null ? null : Number(i.priceCents)
          const label = str(i.priceLabel, 120)
          const variations = Array.isArray(i.variations) && i.variations.length ? i.variations : sizesFromLabel(Number.isInteger(pc) ? pc : null, label, s.description).filter((x) => x.priceCents !== null)
          const iv = {
            sectionId, name: str(i.name, 160)!, description: str(i.description, 2000), priceCents: Number.isInteger(pc) ? pc : null, priceLabel: label,
            dietary: Array.isArray(i.dietary) ? i.dietary.slice(0, 10) : [], imageUrl: str(i.imageUrl, 1000), heroImageUrl: str(i.heroImageUrl, 1000),
            story: str(i.story, 20000), isSignature: !!i.isSignature, is86ed: !!i.is86ed, isActive: i.isActive !== false, variations, sortOrder: i.sortOrder ?? ii++, updatedAt: new Date(),
          }
          const [ih] = await tx.select({ id: barMenuItem.id }).from(barMenuItem).where(and(eq(barMenuItem.companyId, companyId), eq(barMenuItem.slug, islug))).limit(1)
          if (ih) await tx.update(barMenuItem).set(iv).where(eq(barMenuItem.id, ih.id))
          else await tx.insert(barMenuItem).values({ companyId, slug: islug, ...iv })
          counts.items++
        }
      }
      for (const t of taps) {
        const v = tapInput(t, true) as { ok: true; value: Record<string, any> }
        const [hit] = await tx.select({ id: barTap.id }).from(barTap).where(and(eq(barTap.companyId, companyId), eq(barTap.lineNumber, v.value.lineNumber), eq(barTap.isActive, true))).limit(1)
        if (hit) await tx.update(barTap).set({ ...v.value, updatedAt: new Date() }).where(eq(barTap.id, hit.id))
        else await tx.insert(barTap).values({ companyId, tappedAt: new Date(), ...v.value })
        counts.taps++
      }
      for (const e of events) {
        const v = eventInput(e, true) as { ok: true; value: Record<string, any> }
        const slug = slugify(str(e.slug, 80) || v.value.title)
        const [hit] = await tx.select({ id: barEvent.id }).from(barEvent).where(and(eq(barEvent.companyId, companyId), eq(barEvent.slug, slug))).limit(1)
        if (hit) await tx.update(barEvent).set({ ...v.value, updatedAt: new Date() }).where(eq(barEvent.id, hit.id))
        else await tx.insert(barEvent).values({ companyId, slug, ...v.value })
        counts.events++
      }
      if (body.hours !== undefined) {
        const h = { bar: body.hours.bar || {}, kitchen: body.hours.kitchen || {}, holidays: body.hours.holidays || [] }
        const [hit] = await tx.select({ id: barSettings.id }).from(barSettings).where(eq(barSettings.companyId, companyId)).limit(1)
        if (hit) await tx.update(barSettings).set({ hours: h, updatedAt: new Date() }).where(eq(barSettings.id, hit.id))
        else await tx.insert(barSettings).values({ companyId, hours: h })
        counts.hours = true
      }
    })
    audit.log({ req: c, action: 'create', entity: 'bar_import', entityName: 'Menu import', metadata: counts })
    return one(c, { imported: counts })
  })

  return app
}
