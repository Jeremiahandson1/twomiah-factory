// /api/food — food service for staff: Register Settings, the card readers, a card payment on a reader, refunds and
// receipts. Mounted behind any of its features (the registry's door); each action keeps its own feature and permission.
//
//   GET    /settings                       the settings, the readers, and what is available here           bar:register
//   PUT    /settings                       { tabs, kiosk, ordering, delivery, tipping }                     bar:update
//   GET    /readers                        the readers, with Stripe's online/offline                        bar:register · card_reader
//   POST   /readers                        { code, label }   register a reader by the code it shows        bar:update · card_reader
//   DELETE /readers/:id                                                                                     bar:update · card_reader
//   POST   /terminal/charge                { checkId, readerId, amountCents }   send it to the reader        bar:register · card_reader
//   GET    /terminal/charge/:id            where it stands (Stripe is asked while it is pending)            bar:register · card_reader
//   POST   /terminal/charge/:id/cancel                                                                      bar:register · card_reader
//   POST   /terminal/tab                   { checkId, readerId, amountCents }   hold a card for a tab          bar:register · card_reader · bar_tab_preauth
//   GET    /terminal/tab?checkId=          the tab on a check (Stripe is asked while the reader waits)      bar:register · card_reader · bar_tab_preauth
//   POST   /terminal/tab/:id/close         { tipCents, partial }   take the check and the tip off the hold  bar:register · card_reader · bar_tab_preauth
//   POST   /terminal/tab/:id/release       give the card back; nothing is charged                           bar:register · card_reader · bar_tab_preauth
//   POST   /terminal/charge/:id/simulate   { outcome, tipCents }   a test card on a SIMULATED reader         bar:register · card_reader
//   POST   /payment/:id/refund             { amountCents?, reason }   back to the card through Stripe       bar:manage
//   GET    /check/:id/receipt              the receipt link (opened in a new tab to print)                  bar:register · bar_register
//   POST   /check/:id/receipt              { email?, phone? }   email or text the receipt link              bar:register · bar_register
//   POST   /kiosk/unlock                   { pin }   a manager's till PIN, always typed: starts / stops the kiosk  bar:register · order_kiosk
//   GET    /kiosk/state                    the kiosk's menu (sizes, add-ons), its settings, a reader or not  bar:register · order_kiosk
//   POST   /kiosk/order                    { lines, name, table, pay: reader | counter }                    bar:register · order_kiosk
//   GET    /kiosk/order/:id  ·  POST /kiosk/order/:id/cancel                                                 bar:register · order_kiosk
//   GET    /orders                         tonight's website and kiosk orders (Stripe asked about any unpaid)  bar:register · online_ordering
//   POST   /orders/:id/ready               the guest is told it is ready                                    bar:register · online_ordering
//   POST   /orders/:id/collected                                                                            bar:register · online_ordering
//
// Ringing and taking payment are bar:register (bartenders and up); refunds are bar:manage and settings bar:update
// (managers, admins and the owner) — permissions, never rank (packages/tenant-backend/src/auth/permissions.ts).
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { barTerminalCharge, company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one } from '../../http/reply.ts'
import { siteOrigin } from '../../site/render.ts'
import type { CrmDeps } from '../deps.ts'
import { TerminalError } from './barTerminal.ts'
import { CheckError } from './barRegister.ts'
import { applyFoodPatch, FoodSettingsError } from './foodSettings.ts'
import { businessDayOf, businessDayWindow } from './barLive.ts'
import type { BarServices } from './services.ts'

type Ctx = any
const body = async (c: Ctx): Promise<Record<string, any>> => c.req.json().catch(() => ({}))

