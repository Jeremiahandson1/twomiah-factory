// Guests' own orders: the self-serve kiosk (and, below, the website's pickup orders). An order's lines are priced on
// the server from the menu as it is now (barRegister.ts priceOrderLine); the guest never sends a price.
//
// The kiosk: the guest builds an order, gives a name (or a table), and either pays on the card reader — the order
// becomes a PAID check and its food one grill ticket only when Stripe confirms the payment (barTerminal.ts →
// paidInTx) — or, where the owner allows it, pays at the counter: the order is then an open check on the register
// marked KIOSK, and its food goes to the grill when the counter takes the money (sendCheck refuses it before).
//
// The website (pickup): the business's open hours are the KITCHEN's (Bar Settings, and the Tonight switch), less the
// owner's lead time; a pause switch stops orders at once. The guest pays on a Stripe Checkout page on the business's
// own connected account; the order becomes a paid check and one grill ticket when Stripe says the session is paid —
// read back from Stripe when the guest returns, and swept from the Orders screen and the grill for a guest who never
// came back. "Order received" goes then; "Ready for pickup" when staff mark it ready — a text only to a number that
// ticked "Text me about my order" and has not opted out, else an email.
import Stripe from 'stripe'
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import { barOrder } from '../../db/schema/index.ts'
import { checkTotals, formatMoney, taxRateBpsFrom } from './barCheckMoney.ts'
import { company } from '../../db/schema/index.ts'
import type { BarLive } from './barLive.ts'
import { DELIVERY_NAMES } from './foodSettings.ts'
import type { BarDb } from './db.ts'
import type { Actor } from './barManagers.ts'
import { CheckError, type BarRegister, type OrderLine } from './barRegister.ts'
import type { FoodSettingsStore } from './foodSettings.ts'

type Tx = any
export const MAX_ORDER_LINES = 40

const clean = (v: unknown, max: number) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }

export interface OrderView {
  id: string; channel: string; status: string; number: number | null; name: string | null; tableLabel: string | null
  lines: OrderLine[]; subtotalCents: number; taxCents: number; totalCents: number; checkId: string | null
  pickupAt: string | null; createdAt: string; paidAt: string | null; readyAt: string | null; collectedAt: string | null
  phone: string | null; email: string | null
}
export const orderView = (o: typeof barOrder.$inferSelect): OrderView => ({
  id: o.id, channel: o.channel, status: o.status, number: o.number, name: o.name, tableLabel: o.tableLabel,
  lines: (Array.isArray(o.lines) ? o.lines : []) as OrderLine[], subtotalCents: o.subtotalCents, taxCents: o.taxCents, totalCents: o.totalCents,
  checkId: o.checkId, pickupAt: o.pickupAt ? o.pickupAt.toISOString() : null, createdAt: o.createdAt.toISOString(),
  paidAt: o.paidAt ? o.paidAt.toISOString() : null, readyAt: o.readyAt ? o.readyAt.toISOString() : null, collectedAt: o.collectedAt ? o.collectedAt.toISOString() : null,
  phone: o.phone, email: o.email,
})

