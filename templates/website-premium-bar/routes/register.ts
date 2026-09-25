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
 *   POST /api/register/check/:id/pay        { tender, amountCents, tipCents, cashTenderedCents }
 *   POST /api/register/check/:id/split      { itemIds, label }
 *   POST /api/register/check/:id/void       { reason }
 *   PATCH /api/register/item/:id            { qty, note, seat }
 *   POST /api/register/item/:id/void        { reason }
 *   POST /api/register/payment/:id/void     { reason }
 */
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { asc, eq } from 'drizzle-orm'
import ejs from 'ejs'
import path from 'path'
import { db } from '../db'
import { menuItems, menuSections, settings as settingsTbl } from '../db/schema'
import { sizesOf } from '../lib/menu/sizes'
import { addItem, addPayment, CheckError, getCheck, listOpen, listRecentClosed, openCheck, registerBus, renameCheck, sendCheck, splitItems, updateItem, voidCheck, voidItem, voidPayment } from '../lib/register/checks'
import { localDateString, localToUtc } from '../lib/hours'
import { requireStaff, type Vars } from './console'

const viewsDir = path.join(import.meta.dir, '..', 'views', 'console')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function menuForRegister() {
  const [sections, items] = await Promise.all([
    db.select().from(menuSections).where(eq(menuSections.isActive, true)).orderBy(asc(menuSections.sortOrder)),
    db.select().from(menuItems).where(eq(menuItems.isActive, true)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name)),
  ])
  return sections.map(s => ({
    id: s.id, name: s.name, kind: s.kind,
    items: items.filter(i => i.sectionId === s.id).map(i => ({
      id: i.id, name: i.name, is86ed: i.is86ed,
      sizes: sizesOf(i, s.description).map(v => ({ id: v.id, name: v.name, priceCents: v.priceCents })),
    })),
  })).filter(s => s.items.length)
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
  return { serverNow: Date.now(), open, recent, menu, taxRateBps: s?.taxRateBps ?? 550 }
}

/** Run a check action; CheckError becomes a JSON error the screen shows as-is. */
async function act(c: Context, fn: () => Promise<unknown>) {
  try {
    return c.json({ ok: true, ...(await fn() as object) })
  } catch (e: any) {
    if (e instanceof CheckError) return c.json({ error: e.message }, e.status as 400 | 404 | 409)
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

// ─── API ────────────────────────────────────────────────────────────────────
export const registerApi = new Hono<{ Variables: Vars }>()
registerApi.use('*', requireStaff)

registerApi.get('/state', async (c) => { c.header('Cache-Control', 'no-store'); return c.json(await registerState()) })

registerApi.get('/stream', (c) => {
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    let dirty = true, closed = false
    let wake: (() => void) | null = null
    const onChange = () => { dirty = true; wake?.() }
    registerBus.on('changed', onChange)
    stream.onAbort(() => { closed = true; registerBus.off('changed', onChange); wake?.() })
    try {
      while (!closed) {
        if (dirty) { dirty = false; await stream.writeSSE({ event: 'checks', data: JSON.stringify({ serverNow: Date.now(), open: await listOpen(db), recent: await listRecentClosed(db, await businessDayStart()) }) }) }
        const timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => { wake = null; resolve(true) }, 20_000)
          wake = () => { clearTimeout(timer); wake = null; resolve(false) }
        })
        if (timedOut && !closed && !dirty) await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    } finally { registerBus.off('changed', onChange) }
  })
})

const who = (c: Context<{ Variables: Vars }>) => c.get('staff').label

registerApi.get('/check/:id', (c) => { const i = id(c); return i ? act(c, async () => ({ check: await getCheck(db, i) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check', async (c) => { const b = await body(c); return act(c, async () => ({ check: await openCheck(db, b as any, who(c)) })) })
registerApi.patch('/check/:id', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await renameCheck(db, i, b) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/items', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await addItem(db, i, b as any, who(c)) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/send', (c) => { const i = id(c); return i ? act(c, async () => ({ check: await sendCheck(db, i, who(c)) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/pay', async (c) => {
  const i = id(c); const b = await body(c)
  if (!i) return c.json({ error: 'Which check?' }, 400)
  return act(c, async () => { const r = await addPayment(db, i, b as any, who(c)); const { changeCents, ...check } = r; return { check, changeCents } })
})
registerApi.post('/check/:id/split', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => splitItems(db, i, Array.isArray(b.itemIds) ? b.itemIds.map(String) : [], b.label ?? null, who(c))) : c.json({ error: 'Which check?' }, 400) })
registerApi.post('/check/:id/void', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await voidCheck(db, i, String(b.reason || ''), who(c)) })) : c.json({ error: 'Which check?' }, 400) })
registerApi.patch('/item/:id', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await updateItem(db, i, b) })) : c.json({ error: 'Which item?' }, 400) })
registerApi.post('/item/:id/void', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await voidItem(db, i, String(b.reason || ''), who(c)) })) : c.json({ error: 'Which item?' }, 400) })
registerApi.post('/payment/:id/void', async (c) => { const i = id(c); const b = await body(c); return i ? act(c, async () => ({ check: await voidPayment(db, i, String(b.reason || ''), who(c)) })) : c.json({ error: 'Which payment?' }, 400) })