export function createBarFoodRoutes(d: CrmDeps, bar: BarServices) {
  const { audit, logger } = d
  const { requirePermission } = d.permissions
  const { requireEnabledFeature, isFeatureEnabled } = d.features
  const { actorOf } = bar.managers
  const { food, terminal, receipts } = bar
  const app = new Hono<AppEnv>()

  async function act(c: Ctx, fn: () => Promise<unknown>) {
    try {
      return one(c, { ok: true, ...(await fn() as object) })
    } catch (e: any) {
      if (e instanceof TerminalError) return fail(c, e.status as any, e.message, e.code)
      if (e instanceof CheckError || e instanceof FoodSettingsError) return fail(c, e.status as any, e.message)
      if (typeof e?.status === 'number' && e.status < 500) return fail(c, e.status, e.message)
      logger.error('[food]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  const reader = [requireEnabledFeature('card_reader')] as const

  // ── Register Settings ──
  app.get('/settings', requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c)
    const [settings, readers, connected, on] = await Promise.all([
      food.read(actor.companyId), terminal.listReaders(actor.companyId),
      d.services.stripeService.connectedAccountFor(actor.companyId),
      Promise.all(['card_reader', 'order_kiosk', 'online_ordering'].map((f) => isFeatureEnabled(actor.companyId, f))),
    ])
    c.header('Cache-Control', 'no-store')
    return one(c, {
      settings: { ...settings, terminal: { tipping: settings.terminal.tipping, tabHoldHours: settings.terminal.tabHoldHours } },
      readers: on[0] ? readers : [],
      stripe: { platform: !!process.env.STRIPE_SECRET_KEY || !!d.services.testStripeClient, connected: !!connected },
      features: { cardReader: on[0], kiosk: on[1], onlineOrdering: on[2] },
      // Said plainly on the page: there is no offline mode with these readers (foodSettings.ts).
      offline: { available: false },
    })
  })
  app.put('/settings', requirePermission('bar:update'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => {
      let next = applyFoodPatch(await food.read(actor.companyId), b)
      next = await food.write(actor.companyId, next)
      if (b.tipping !== undefined) {
        if (!(await isFeatureEnabled(actor.companyId, 'card_reader'))) throw new FoodSettingsError('Switch the card reader on first.', 403)
        next = await terminal.setTipping(actor.companyId, !!b.tipping)
      }
      audit.log({ req: c, action: 'update', entity: 'bar_settings', entityName: 'Register settings', changes: { ...b } })
      return { settings: { ...next, terminal: { tipping: next.terminal.tipping } } }
    })
  })

  // ── Card readers ──
  app.get('/readers', ...reader, requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return act(c, async () => ({ readers: await terminal.listReaders(actor.companyId, true) }))
  })
  app.post('/readers', ...reader, requirePermission('bar:update'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => {
      const r = await terminal.registerReader(actor, { code: b.code, label: b.label })
      audit.log({ req: c, action: 'create', entity: 'bar_reader', entityId: r.id, entityName: r.label })
      return { reader: r }
    })
  })
  app.delete('/readers/:id', ...reader, requirePermission('bar:update'), async (c) => {
    const actor = await actorOf(c)
    try {
      await terminal.removeReader(actor, c.req.param('id'))
      audit.log({ req: c, action: 'delete', entity: 'bar_reader', entityId: c.req.param('id') })
      return done(c)
    } catch (e: any) {
      if (e instanceof TerminalError) return fail(c, e.status as any, e.message, e.code)
      throw e
    }
  })

  // ── A card payment on a reader ──
  app.post('/terminal/charge', ...reader, requireEnabledFeature('bar_register'), requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    if (!b.checkId) return fail(c, 400, 'Which check?')
    return act(c, async () => ({ charge: await terminal.startCharge(actor, { checkId: String(b.checkId), readerId: String(b.readerId || ''), amountCents: b.amountCents }) }))
  })
  app.get('/terminal/charge/:id', ...reader, requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return act(c, async () => ({ charge: await terminal.pollCharge(actor.companyId, c.req.param('id')) }))
  })
  app.post('/terminal/charge/:id/cancel', ...reader, requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c)
    return act(c, async () => ({ charge: await terminal.cancelCharge(actor, c.req.param('id')) }))
  })
  // A pre-authorised tab: the card is held on the reader, nothing is taken until the tab is closed (barTerminal.ts).
  const tab = [...reader, requireEnabledFeature('bar_register'), requireEnabledFeature('bar_tab_preauth'), requirePermission('bar:register')] as const
  app.post('/terminal/tab', ...tab, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => ({ charge: await terminal.startTab(actor, { checkId: String(b.checkId || ''), readerId: String(b.readerId || ''), amountCents: b.amountCents }) }))
  })
  app.get('/terminal/tab', ...tab, async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return act(c, async () => {
      const t = await terminal.tabFor(actor.companyId, String(c.req.query('checkId') || ''))
      return { tab: t && t.status === 'pending' ? await terminal.pollCharge(actor.companyId, t.id) : t }
    })
  })
  app.post('/terminal/tab/:id/close', ...tab, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => {
      const r = await terminal.closeTab(actor, c.req.param('id'), { tipCents: b.tipCents, partial: b.partial })
      audit.log({ req: c, action: 'update', entity: 'bar_check', entityId: r.charge.checkId || '', entityName: 'Tab closed', changes: { paidCents: r.paidCents, tipCents: r.tipCents, leftCents: r.leftCents } })
      return r
    })
  })
  // Parity row 14. The guest chooses the tip on the reader as the tab closes: a sale for the balance with on-reader tipping;
  // paid, the hold is released. Then a tab held by Tap to Pay on the phone (tap_to_pay as well): the hold is made here, the
  // phone collects the card, and the hold counts once Stripe confirms it. GET /tabs is the phone's list of open checks.
  app.post('/terminal/tab/:id/close-on-reader', ...tab, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => ({ charge: await terminal.closeTabOnReader(actor, c.req.param('id'), String(b.readerId || '')) }))
  })
  const phoneTab = [...tab, requireEnabledFeature('tap_to_pay')] as const
  app.post('/terminal/tab/phone', ...phoneTab, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, () => terminal.startPhoneTab(actor, { checkId: b.checkId, amountCents: b.amountCents }))
  })
  app.post('/terminal/tab/phone/:id/authorized', ...phoneTab, async (c) => {
    const actor = await actorOf(c)
    return act(c, async () => {
      const charge = await terminal.phoneTabAuthorized(actor, c.req.param('id'))
      if (charge.status === 'authorized') audit.log({ req: c, action: 'update', entity: 'bar_check', entityId: charge.checkId || '', entityName: 'Tab held on the phone', changes: { holdCents: charge.amountCents } })
      return { charge }
    })
  })
  // The stale-tab pass by hand (a manager; the hourly job runs the same): `now` lets a test move the clock.
  app.post('/terminal/tabs/sweep', ...tab, requirePermission('bar:update'), async (c) => {
    const b = await body(c)
    const now = b.now && !Number.isNaN(Date.parse(String(b.now))) ? new Date(String(b.now)) : new Date()
    return act(c, async () => ({ released: await terminal.releaseStaleTabs(now) }))
  })
  app.get('/tabs', ...tab, async (c) => { const actor = await actorOf(c); c.header('Cache-Control', 'no-store'); return act(c, async () => ({ checks: await terminal.openTabs(actor.companyId) })) })
  app.post('/terminal/tab/:id/release', ...tab, async (c) => {
    const actor = await actorOf(c)
    return act(c, async () => {
      const charge = await terminal.releaseTab(actor, c.req.param('id'))
      audit.log({ req: c, action: 'update', entity: 'bar_check', entityId: charge.checkId || '', entityName: 'Tab released' })
      return { charge }
    })
  })
  app.post('/terminal/charge/:id/simulate', ...reader, requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    const tip = Math.max(0, Math.round(Number(b.tipCents) || 0))
    return act(c, async () => ({ charge: await terminal.simulateCard(actor.companyId, c.req.param('id'), b.outcome === 'decline' ? 'decline' : 'approve', tip) }))
  })

  // ── Refunds: a manager's (bar:manage) ──
  app.post('/payment/:id/refund', requireEnabledFeature(['card_reader', 'online_ordering']), requirePermission('bar:manage'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => {
      const r = await terminal.refundPayment(actor, actor.name, c.req.param('id'), { amountCents: b.amountCents, reason: b.reason })
      audit.log({ req: c, action: 'update', entity: 'bar_check_payment', entityId: c.req.param('id'), entityName: `Check #${r.checkNumber}`, changes: { refundedCents: r.refundedCents, reason: String(b.reason || ''), by: actor.name } })
      return { refund: r, check: await bar.register.getCheck(actor.companyId, r.checkId) }
    })
  })

  // ── Receipts ──
  app.get('/check/:id/receipt', requireEnabledFeature('bar_register'), requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c)
    const check = await bar.register.getCheck(actor.companyId, c.req.param('id')).catch(() => null)
    if (!check) return fail(c, 404, 'That check is gone.')
    return one(c, { url: receipts.receiptPath(check.id) })
  })
  app.post('/check/:id/receipt', requireEnabledFeature('bar_register'), requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => ({ sent: await receipts.send(actor.companyId, c.req.param('id'), { email: b.email, phone: b.phone }, siteOrigin(c)) }))
  })

  // ── Online orders ──
  const ordersGate = [requireEnabledFeature(['online_ordering', 'order_kiosk']), requirePermission('bar:register')] as const
  app.get('/orders', ...ordersGate, async (c) => {
    const actor = await actorOf(c)
    await bar.orders.sweep(actor.companyId).catch(() => {})
    const tz = await bar.reports.barTimezone(actor.companyId)
    c.header('Cache-Control', 'no-store')
    return one(c, { orders: await bar.orders.listOrders(actor.companyId, businessDayWindow(businessDayOf(new Date(), tz), tz).from), timezone: tz })
  })
  app.post('/orders/:id/ready', ...ordersGate, async (c) => {
    const actor = await actorOf(c)
    return act(c, async () => ({ order: await bar.orders.markOrder(actor, c.req.param('id'), 'ready') }))
  })
  app.post('/orders/:id/collected', ...ordersGate, async (c) => {
    const actor = await actorOf(c)
    return act(c, async () => ({ order: await bar.orders.markOrder(actor, c.req.param('id'), 'collected') }))
  })

  // ── The kiosk ──
  const kiosk = [requireEnabledFeature('order_kiosk'), requirePermission('bar:register')] as const
  /** The reader the kiosk pays on: the first registered, where the card reader is on and Stripe connected. */
  async function kioskReader(companyId: string): Promise<string | null> {
    if (!(await isFeatureEnabled(companyId, 'card_reader')) || !(await d.services.stripeService.connectedAccountFor(companyId))) return null
    return (await terminal.listReaders(companyId))[0]?.id ?? null
  }
  app.post('/kiosk/unlock', ...kiosk, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    const m = await bar.managers.verifyManagerPin(actor, b.pin)
    if (!m.ok) return fail(c, 403, m.error, 'NEEDS_MANAGER')
    audit.log({ req: c, action: 'update', entity: 'bar_settings', entityName: 'Kiosk', changes: { [b.mode === 'stop' ? 'stopped' : 'started']: m.byName } })
    return one(c, { ok: true, by: m.byName })
  })
  app.get('/kiosk/state', ...kiosk, async (c) => {
    const actor = await actorOf(c)
    const [menu, s, reader, rate, co] = await Promise.all([
      bar.orders.kioskMenu(actor.companyId), food.read(actor.companyId), kioskReader(actor.companyId),
      bar.register.taxRateBps(actor.companyId), d.db.select({ name: company.name }).from(company).where(eq(company.id, actor.companyId)).limit(1),
    ])
    c.header('Cache-Control', 'no-store')
    const simulated = reader ? (await terminal.listReaders(actor.companyId)).find((r) => r.id === reader)?.simulated ?? false : false
    return one(c, { menu, kiosk: s.kiosk, reader: !!reader, readerSimulated: simulated, payAtCounter: s.kiosk.payAtCounter || !reader, taxRateBps: rate, businessName: co[0]?.name || '' })
  })
  app.post('/kiosk/order', ...kiosk, async (c) => {
    const actor = await actorOf(c); const b = await body(c)
    return act(c, async () => {
      const readerId = await kioskReader(actor.companyId)
      const order = await bar.orders.placeKiosk(actor, { lines: b.lines, name: b.name, table: b.table, pay: b.pay, haveReader: !!readerId })
      if (order.status !== 'awaiting_payment') return { order, charge: null }
      try {
        const charge = await terminal.startCharge({ ...actor, name: 'Kiosk' }, { orderId: order.id, readerId: readerId! })
        return { order, charge }
      } catch (e) {
        await bar.orders.cancelKiosk(actor.companyId, order.id)
        throw e
      }
    })
  })
  app.get('/kiosk/order/:id', ...kiosk, async (c) => {
    const actor = await actorOf(c)
    const o = await bar.orders.one(actor.companyId, c.req.param('id'))
    c.header('Cache-Control', 'no-store')
    return o ? one(c, { order: bar.orders.orderView(o) }) : fail(c, 404, 'That order is gone.')
  })
  app.post('/kiosk/order/:id/cancel', ...kiosk, async (c) => {
    const actor = await actorOf(c); const id = c.req.param('id')
    return act(c, async () => {
      // The card on the reader first: if Stripe says it already went through, the order is paid, not cancelled.
      const [pending] = await d.db.select({ id: barTerminalCharge.id }).from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, actor.companyId), eq(barTerminalCharge.orderId, id), eq(barTerminalCharge.status, 'pending'))).limit(1)
      if (pending) await terminal.cancelCharge({ ...actor, name: 'Kiosk' }, pending.id)
      return { order: await bar.orders.cancelKiosk(actor.companyId, id) }
    })
  })

  return app
}
