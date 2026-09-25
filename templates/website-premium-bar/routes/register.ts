/**
 * routes/register.ts — THE REGISTER. The bar tablet: open tabs and tables,
 * ring items, send food to the grill, take payment, split, void. Same staff
 * PIN as the console and the grill screen.
 *
 *   GET  /register                          the screen
 *   GET  /api/register/state                open checks, today's closed, the menu
 *   GET  /api/register/stream               SSE: open checks on every change
 *   GET  /api/register/check/:id            one check
 *   POST /api/register/check                { kind, label, spot, note }
 *   PATCH /api/register/check/:id           { label, spot }
 *   POST /api/register/check/:id/items      { menuItemId, sizeId, qty, note, seat, priceCents }
 *   POST /api/register/check/:id/send
 *   POST /api/register/check/:id/pay        { tender, amountCents, tipCents, cashTenderedCents, giftCardCode }
 *   POST /api/register/check/:id/giftcard   { amountCents, code? }  sell a gift card (issued when the check is paid)
 *   GET  /api/register/giftcard?code=       balance lookup
 *   POST /api/register/check/:id/split      { itemIds, label }
 *   POST /api/register/check/:id/void       { reason }
 *   PATCH /api/register/item/:id            { qty, note, seat }
 *   POST /api/register/item/:id/void        { reason }
 *   POST /api/register/payment/:id/void     { reason }
 */
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { and, asc, eq } from 'drizzle-orm'
import ejs from 'ejs'
import path from 'path'
import { db } from '../db'
import { checkItems, menuItems, menuSections, settings as settingsTbl, staffPins, taps } from '../db/schema'
import { sizesOf } from '../lib/menu/sizes'
import { addGiftCardLine, addItem, addPayment, attachGuest, CheckError, getCheck, redeemReward, splitBySeat, listOpen, listRecentClosed, openCheck, registerBus, renameCheck, sendCheck, splitItems, updateItem, voidCheck, voidItem, voidPayment } from '../lib/register/checks'
import { localDateString, localToUtc } from '../lib/hours'
import { requireStaff, type Vars } from './console'
import { managerApproval } from '../lib/register/managers'
import { kitchenBus } from '../lib/kitchen/tickets'
import { floorConfig } from '../lib/register/floor'
import { EMAIL_CONSENT_TEXT, GuestError, guestProfile, loyaltySettings, saveGuest, searchGuests } from '../lib/crm/guests'
import { barTimezone, businessDayOf, loadDay } from '../lib/register/reports'
import { closeDay, closeoutsFor } from '../lib/register/closeout'
import { addDays } from '../lib/hours'
import { findCard } from '../lib/giftcards/cards'
import { CATEGORIES } from '../lib/inventory/costing'
import { StockError, countItem, currentCount, finishCount, stockList } from '../lib/inventory/stock'

const viewsDir = path.join(import.meta.dir, '..', 'views', 'console')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function menuForRegister() {
  const [sections, items, lines] = await Promise.all([
    db.select().from(menuSections).where(eq(menuSections.isActive, true)).orderBy(asc(menuSections.sortOrder)),
    db.select().from(menuItems).where(eq(menuItems.isActive, true)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name)),
    db.select().from(taps).where(eq(taps.isActive, true)).orderBy(asc(taps.sortOrder), asc(taps.lineNumber)),
  ])
  // The tap list is a menu section of its own: whatever is on the lines right now, from the console's tap board.
  const onTap = lines.filter(t => t.status !== 'blown').map(t => ({
    id: 'tap:' + t.id, name: t.beerName, is86ed: false,
    sizes: [{ id: 'regular', name: 'Regular', priceCents: t.priceCents }],
  }))
  const menu: Array<{ id: string; name: string; kind: string; items: Array<{ id: string; name: string; is86ed: boolean; sizes: Array<{ id: string; name: string; priceCents: number | null }> }> }> = sections.map(s => ({
    id: s.id, name: s.name, kind: s.kind,
    items: items.filter(i => i.sectionId === s.id).map(i => ({
      id: i.id, name: i.name, is86ed: i.is86ed,
      sizes: sizesOf(i, s.description).map(v => ({ id: v.id, name: v.name, priceCents: v.priceCents })),
    })),
  })).filter(s => s.items.length)
  // Food first (the grill is the bar's first job); the taps lead the drinks.
  if (onTap.length) {
    const at = menu.findIndex(s => s.kind === 'drink')
    menu.splice(at < 0 ? menu.length : at, 0, { id: 'taps', name: 'On tap', kind: 'drink', items: onTap })
  }
  return menu
}

