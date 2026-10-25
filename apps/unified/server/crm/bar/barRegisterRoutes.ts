// THE REGISTER and THE GRILL — the bar tablet and the wall screen by the charbroiler (pages /crm/register, /crm/grill,
// /crm/closeout). Mounted at /api/register and /api/grill behind the bar_register feature.
//
//   GET    /register/state                  open checks, tonight's closed, the menu, the tax rate, my PIN / powers
//   GET    /register/check/:id              one check
//   POST   /register/check                  { kind, label, spot, note }
//   PATCH  /register/check/:id              { label, spot, note }
//   POST   /register/check/:id/items        { menuItemId | 'tap:<id>', sizeId, qty, note, seat, priceCents }
//   POST   /register/check/:id/send         { itemIds? }   coursing: send just these
//   POST   /register/check/:id/pay          { tender: cash | card_external | giftcard, amountCents, tipCents, cashTenderedCents, giftCardCode }
//   POST   /register/check/:id/giftcard     { amountCents, code? }   sell a gift card (issued when the check is paid)
//   POST   /register/check/:id/split        { itemIds, label }
//   POST   /register/check/:id/split-seats
//   POST   /register/check/:id/guest        { contactId | null }
//   POST   /register/check/:id/reward       { rewardId }   a Regulars reward (loyalty:redeem)
//   GET    /register/guests?q=              find a guest by phone, name or email (with their points)
//   POST   /register/guests                 { name, phone, email? }  add a regular (loyalty:enroll)
//   POST   /register/check/:id/void         { reason, managerPin? }   a manager's when anything was sent
//   PATCH  /register/item/:id               { qty, note, seat }       held items only
//   POST   /register/item/:id/void          { reason, managerPin? }   a manager's when it was sent
//   POST   /register/payment/:id/void       { reason, managerPin? }   always a manager's
//   GET    /register/day?day=YYYY-MM-DD     the night's summary, open checks, its close-outs
//   POST   /register/closeout               { day, floatCents, countedCents, note, force, managerPin? }
//   GET    /register/report?from=&to=       the nights from…to added up — the Reports page (reports:read)
//   PUT    /register/pin  { pin }  ·  DELETE /register/pin     my own till PIN
//   GET    /register/floor              the room, and each table's open check (bar:register)
//   GET    /register/clock  ·  POST /register/clock { pin }   who is on; clock in or out by your own till PIN (time_tracking)
//   PUT    /register/floor  { tables }  set the room (bar:update — the same as the menu and the hours)
//   GET    /grill/state  ·  POST /grill/bump { id }  ·  POST /grill/recall { id }
//
// Permissions (packages/tenant-backend/src/auth/permissions.ts): bar:register works the register and the grill
// (bartenders and up); bar:manage voids sent food, payments and checks and closes the night — a bartender can
// still do those with a manager's till PIN typed on the spot (barManagers.ts).
//
// Moved from templates/crm-bar/backend/src/routes/barRegister.ts. Every path, permission and feature as it was.
// Replies: an action's answer is { ok: true, … } as before; a refusal is { error, code? }. Where the template added
// fields to a refusal: "a manager has to OK this" carries code NEEDS_MANAGER (it was needsManager: true), and gift
// cards switched off carry code FEATURE_NOT_ENABLED without the feature id.
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { CheckError } from './barRegister.ts'
import { PinError, type Actor } from './barManagers.ts'
import { RotaError } from './barSchedule.ts'
import { LoyaltyError } from './barLoyalty.ts'
import { businessDayOf, businessDayWindow } from './barLive.ts'
import type { BarServices } from './services.ts'

type Ctx = any
const FEATURE = 'bar_register'
const body = async (c: Ctx): Promise<Record<string, any>> => c.req.json().catch(() => ({}))

