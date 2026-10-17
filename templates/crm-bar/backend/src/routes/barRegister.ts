// THE REGISTER and THE GRILL — the bar tablet and the wall screen by the charbroiler (pages /register, /grill,
// /closeout). Mounted at /api/register and /api/grill behind the bar_register feature.
//
//   GET    /register/state                  open checks, tonight's closed, the menu, the tax rate, my PIN / powers
//   GET    /register/check/:id              one check
//   POST   /register/check                  { kind, label, spot, note }
//   PATCH  /register/check/:id              { label, spot, note }
//   POST   /register/check/:id/items        { menuItemId | 'tap:<id>', sizeId, qty, note, seat, priceCents }
//   POST   /register/check/:id/send         { itemIds? }   coursing: send just these
//   POST   /register/check/:id/pay          { tender: cash | card_external, amountCents, tipCents, cashTenderedCents }
//   POST   /register/check/:id/split        { itemIds, label }
//   POST   /register/check/:id/split-seats
//   POST   /register/check/:id/guest        { contactId | null }
//   POST   /register/check/:id/void         { reason, managerPin? }   a manager's when anything was sent
//   PATCH  /register/item/:id               { qty, note, seat }       held items only
//   POST   /register/item/:id/void          { reason, managerPin? }   a manager's when it was sent
//   POST   /register/payment/:id/void       { reason, managerPin? }   always a manager's
//   GET    /register/day?day=YYYY-MM-DD     the night's summary, open checks, its close-outs
//   POST   /register/closeout               { day, floatCents, countedCents, note, force, managerPin? }
//   PUT    /register/pin  { pin }  ·  DELETE /register/pin     my own till PIN
//   GET    /grill/state  ·  POST /grill/bump { id }  ·  POST /grill/recall { id }
//
// Permissions (packages/tenant-backend/src/auth/permissions.ts): bar:register works the register and the grill
// (bartenders and up); bar:manage voids sent food, payments and checks and closes the night — a bartender can
// still do those with a manager's till PIN typed on the spot (services/barManagers.ts).
import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import audit from '../services/audit.ts'
import {
  addItem, addPayment, attachGuest, CheckError, checkNeedsManager, getCheck, itemNeedsManager, listOpen, listRecentClosed,
  menuForRegister, openCheck, renameCheck, sendCheck, splitBySeat, splitItems, taxRateBps, updateItem, voidCheck, voidItem, voidPayment,
} from '../services/barRegister.ts'
import { actorOf, clearOwnPin, hasOwnPin, managerApproval, mayManage, PinError, setOwnPin, type Actor } from '../services/barManagers.ts'
import { bumpTicket, kitchenState, recallTicket } from '../services/barKitchen.ts'
import { barTimezone, closeDay, closeoutsFor, loadDay } from '../services/barReports.ts'
import { businessDayOf, businessDayWindow } from '../services/barLive.ts'

type Ctx = any
const FEATURE = 'bar_register'
const body = async (c: Ctx): Promise<Record<string, any>> => c.req.json().catch(() => ({}))

/** Run an action; a CheckError / PinError is a refusal the screen shows as-is, anything else a plain 500. */
async function act(c: Ctx, fn: () => Promise<unknown>) {
  try {
    return c.json({ ok: true, ...(await fn() as object) })
  } catch (e: any) {
    if (e instanceof CheckError || e instanceof PinError) return c.json({ error: e.message }, e.status)
    console.error('[register]', e?.message || e)
    return c.json({ error: 'That did not save. Try again.' }, 500)
  }
}

/** The name a manager-only action is recorded under, or the refusal that asks for a manager's PIN. */
async function managerOr(c: Ctx, actor: Actor, b: Record<string, any>): Promise<{ byName: string } | Response> {
  const m = await managerApproval(actor, b.managerPin)
  return m.ok ? { byName: m.byName } : c.json({ error: m.error, needsManager: true }, 403)
}

// ─── The register ────────────────────────────────────────────────────────────
export const registerRoutes = new Hono()
registerRoutes.use('*', authenticate)
const ring = [requireEnabledFeature(FEATURE), requirePermission('bar:register')] as const

registerRoutes.get('/state', ...ring, async (c) => {
  const actor = await actorOf(c)
  const tz = await barTimezone(actor.companyId)
  const night = businessDayOf(new Date(), tz)
  const [open, recent, menu, rate, manage, pin] = await Promise.all([
    listOpen(actor.companyId), listRecentClosed(actor.companyId, businessDayWindow(night, tz).from), menuForRegister(actor.companyId),
    taxRateBps(actor.companyId), mayManage(actor), hasOwnPin(actor),
  ])
  c.header('Cache-Control', 'no-store')
  return c.json({ serverNow: Date.now(), businessDay: night, open, recent, menu, taxRateBps: rate, me: { name: actor.name, mayManage: manage, hasPin: pin } })
})