async function businessDayStart(): Promise<Date> {
  const [s] = await db.select({ timezone: settingsTbl.timezone, hours: settingsTbl.hours }).from(settingsTbl).limit(1)
  const tz = ((s?.hours as any)?.timezone as string) || s?.timezone || 'America/Chicago'
  const now = new Date()
  // The bar's day runs 6 AM to 6 AM, so a 1 AM close still counts toward tonight.
  const today = localDateString(now, tz)
  const six = localToUtc(today, '06:00', tz)
  return now.getTime() >= six.getTime() ? six : new Date(six.getTime() - 86400000)
}

async function registerState() {
  const [open, recent, menu, [s]] = await Promise.all([
    listOpen(db), listRecentClosed(db, await businessDayStart()), menuForRegister(),
    db.select({ taxRateBps: settingsTbl.taxRateBps }).from(settingsTbl).limit(1),
  ])
  return { serverNow: Date.now(), open, recent, menu, taxRateBps: s?.taxRateBps ?? 550, regulars: { loyalty: await loyaltySettings(db), emailConsentText: EMAIL_CONSENT_TEXT } }
}

/** Run a check action; CheckError / GuestError become a JSON error the screen shows as-is. */
async function act(c: Context, fn: () => Promise<unknown>) {
  try {
    return c.json({ ok: true, ...(await fn() as object) })
  } catch (e: any) {
    if (e instanceof CheckError || e instanceof GuestError) return c.json({ error: e.message }, e.status as 400 | 404 | 409)
    console.error('[register]', e?.message || e)
    return c.json({ error: 'That did not save. Try again.' }, 500)
  }
}
async function body(c: Context): Promise<Record<string, any>> { return c.req.json().catch(() => ({})) }
function id(c: Context, name = 'id'): string | null { const v = c.req.param(name); return v && UUID.test(v) ? v : null }