export function createBarRegisterRoutes(d: CrmDeps, bar: BarServices) {
  const { audit, logger } = d
  const { requirePermission } = d.permissions
  const { requireEnabledFeature, isFeatureEnabled } = d.features
  const { actorOf, clearOwnPin, hasOwnPin, managerApproval, mayManage, setOwnPin } = bar.managers
  const {
    addGiftCardLine, addItem, addPayment, attachGuest, redeemReward, checkNeedsManager, getCheck, itemNeedsManager, listOpen, listRecentClosed,
    menuForRegister, openCheck, renameCheck, sendCheck, splitBySeat, splitItems, taxRateBps, updateItem, voidCheck, voidItem, voidPayment,
  } = bar.register
  const { bumpTicket, kitchenState, recallTicket } = bar.kitchen
  const { barTimezone, closeDay, closeoutsFor, loadDay, loadRange } = bar.reports
  const { floorFor, floorIsStarter, saveFloor } = bar.floor
  const { onTheClock, punchByPin } = bar.schedule
  const { addRegular, listRewards, loyaltyRunning, searchGuests } = bar.loyalty

  /** Run an action; a CheckError / PinError is a refusal the screen shows as-is, anything else a plain 500. */
  async function act(c: Ctx, fn: () => Promise<unknown>) {
    try {
      return one(c, { ok: true, ...(await fn() as object) })
    } catch (e: any) {
      if (e instanceof CheckError || e instanceof PinError) return fail(c, e.status as any, e.message)
      logger.error('[register]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  /** The name a manager-only action is recorded under, or the refusal that asks for a manager's PIN. */
  async function managerOr(c: Ctx, actor: Actor, b: Record<string, any>): Promise<{ byName: string } | Response> {
    const m = await managerApproval(actor, b.managerPin)
    return m.ok ? { byName: m.byName } : fail(c, 403, m.error, 'NEEDS_MANAGER')
  }

  // Gift cards on the register are the gift_cards feature's: switched off, a card can be neither sold nor spent.
  const giftCardsOn = (actor: Actor) => isFeatureEnabled(actor.companyId, ['gift_cards'])
  const giftCardsOff = (c: Ctx) => fail(c, 403, 'Gift cards are not switched on.', 'FEATURE_NOT_ENABLED')

  // ─── The register ────────────────────────────────────────────────────────────
  const registerRoutes = new Hono<AppEnv>()
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
    const regulars = await loyaltyRunning(actor.companyId)
    // The card reader: offered on the Pay screen only where it is switched on, a reader is registered and the business's
    // own Stripe account is connected. Otherwise Card is the old "run it on the reader, then record it" (card_external).
    const [readerOn, settings] = await Promise.all([isFeatureEnabled(actor.companyId, ['card_reader']), bar.food.read(actor.companyId)])
    const readers = readerOn && (await d.services.stripeService.connectedAccountFor(actor.companyId)) ? (await bar.terminal.listReaders(actor.companyId)).map((r) => ({ id: r.id, label: r.label, simulated: r.simulated })) : []
    return one(c, {
      serverNow: Date.now(), businessDay: night, open, recent, menu, taxRateBps: rate, giftCards: await giftCardsOn(actor),
      regulars: regulars ? { rewards: (await listRewards(actor.companyId, true)).map((x) => ({ id: x.id, name: x.name, pointsCost: x.pointsCost, type: x.type })) } : null,
      me: { name: actor.name, mayManage: manage, hasPin: pin },
      cardReader: { readers, tipping: settings.terminal.tipping },
      tabs: settings.tabs,
    })
  })

  registerRoutes.get('/check/:id', ...ring, async (c) => {
    const actor = await actorOf(c)
    return act(c, async () => ({ check: await getCheck(actor.companyId, c.req.param('id')) }))
  })
  registerRoutes.post('/check', ...ring, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    // Long tabs are the owner's choice (Register Settings): a restaurant or a truck rings walk-ups and tables.
    if (b.kind === 'tab' && !(await bar.food.read(actor.companyId)).tabs) return fail(c, 403, 'Tabs are switched off. Turn them on in Register Settings.')
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
    if (b.tender === 'giftcard' && !(await giftCardsOn(actor))) return giftCardsOff(c)
    return act(c, async () => { const { changeCents, giftCard, ...check } = await addPayment(actor, c.req.param('id'), b); return { check, changeCents, giftCard: giftCard || null } })
  })
  registerRoutes.post('/check/:id/giftcard', ...ring, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    if (!(await giftCardsOn(actor))) return giftCardsOff(c)
    return act(c, async () => ({ check: await addGiftCardLine(actor, c.req.param('id'), { amountCents: b.amountCents, code: b.code }) }))
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
    if (g === undefined) return fail(c, 400, 'Which guest?')
    return act(c, async () => ({ check: await attachGuest(actor, c.req.param('id'), g) }))
  })
  registerRoutes.post('/check/:id/reward', ...ring, requirePermission('loyalty:redeem'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    if (!b.rewardId) return fail(c, 400, 'Which reward?')
    return act(c, async () => ({ check: await redeemReward(actor, c.req.param('id'), String(b.rewardId)) }))
  })

  // ── Guests at the register ──
  registerRoutes.get('/guests', ...ring, requirePermission('contacts:read'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return one(c, { guests: await searchGuests(actor.companyId, c.req.query('q') || '') })
  })
  registerRoutes.post('/guests', ...ring, requireEnabledFeature('loyalty_rewards'), requirePermission('loyalty:enroll'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    try {
      return one(c, { ok: true, guest: await addRegular(actor.companyId, b, actor.name) })
    } catch (e: any) {
      if (e instanceof LoyaltyError) return fail(c, e.status as any, e.message)
      logger.error('[register] add regular', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
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
    // A manager reads the whole night; anyone else their own checkout (barReports.ts loadDay). The drawer is
    // the bar's, so the cash that should be in it is the whole night's either way: counting it needs the full figure.
    const manages = await mayManage(actor)
    const { summary, open, tz } = await loadDay(actor.companyId, day, manages ? undefined : actor.id)
    const drawerInCents = manages ? summary.cash.inCents : (await loadDay(actor.companyId, day)).summary.cash.inCents
    c.header('Cache-Control', 'no-store')
    return one(c, { day, timezone: tz, scope: manages ? 'night' : 'mine', summary, open, drawerInCents, closes: await closeoutsFor(actor.companyId, day), me: { mayManage: manages } })
  })
  // The Reports page: sales, tips and voids over a run of nights. reports:read (owner, admin, manager) — a bartender
  // keeps the night's close-out, not the business's takings over months.
  registerRoutes.get('/report', requireEnabledFeature(FEATURE), requirePermission('reports:read'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return act(c, async () => ({ report: await loadRange(actor.companyId, c.req.query('from') || '', c.req.query('to') || '') }))
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

  // ── The floor ──
  registerRoutes.get('/floor', ...ring, async (c) => {
    const actor = await actorOf(c)
    const [floor, open, starter] = await Promise.all([floorFor(actor.companyId), listOpen(actor.companyId), floorIsStarter(actor.companyId)])
    c.header('Cache-Control', 'no-store')
    // A table's open checks are the ones on its spot (a table can hold more than one after a split).
    const bySpot = (name: string) => open.filter((o) => (o.spot || o.label).toLowerCase() === name.toLowerCase())
    // starter: the room is still the starting layout (5 booths, 5 tables, 10 seats), so the screen says so (Bar Run 1).
    return one(c, { floor, starter, tables: floor.tables.map((t) => ({ ...t, checks: bySpot(t.name) })) })
  })
  registerRoutes.put('/floor', requireEnabledFeature(FEATURE), requirePermission('bar:update'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    try {
      const floor = await saveFloor(actor.companyId, b)
      audit.log({ req: c, action: 'update', entity: 'bar_settings', entityName: 'Floor', changes: { tables: floor.tables.length } })
      return one(c, { ok: true, floor })
    } catch (e: any) { return fail(c, 400, e?.message || 'That did not save.') }
  })

  // ── The time clock on the bar tablet: each person types their own PIN; the CRM's own clock records it ──
  registerRoutes.get('/clock', ...ring, requireEnabledFeature('time_tracking'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return one(c, { on: await onTheClock(actor.companyId), timezone: await barTimezone(actor.companyId) })
  })
  registerRoutes.post('/clock', ...ring, requireEnabledFeature('time_tracking'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    try {
      const r = await punchByPin(actor, b.pin)
      return one(c, { ok: true, ...r, on: await onTheClock(actor.companyId), timezone: await barTimezone(actor.companyId) })
    } catch (e: any) {
      if (e instanceof RotaError) return fail(c, e.status as any, e.message)
      logger.error('[register] clock', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
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
  const kitchenRoutes = new Hono<AppEnv>()

  kitchenRoutes.get('/state', ...ring, async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return one(c, await kitchenState(actor.companyId))
  })
  kitchenRoutes.post('/bump', ...ring, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    if (!b.id) return fail(c, 400, 'Which ticket?')
    return (await bumpTicket(actor.companyId, String(b.id), actor.name)) ? one(c, { ok: true }) : fail(c, 409, 'Already bumped.')
  })
  kitchenRoutes.post('/recall', ...ring, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    if (!b.id) return fail(c, 400, 'Which ticket?')
    return (await recallTicket(actor.companyId, String(b.id))) ? one(c, { ok: true }) : fail(c, 409, 'That ticket is already up.')
  })

  return { registerRoutes, kitchenRoutes }
}