registerRoutes.get('/check/:id', ...ring, async (c) => {
  const actor = await actorOf(c)
  return act(c, async () => ({ check: await getCheck(actor.companyId, c.req.param('id')) }))
})
registerRoutes.post('/check', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => ({ check: await openCheck(actor, b) }))
})
registerRoutes.patch('/check/:id', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => ({ check: await renameCheck(actor, c.req.param('id'), b) }))
})
registerRoutes.post('/check/:id/items', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => ({ check: await addItem(actor, c.req.param('id'), b) }))
})
registerRoutes.post('/check/:id/send', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  const only = Array.isArray(b.itemIds) ? b.itemIds.map(String).slice(0, 100) : undefined
  return act(c, async () => ({ check: await sendCheck(actor, c.req.param('id'), only) }))
})
registerRoutes.post('/check/:id/pay', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => { const { changeCents, ...check } = await addPayment(actor, c.req.param('id'), b); return { check, changeCents } })
})
registerRoutes.post('/check/:id/split', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => splitItems(actor, c.req.param('id'), Array.isArray(b.itemIds) ? b.itemIds.map(String) : [], b.label ?? null))
})
registerRoutes.post('/check/:id/split-seats', ...ring, async (c) => {
  const actor = await actorOf(c)
  return act(c, async () => splitBySeat(actor, c.req.param('id')))
})
registerRoutes.post('/check/:id/guest', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  const g = b.contactId === null ? null : (typeof b.contactId === 'string' && b.contactId ? b.contactId : undefined)
  if (g === undefined) return c.json({ error: 'Which guest?' }, 400)
  return act(c, async () => ({ check: await attachGuest(actor, c.req.param('id'), g) }))
})
registerRoutes.post('/check/:id/void', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c); const id = c.req.param('id')
  let byName = actor.name
  if (await checkNeedsManager(actor.companyId, id)) { const m = await managerOr(c, actor, b); if (m instanceof Response) return m; byName = m.byName }
  return act(c, async () => {
    const check = await voidCheck(actor, id, String(b.reason || ''), byName)
    audit.log({ req: c, action: 'delete', entity: 'bar_check', entityId: id, entityName: `Check #${check.number}`, changes: { status: 'void', reason: check.voidReason, by: byName } })
    return { check }
  })
})
registerRoutes.patch('/item/:id', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => ({ check: await updateItem(actor, c.req.param('id'), b) }))
})
registerRoutes.post('/item/:id/void', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c); const id = c.req.param('id')
  let byName = actor.name
  const sent = await itemNeedsManager(actor.companyId, id)   // taking a held item back needs no one
  if (sent) { const m = await managerOr(c, actor, b); if (m instanceof Response) return m; byName = m.byName }
  return act(c, async () => {
    const check = await voidItem(actor, id, String(b.reason || ''), byName)
    if (sent) audit.log({ req: c, action: 'update', entity: 'bar_check_item', entityId: id, entityName: `Check #${check.number}`, changes: { state: 'void', reason: String(b.reason || ''), by: byName } })
    return { check }
  })
})
registerRoutes.post('/payment/:id/void', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c); const id = c.req.param('id')
  const m = await managerOr(c, actor, b); if (m instanceof Response) return m
  return act(c, async () => {
    const check = await voidPayment(actor, id, String(b.reason || ''), m.byName)
    audit.log({ req: c, action: 'update', entity: 'bar_check_payment', entityId: id, entityName: `Check #${check.number}`, changes: { voided: true, reason: String(b.reason || ''), by: m.byName } })
    return { check }
  })
})

// ── The night: the summary, and closing it ──
registerRoutes.get('/day', ...ring, async (c) => {
  const actor = await actorOf(c)
  const q = c.req.query('day') || ''
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : businessDayOf(new Date(), await barTimezone(actor.companyId))
  const { summary, open } = await loadDay(actor.companyId, day)
  c.header('Cache-Control', 'no-store')
  return c.json({ day, summary, open, closes: await closeoutsFor(actor.companyId, day), me: { mayManage: await mayManage(actor) } })
})
registerRoutes.post('/closeout', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  const m = await managerOr(c, actor, b); if (m instanceof Response) return m
  return act(c, async () => {
    const closeout = await closeDay(actor, m.byName, { day: String(b.day || ''), floatCents: b.floatCents, countedCents: b.countedCents, note: b.note, force: b.force === true })
    audit.log({ req: c, action: 'create', entity: 'bar_closeout', entityId: closeout.id, entityName: `Close-out ${closeout.businessDay}`, changes: { overShortCents: closeout.overShortCents, by: m.byName } })
    return { closeout }
  })
})

// ── My till PIN ──
registerRoutes.put('/pin', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  return act(c, async () => { await setOwnPin(actor, b.pin); return { hasPin: true } })
})
registerRoutes.delete('/pin', ...ring, async (c) => {
  const actor = await actorOf(c)
  return act(c, async () => { await clearOwnPin(actor); return { hasPin: false } })
})

// ─── The grill ───────────────────────────────────────────────────────────────
export const kitchenRoutes = new Hono()
kitchenRoutes.use('*', authenticate)

kitchenRoutes.get('/state', ...ring, async (c) => {
  const actor = await actorOf(c)
  c.header('Cache-Control', 'no-store')
  return c.json(await kitchenState(actor.companyId))
})
kitchenRoutes.post('/bump', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  if (!b.id) return c.json({ error: 'Which ticket?' }, 400)
  return (await bumpTicket(actor.companyId, String(b.id), actor.name)) ? c.json({ ok: true }) : c.json({ error: 'Already bumped.' }, 409)
})
kitchenRoutes.post('/recall', ...ring, async (c) => {
  const actor = await actorOf(c); const b = await body(c)
  if (!b.id) return c.json({ error: 'Which ticket?' }, 400)
  return (await recallTicket(actor.companyId, String(b.id))) ? c.json({ ok: true }) : c.json({ error: 'That ticket is already up.' }, 409)
})