// ─── Page ───────────────────────────────────────────────────────────────────
export const registerPages = new Hono<{ Variables: Vars }>()
registerPages.use('*', requireStaff)
registerPages.get('/', async (c) => {
  const [s] = await db.select({ name: settingsTbl.companyName }).from(settingsTbl).limit(1)
  const html = await ejs.renderFile(path.join(viewsDir, 'register.ejs'), { companyName: s?.name || 'Bar', staff: c.get('staff'), state: await registerState() })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

// The floor phone: table map, order by seat, coursing, split by seat, "Food's up".
registerPages.get('/floor', async (c) => {
  const [s] = await db.select({ name: settingsTbl.companyName, floor: settingsTbl.floor }).from(settingsTbl).limit(1)
  const html = await ejs.renderFile(path.join(viewsDir, 'floor.ejs'), { companyName: s?.name || 'Bar', staff: c.get('staff'), state: { ...(await registerState()), floor: floorConfig(s?.floor) } })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

// The count: walk the walk-in and the back bar with a phone.
registerPages.get('/count', async (c) => {
  const [s] = await db.select({ name: settingsTbl.companyName }).from(settingsTbl).limit(1)
  const [stock, count] = await Promise.all([stockList(db), currentCount(db, c.get('staff').label, false)])
  const html = await ejs.renderFile(path.join(viewsDir, 'count.ejs'), {
    companyName: s?.name || 'Bar', staff: c.get('staff'),
    state: { categories: CATEGORIES, count, stock: stock.map(r => ({ id: r.id, name: r.name, category: r.category, unitLabel: r.unitLabel, packName: r.packName, packSize: r.packSize })) },   // blind: no expected numbers
  })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

// The night's close-out: the report, the open-check warning, the cash count.
registerPages.get('/closeout', async (c) => {
  const tz = await barTimezone(db)
  const q = c.req.query('day') || ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : businessDayOf(new Date(), tz)
  const [{ summary, open }, closes, [s], managers] = await Promise.all([
    loadDay(db, day), closeoutsFor(db, day),
    db.select({ name: settingsTbl.companyName, email: settingsTbl.email }).from(settingsTbl).limit(1),
    db.select({ id: staffPins.id }).from(staffPins).where(and(eq(staffPins.isActive, true), eq(staffPins.role, 'manager'))),
  ])
  const isManager = managers.some(m => m.id === c.get('staff').id)
  const html = await ejs.renderFile(path.join(viewsDir, 'closeout.ejs'), {
    companyName: s?.name || 'Bar', ownerEmail: s?.email || '', staff: c.get('staff'), day, prevDay: addDays(day, -1), nextDay: addDays(day, 1),
    today: businessDayOf(new Date(), tz), summary, open, closes, needPin: managers.length > 0 && !isManager,
  })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

// ─── API ────────────────────────────────────────────────────────────────────
export const registerApi = new Hono<{ Variables: Vars }>()
registerApi.use('*', requireStaff)

registerApi.get('/day', async (c) => {
  const q = c.req.query('day') || ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : businessDayOf(new Date(), await barTimezone(db))
  const { summary, open } = await loadDay(db, day)
  c.header('Cache-Control', 'no-store')
  return c.json({ day, summary, open, closes: await closeoutsFor(db, day) })
})

// Close the night: a manager's OK (once the bar has manager PINs), then freeze and email.
registerApi.post('/closeout', async (c) => {
  const b = await body(c)
  const m = await managerApproval(db, c.get('staff'), b.managerPin)
  if (!m.ok) return c.json({ error: m.error, needsManager: true }, 403)
  return act(c, async () => ({ closeout: await closeDay(db, { day: String(b.day || ''), floatCents: b.floatCents, countedCents: b.countedCents, note: b.note, force: b.force === true }, m.by) }))
})

// ── The Regulars at the register ──
registerApi.get('/guests', async (c) => { c.header('Cache-Control', 'no-store'); return c.json({ guests: await searchGuests(db, c.req.query('q') || '') }) })
registerApi.post('/guests', async (c) => {
  const b = await body(c)
  return act(c, async () => {
    const g = await saveGuest(db, { ...b, emailConsent: b.emailConsent === true, consentSource: 'register (entered by ' + who(c) + ')' }, 'register')
    return { guest: await guestProfile(db, g.id, await barTimezone(db)) }
  })
})
registerApi.get('/guest/:id', (c) => { const i = id(c); return i ? act(c, async () => ({ guest: await guestProfile(db, i, await barTimezone(db)) })) : c.json({ error: 'Which guest?' }, 400) })
registerApi.post('/check/:id/guest', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which check?' }, 400)
  const g = b.guestId === null ? null : (typeof b.guestId === 'string' && UUID.test(b.guestId) ? b.guestId : undefined)
  if (g === undefined) return c.json({ error: 'Which guest?' }, 400)
  return act(c, async () => ({ check: await attachGuest(db, i, g) }))
})
registerApi.post('/check/:id/reward', (c) => { const i = id(c); return i ? act(c, async () => ({ check: await redeemReward(db, i, who(c)) })) : c.json({ error: 'Which check?' }, 400) })

registerApi.get('/state', async (c) => { c.header('Cache-Control', 'no-store'); return c.json(await registerState()) })

registerApi.get('/stream', (c) => {
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    let dirty = true, closed = false
    let wake: (() => void) | null = null
    const onChange = () => { dirty = true; wake?.() }
    registerBus.on('changed', onChange)
    kitchenBus.on('changed', onChange)   // a bump on the grill is "Food's up" on the floor
    stream.onAbort(() => { closed = true; registerBus.off('changed', onChange); kitchenBus.off('changed', onChange); wake?.() })
    try {
      while (!closed) {
        if (dirty) { dirty = false; await stream.writeSSE({ event: 'checks', data: JSON.stringify({ serverNow: Date.now(), open: await listOpen(db), recent: await listRecentClosed(db, await businessDayStart()) }) }) }
        const timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => { wake = null; resolve(true) }, 20_000)
          wake = () => { clearTimeout(timer); wake = null; resolve(false) }
        })
        if (timedOut && !closed && !dirty) await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    } finally { registerBus.off('changed', onChange); kitchenBus.off('changed', onChange) }
  })
})

const who = (c: Context<{ Variables: Vars }>) => c.get('staff').label

registerApi.get('/check/:id', (c) => { const i = id(c); return i ? act(c, async () => ({ check: await getCheck(db, i) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check', async (c) => { const b = await body(c); return act(c, async () => ({ check: await openCheck(db, b as any, who(c)) })) })
registerApi.patch('/check/:id', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await renameCheck(db, i, b) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/items', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await addItem(db, i, b as any, who(c)) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/send', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which check?' }, 400)
  const only = Array.isArray(b.itemIds) ? b.itemIds.map(String).filter((x: string) => UUID.test(x)) : undefined
  return act(c, async () => ({ check: await sendCheck(db, i, who(c), only) }))
})
registerApi.post('/check/:id/split-seats', (c) => { const i = id(c); return i ? act(c, async () => splitBySeat(db, i, who(c))) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/pay', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which check?' }, 400)
  return act(c, async () => { const r = await addPayment(db, i, b as any, who(c)); const { changeCents, giftCard, ...check } = r; return { check, changeCents, giftCard: giftCard || null } })
})
registerApi.post('/check/:id/giftcard', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which check?' }, 400)
  return act(c, async () => ({ check: await addGiftCardLine(db, i, { amountCents: Number(b.amountCents), code: b.code ? String(b.code) : null }, who(c)) }))
})
// ─── The count ───────────────────────────────────────────────────────────────
registerApi.post('/count/item', async (c) => {
  const b = await body(c)
  if (!UUID.test(String(b.stockItemId || ''))) return c.json({ error: 'Which item?' }, 400)
  try {
    const count = await currentCount(db, who(c))
    const qty = await countItem(db, count!.id, String(b.stockItemId), { packs: b.packs, units: b.units, clear: !!b.clear }, who(c))
    return c.json({ ok: true, qty, countId: count!.id })
  } catch (e) { if (e instanceof StockError) return c.json({ error: e.message }, e.status as any); throw e }
})
registerApi.post('/count/finish', async (c) => {
  try {
    const count = await currentCount(db, who(c), false)
    if (!count) return c.json({ error: 'Nothing counted yet.' }, 400)
    return c.json({ ok: true, count: await finishCount(db, count.id, who(c)) })
  } catch (e) { if (e instanceof StockError) return c.json({ error: e.message }, e.status as any); throw e }
})

registerApi.get('/giftcard', async (c) => {
  c.header('Cache-Control', 'no-store')
  const card = await findCard(db, c.req.query('code') || '')
  if (!card) return c.json({ error: 'No gift card with that number.' }, 404)
  return c.json({ code: card.code, balanceCents: card.balanceCents, status: card.status, initialCents: card.initialCents })
})
registerApi.post('/check/:id/split', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => splitItems(db, i, Array.isArray(b.itemIds) ? b.itemIds.map(String) : [], b.label ?? null, who(c))) : c.json({ error: 'Which check?' }, 400) })
/** Voids that need a manager: food already sent, payments, a check with sent food on it. */
async function needManager(c: Context<{ Variables: Vars }>, b: Record<string, any>): Promise<{ by: string } | Response> {
  const m = await managerApproval(db, c.get('staff'), b.managerPin)
  return m.ok ? { by: m.by } : c.json({ error: m.error, needsManager: true }, 403)
}
registerApi.post('/check/:id/void', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which check?' }, 400)
  const sent = await db.select({ id: checkItems.id }).from(checkItems).where(and(eq(checkItems.checkId, i), eq(checkItems.state, 'sent'))).limit(1)
  let by = who(c)
  if (sent.length) { const m = await needManager(c, b); if (m instanceof Response) return m; by = m.by }
  return act(c, async () => ({ check: await voidCheck(db, i, String(b.reason || ''), by) }))
})
registerApi.patch('/item/:id', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await updateItem(db, i, b) })) : c.json({ error: 'Which item?' }, 400) })
registerApi.post('/item/:id/void', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which item?' }, 400)
  const [it] = await db.select({ state: checkItems.state, kind: checkItems.kind, giftCardId: checkItems.giftCardId }).from(checkItems).where(eq(checkItems.id, i)).limit(1)
  let by = who(c)
  const unissuedCard = it?.kind === 'giftcard' && !it.giftCardId   // not a real card yet: nothing to protect
  if (it?.state === 'sent' && !unissuedCard) { const m = await needManager(c, b); if (m instanceof Response) return m; by = m.by }   // taking a held item back needs no one
  return act(c, async () => ({ check: await voidItem(db, i, String(b.reason || ''), by) }))
})
registerApi.post('/payment/:id/void', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which payment?' }, 400)
  const m = await needManager(c, b); if (m instanceof Response) return m
  return act(c, async () => ({ check: await voidPayment(db, i, String(b.reason || ''), m.by) }))
})