export function createBarOrders(deps: {
  db: BarDb; register: BarRegister; food: FoodSettingsStore
  live?: BarLive
  stripe?: () => Stripe | null
  connectedAccountFor?: (companyId: string) => Promise<string | null>
  isFeatureEnabled?: (companyId: string, f: string) => Promise<boolean>
  sendEmail?: (m: { to: string; subject: string; html: string; fromName?: string }) => Promise<unknown>
  sendText?: (companyId: string, to: string, message: string) => Promise<{ sent: boolean; why?: string }>
  mayText?: (companyId: string, phone: string) => Promise<boolean>
  recordConsent?: (companyId: string, phone: string, ip: string | null) => Promise<unknown>
  logger?: { warn: (m: string, x?: unknown) => void; error: (m: string, x?: unknown) => void }
  now?: () => Date
}) {
  const { db, register, food } = deps
  const now = deps.now ?? (() => new Date())

  async function taxRate(companyId: string, tx: Tx = db) {
    const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return taxRateBpsFrom(co?.settings)
  }

  /** The guest's lines, priced now, and the order's totals by the register's own arithmetic. */
  async function price(companyId: string, input: unknown, tx: Tx = db) {
    if (!Array.isArray(input) || !input.length) throw new CheckError('Add something to the order first.')
    if (input.length > MAX_ORDER_LINES) throw new CheckError('That is a big order. Order the rest at the counter.')
    const lines: OrderLine[] = []
    for (const l of input) lines.push(await register.priceOrderLine(tx, companyId, l || {}))
    const rate = await taxRate(companyId, tx)
    const t = checkTotals(lines.map((l) => ({ qty: l.qty, unitPriceCents: l.unitPriceCents, state: 'held', kind: 'item' })), [], rate)
    if (t.totalCents < 50) throw new CheckError('An order is at least $0.50.')
    return { lines, rate, subtotalCents: t.subtotalCents, taxCents: t.taxCents, totalCents: t.totalCents }
  }

  /** What the kiosk shows: the menu with a price on every size (open-price items and the taps stay at the counter). */
  async function kioskMenu(companyId: string) {
    const menu = await register.menuForRegister(companyId)
    return menu.filter((s) => s.id !== 'taps').map((s) => ({
      ...s,
      items: s.items.filter((i) => i.sizes.length && i.sizes.every((z) => z.priceCents !== null)),
    })).filter((s) => s.items.length)
  }

  /** The kiosk's check name: "KIOSK · Pat", "KIOSK · Table 4 · Pat". */
  const kioskLabel = (name: string | null, table: string | null) => ['KIOSK', table ? `Table ${table}` : null, name].filter(Boolean).join(' · ')

  async function placeKiosk(actor: Actor, input: { lines?: unknown; name?: unknown; table?: unknown; pay?: unknown; haveReader: boolean }) {
    const companyId = actor.companyId
    const s = await food.read(companyId)
    const name = clean(input.name, 30)
    const table = clean(input.table, 10)
    if (!name && !(s.kiosk.askTable && table)) throw new CheckError('Type your name so we can call you.')
    const pay = input.pay === 'counter' ? 'counter' : 'reader'
    if (pay === 'counter' && !(s.kiosk.payAtCounter || !input.haveReader)) throw new CheckError('Pay on the card reader, please.', 409)
    if (pay === 'reader' && !input.haveReader) throw new CheckError('The card reader is not set up. Pay at the counter.', 409)
    const priced = await price(companyId, input.lines)
    const kiosk: Actor = { ...actor, name: 'Kiosk' }
    const id = await db.transaction(async (tx: Tx) => {
      const [o] = await tx.insert(barOrder).values({
        companyId, channel: 'kiosk', status: pay === 'counter' ? 'at_counter' : 'awaiting_payment', name, tableLabel: table,
        lines: priced.lines, subtotalCents: priced.subtotalCents, taxCents: priced.taxCents, totalCents: priced.totalCents, taxRateBps: priced.rate,
      }).returning({ id: barOrder.id })
      if (pay === 'counter') {
        // No "Pay at the counter" note: a check's note rides onto its grill ticket, and a kiosk order only reaches the
        // grill once it is paid, so the ticket read "Pay at the counter" in red after the money was taken (bistro, 10/25).
        const c = await register.checkFromOrderInTx(tx, kiosk, { kind: 'kiosk', label: kioskLabel(name, table), spot: table ? `Table ${table}` : null, note: null, lines: priced.lines }, null)
        await tx.update(barOrder).set({ checkId: c.checkId, number: c.number, updatedAt: new Date() }).where(eq(barOrder.id, o.id))
      }
      return o.id as string
    })
    if (pay === 'counter') register.notifyRegister(companyId)
    return orderView((await one(companyId, id))!)
  }

  async function one(companyId: string, id: string) {
    const [o] = await db.select().from(barOrder).where(and(eq(barOrder.id, String(id || '')), eq(barOrder.companyId, companyId))).limit(1)
    return o || null
  }

  /**
   * A CONFIRMED payment for an order waiting to be paid: the paid check (its food fired to the grill) and the order
   * received — inside the caller's transaction, with the order row already locked by it.
   */
  async function paidInTx(tx: Tx, o: typeof barOrder.$inferSelect, payment: { tender: 'card_terminal' | 'card_online'; amountCents: number; tipCents: number; paymentIntentId: string; stripeAccount: string | null }, by?: Actor) {
    const actor: Actor = by ?? { id: '', name: o.channel === 'kiosk' ? 'Kiosk' : 'Website', companyId: o.companyId, role: 'field' }
    const label = o.channel === 'kiosk' ? kioskLabel(o.name, o.tableLabel) : onlineLabel(o)
    const c = await register.checkFromOrderInTx(tx, actor, { kind: o.channel === 'kiosk' ? 'kiosk' : 'online', label, spot: o.tableLabel ? `Table ${o.tableLabel}` : null, note: o.channel === 'online' ? 'Pickup' : null, lines: (o.lines as OrderLine[]) }, {
      tender: payment.tender, amountCents: payment.amountCents, tipCents: payment.tipCents, providerPaymentId: payment.paymentIntentId, stripeAccount: payment.stripeAccount,
    })
    await tx.update(barOrder).set({ status: 'received', checkId: c.checkId, number: c.number, paidAt: new Date(), paymentIntentId: payment.paymentIntentId, stripeAccount: payment.stripeAccount, updatedAt: new Date() }).where(eq(barOrder.id, o.id))
    return { checkId: c.checkId, fired: c.fired }
  }

  /** "Online · Pat" — the website order's check and grill ticket. */
  const onlineLabel = (o: { name: string | null }) => ['Online', o.name].filter(Boolean).join(' · ')

  /** After it is paid: the grill and the registers hear of it (online orders also tell the guest — see below). */
  async function afterPaid(companyId: string, _orderId: string, fired: boolean) {
    register.afterCardPayment(companyId, fired)
  }

  /** The guest walked away from the kiosk before paying: the order is cancelled (a pending card payment is the route's). */
  async function cancelKiosk(companyId: string, id: string) {
    await db.update(barOrder).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(barOrder.id, String(id || '')), eq(barOrder.companyId, companyId), eq(barOrder.status, 'awaiting_payment')))
    const o = await one(companyId, id)
    return o ? orderView(o) : null
  }

  // ─── The website: pickup orders ─────────────────────────────────────────────────────────────────────────────
  const fmtTime = (d: Date, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d)

  /**
   * Can the website take an order now, and for when. Open = the feature on, Stripe on this server and the business's
   * account connected, not paused, the kitchen open now and still open after the lead time. The pickup times are the
   * soonest (now + lead, to the next 5 minutes) and every 15 minutes after it while the kitchen is open.
   */
  async function availability(companyId: string) {
    const s = await food.read(companyId)
    const delivery = [
      s.delivery.doordashUrl ? { company: 'doordash', name: DELIVERY_NAMES.doordash, url: s.delivery.doordashUrl } : null,
      s.delivery.ubereatsUrl ? { company: 'ubereats', name: DELIVERY_NAMES.ubereats, url: s.delivery.ubereatsUrl } : null,
    ].filter(Boolean) as Array<{ company: string; name: string; url: string }>
    const base = { delivery, leadMinutes: s.ordering.leadMinutes, slots: [] as Array<{ at: string; label: string }>, timezone: 'America/Chicago' }
    const feature = deps.isFeatureEnabled ? await deps.isFeatureEnabled(companyId, 'online_ordering') : false
    if (!feature) return { ...base, offered: false, open: false, reason: 'Online ordering is not available.' }
    const stripeReady = !!deps.stripe?.() && !!(deps.connectedAccountFor && await deps.connectedAccountFor(companyId))
    if (!stripeReady) return { ...base, offered: true, open: false, reason: 'Online ordering is not set up yet. Call us or come in to order.' }
    if (s.ordering.paused) return { ...base, offered: true, open: false, reason: 'We are not taking online orders right now. Call us or come in to order.' }
    const at = now()
    const live = deps.live ? await deps.live.buildLiveState(companyId, at) : null
    const tz = live?.timezone || base.timezone
    if (!live || !live.kitchen.isOpen) return { ...base, timezone: tz, offered: true, open: false, reason: `The kitchen is closed.${live?.kitchen.short ? ' It ' + live.kitchen.short + '.' : ''}` }
    const closes = live.kitchen.closesAt ? new Date(live.kitchen.closesAt) : null
    const step = 5 * 60_000
    const soonest = new Date(Math.ceil((at.getTime() + s.ordering.leadMinutes * 60_000) / step) * step)
    if (closes && soonest.getTime() > closes.getTime()) return { ...base, timezone: tz, offered: true, open: false, reason: 'The kitchen is about to close, so online orders have stopped for tonight.' }
    const slots: Array<{ at: string; label: string }> = [{ at: soonest.toISOString(), label: `As soon as possible (about ${fmtTime(soonest, tz)})` }]
    for (let t = Math.ceil(soonest.getTime() / (15 * 60_000)) * 15 * 60_000 + 15 * 60_000; slots.length < 16 && (!closes || t <= closes.getTime()); t += 15 * 60_000) {
      slots.push({ at: new Date(t).toISOString(), label: fmtTime(new Date(t), tz) })
    }
    return { ...base, timezone: tz, offered: true, open: true, reason: null as string | null, slots }
  }

  /** The menu the website orders from: the kiosk's (priced sizes, add-ons; no taps, no open prices). */
  const onlineMenu = (companyId: string) => kioskMenu(companyId)

  /**
   * Place a website order and make its Stripe Checkout page on the business's own account. The lines are priced here;
   * the pickup time must be one the kitchen can still make. The page's address is where the guest comes back.
   */
  async function placeOnline(companyId: string, input: { lines?: unknown; name?: unknown; phone?: unknown; email?: unknown; textOk?: unknown; pickupAt?: unknown }, origin: string, ip: string | null) {
    const a = await availability(companyId)
    if (!a.open) throw new CheckError(a.reason || 'Online ordering is closed.', 409)
    const name = clean(input.name, 40)
    if (!name) throw new CheckError('Your name, please, for the order.')
    const email = clean(input.email, 200)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CheckError('That email address does not look right.')
    const phone = clean(input.phone, 30)
    if (phone && phone.replace(/\D/g, '').length < 10) throw new CheckError('That phone number does not look right.')
    if (!email && !phone) throw new CheckError('A phone number or an email, so we can tell you when it is ready.')
    const textOk = input.textOk === true || input.textOk === 'yes' || input.textOk === 'on'
    if (textOk && !phone) throw new CheckError('Add a mobile number for the texts.')
    const slot = a.slots.find((s) => s.at === String(input.pickupAt || '')) || (input.pickupAt ? null : a.slots[0])
    if (!slot) throw new CheckError('Pick a pickup time from the list.', 409)
    const priced = await price(companyId, input.lines)
    const stripe = deps.stripe!()!
    const acct = (await deps.connectedAccountFor!(companyId))!
    const [o] = await db.insert(barOrder).values({
      companyId, channel: 'online', status: 'awaiting_payment', name, phone, email, textOk, pickupAt: new Date(slot.at),
      lines: priced.lines, subtotalCents: priced.subtotalCents, taxCents: priced.taxCents, totalCents: priced.totalCents, taxRateBps: priced.rate, stripeAccount: acct,
    }).returning()
    if (textOk && phone && deps.recordConsent) await deps.recordConsent(companyId, phone, ip)
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const site = origin.replace(/\/+$/, '')
    let session: any
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          ...priced.lines.map((l) => ({ quantity: l.qty, price_data: { currency: 'usd', unit_amount: l.unitPriceCents, product_data: { name: (l.name + (l.size ? ` (${l.size})` : '')).slice(0, 250), ...(l.note ? { description: l.note.slice(0, 250) } : {}) } } })),
          ...(priced.taxCents > 0 ? [{ quantity: 1, price_data: { currency: 'usd', unit_amount: priced.taxCents, product_data: { name: 'Sales tax' } } }] : []),
        ],
        ...(email ? { customer_email: email } : {}),
        success_url: `${site}/order/done?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/order`,
        metadata: { twomiah_order: o.id, twomiah_company: companyId },
        payment_intent_data: { description: `Pickup order · ${name} · ${co?.name || ''}`.slice(0, 200), metadata: { twomiah_order: o.id } },
      }, { stripeAccount: acct })
    } catch (e: any) {
      await db.update(barOrder).set({ status: 'cancelled', cancelledAt: new Date() }).where(eq(barOrder.id, o.id))
      deps.logger?.error('[orders] checkout', { error: e?.message || String(e) })
      throw new CheckError('The payment page did not open. Try again in a minute.', 502)
    }
    await db.update(barOrder).set({ stripeSessionId: session.id, updatedAt: new Date() }).where(eq(barOrder.id, o.id))
    return { url: String(session.url), orderId: o.id }
  }

  /**
   * Stripe's word on a website order's Checkout Session: paid → the paid check, its grill ticket and "Order received",
   * once (the order row is locked; a second look finds it received). Unpaid → left as it is.
   */
  async function confirmSession(companyId: string, sessionId: string) {
    const [o] = await db.select().from(barOrder).where(and(eq(barOrder.companyId, companyId), eq(barOrder.stripeSessionId, String(sessionId || '')))).limit(1)
    if (!o) return null
    if (o.status !== 'awaiting_payment') return orderView(o)
    const stripe = deps.stripe?.()
    if (!stripe) return orderView(o)
    let s: any
    try { s = await stripe.checkout.sessions.retrieve(o.stripeSessionId!, {}, o.stripeAccount ? { stripeAccount: o.stripeAccount } : undefined) } catch { return orderView(o) }
    if (s?.payment_status !== 'paid') return orderView(o)
    const paid = Number(s.amount_total ?? o.totalCents)
    let fired = false, done = false
    await db.transaction(async (tx: Tx) => {
      const [locked] = await tx.select().from(barOrder).where(eq(barOrder.id, o.id)).limit(1).for('update')
      if (!locked || locked.status !== 'awaiting_payment') return
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id || s.id
      const r = await paidInTx(tx, locked, { tender: 'card_online', amountCents: paid, tipCents: 0, paymentIntentId: pi, stripeAccount: locked.stripeAccount })
      fired = r.fired; done = true
    })
    if (done) { register.afterCardPayment(companyId, fired); await notify(companyId, o.id, 'received') }
    return orderView((await one(companyId, o.id))!)
  }

  // A guest who paid and never came back: the Orders screen and the grill look for them, at most every 20 seconds.
  const lastSweep = new Map<string, number>()
  async function sweep(companyId: string) {
    const t = Date.now()
    if (t - (lastSweep.get(companyId) || 0) < 20_000) return
    lastSweep.set(companyId, t)
    const waiting = await db.select({ id: barOrder.stripeSessionId }).from(barOrder)
      .where(and(eq(barOrder.companyId, companyId), eq(barOrder.channel, 'online'), eq(barOrder.status, 'awaiting_payment'), isNotNull(barOrder.stripeSessionId), gte(barOrder.createdAt, new Date(t - 3 * 3600_000))))
      .orderBy(desc(barOrder.createdAt)).limit(10)
    for (const w of waiting) { try { await confirmSession(companyId, w.id!) } catch (e: any) { deps.logger?.warn('[orders] sweep', { error: e?.message || String(e) }) } }
  }

  /** "Order received" / "Ready for pickup": a text where the guest asked for texts (and has not opted out), else email. */
  async function notify(companyId: string, orderId: string, kind: 'received' | 'ready') {
    const o = await one(companyId, orderId)
    if (!o) return
    const [co] = await db.select({ name: company.name, phone: company.phone, address: company.address, city: company.city }).from(company).where(eq(company.id, companyId)).limit(1)
    const tz = deps.live ? (await deps.live.hoursFor(companyId)).timezone! : 'America/Chicago'
    const biz = co?.name || 'We'
    const when = o.pickupAt ? fmtTime(o.pickupAt, tz) : null
    const words = kind === 'received'
      ? `${biz}: thanks${o.name ? ', ' + o.name : ''}! Order #${o.number} is in${when ? ` for pickup about ${when}` : ''}. We will tell you when it is ready.`
      : `${biz}: order #${o.number}${o.name ? ' for ' + o.name : ''} is ready for pickup${co?.address ? ' at ' + co.address : ''}.`
    let told = false
    if (o.textOk && o.phone && deps.sendText && deps.mayText && await deps.mayText(companyId, o.phone)) {
      const r = await deps.sendText(companyId, o.phone, words + ' Reply STOP to opt out.')
      told = r.sent
    }
    if (!told && o.email && deps.sendEmail) {
      const items = (o.lines as OrderLine[]).map((l) => `<li>${l.qty} × ${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? ' — ' + esc(l.note) : ''}</li>`).join('')
      const html = `<p>${esc(words)}</p>${kind === 'received' ? `<ul>${items}</ul><p>Total paid: ${formatMoney(o.totalCents)}</p>` : ''}${co?.phone ? `<p>Questions? Call ${esc(co.phone)}.</p>` : ''}`
      try { await deps.sendEmail({ to: o.email, subject: kind === 'received' ? `Order #${o.number} received — ${biz}` : `Order #${o.number} is ready for pickup — ${biz}`, html, fromName: biz }); told = true } catch { told = false }
    }
    await db.update(barOrder).set(kind === 'received' ? { receivedNotifiedAt: told ? new Date() : null } : { readyNotifiedAt: told ? new Date() : null }).where(eq(barOrder.id, o.id))
  }
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))

  /** The Orders screen: tonight's paid website and kiosk orders, newest first. */
  async function listOrders(companyId: string, since: Date) {
    const rows = await db.select().from(barOrder).where(and(eq(barOrder.companyId, companyId), inArray(barOrder.status, ['received', 'ready', 'collected', 'at_counter']), gte(barOrder.createdAt, since)))
      .orderBy(desc(barOrder.createdAt)).limit(200)
    return rows.map(orderView)
  }

  /** Staff mark it ready (the guest is told) or collected. */
  async function markOrder(actor: Actor, id: string, to: 'ready' | 'collected') {
    const o = await one(actor.companyId, id)
    if (!o) throw new CheckError('That order is gone.', 404)
    if (to === 'ready' && o.status !== 'received') throw new CheckError(o.status === 'ready' ? 'Already marked ready.' : 'Only a paid order waiting to be made can be marked ready.', 409)
    if (to === 'collected' && !(o.status === 'received' || o.status === 'ready')) throw new CheckError('That order is not waiting to be picked up.', 409)
    const [row] = await db.update(barOrder).set(to === 'ready' ? { status: 'ready', readyAt: new Date(), readyByName: actor.name, updatedAt: new Date() } : { status: 'collected', collectedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(barOrder.id, o.id), eq(barOrder.status, o.status))).returning()
    if (!row) throw new CheckError('Someone else just changed that order. Look again.', 409)
    if (to === 'ready' && o.channel === 'online') await notify(actor.companyId, o.id, 'ready')
    return orderView((await one(actor.companyId, o.id))!)
  }

  return { price, kioskMenu, placeKiosk, paidInTx, afterPaid, cancelKiosk, one, orderView, kioskLabel, onlineLabel, availability, onlineMenu, placeOnline, confirmSession, sweep, notify, listOrders, markOrder }
}
export type BarOrders = ReturnType<typeof createBarOrders>
