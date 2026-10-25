// Guests' own orders: the self-serve kiosk (and, below, the website's pickup orders). An order's lines are priced on
// the server from the menu as it is now (barRegister.ts priceOrderLine); the guest never sends a price.
//
// The kiosk: the guest builds an order, gives a name (or a table), and either pays on the card reader — the order
// becomes a PAID check and its food one grill ticket only when Stripe confirms the payment (barTerminal.ts →
// paidInTx) — or, where the owner allows it, pays at the counter: the order is then an open check on the register
// marked KIOSK, and its food goes to the grill when the counter takes the money (sendCheck refuses it before).
import { and, eq } from 'drizzle-orm'
import { barOrder } from '../../db/schema/index.ts'
import { checkTotals, taxRateBpsFrom } from './barCheckMoney.ts'
import { company } from '../../db/schema/index.ts'
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

export function createBarOrders(deps: { db: BarDb; register: BarRegister; food: FoodSettingsStore }) {
  const { db, register, food } = deps

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
        const c = await register.checkFromOrderInTx(tx, kiosk, { kind: 'kiosk', label: kioskLabel(name, table), spot: table ? `Table ${table}` : null, note: 'Pay at the counter', lines: priced.lines }, null)
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

  return { price, kioskMenu, placeKiosk, paidInTx, afterPaid, cancelKiosk, one, orderView, kioskLabel, onlineLabel }
}
export type BarOrders = ReturnType<typeof createBarOrders>
