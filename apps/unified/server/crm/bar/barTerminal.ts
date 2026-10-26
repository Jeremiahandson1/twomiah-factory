// The card reader: Stripe Terminal's SERVER-DRIVEN integration (stripe.com/docs/terminal/payments/setup-integration?
// terminal-sdk-platform=server-driven), every call on the business's own connected Stripe account — the one Settings ›
// Integrations connected (payments/stripe.ts connectedAccountFor) — so the money lands in the business's Stripe, never
// the platform's.
//
//   registerReader   a Location for the business (made once, from its address), then the reader by the code it shows
//   startCharge      a card_present PaymentIntent for the amount → process_payment_intent on the reader → a pending row
//   pollCharge       Stripe's word: the PaymentIntent succeeded (captured here when the reader authorised it) → the
//                    check's payment is written, once; the reader's action failed → declined; too long → timed out
//   cancelCharge     cancel_action on the reader and cancel the PaymentIntent — unless it already went through
//   refundPayment    a refund of a reader (or website) payment, back through Stripe, then recorded
//
// Nothing is recorded on a check until Stripe says the PaymentIntent succeeded. A reader payment arrives at the check
// through recordCardInTx (barRegister.ts), whose provider id is unique per company: polled twice, written once.
// Offline payments: the server-driven flow cannot take a card while the reader is offline (Stripe offers offline
// collection only to its mobile SDKs), so there is no offline mode — foodSettings.ts says why.
import Stripe from 'stripe'
import { and, eq, inArray } from 'drizzle-orm'
import { barCheck, barCheckPayment, barOrder, barReader, barTerminalCharge, company } from '../../db/schema/index.ts'
import type { BarDb } from './db.ts'
import type { Actor } from './barManagers.ts'
import type { BarRegister } from './barRegister.ts'
import type { BarLoyalty } from './barLoyalty.ts'
import type { FoodSettingsStore } from './foodSettings.ts'
import { platformStripe } from '../platformStripe.ts'

type Tx = any

export class TerminalError extends Error { constructor(message: string, public status = 400, public code?: string) { super(message) } }

/** A reader payment still waiting this long is given up: the reader's action is cancelled, the PaymentIntent too. */
export const CHARGE_TIMEOUT_MS = 3 * 60_000
/** On-reader tip suggestions (Stripe Terminal configuration tipping). */
export const TIP_PERCENTAGES = [15, 18, 20]

/** The platform's Stripe client (STRIPE_SECRET_KEY), over fetch; null when the key is not set. A test may hand one in.
 *  The one client the store's checkout uses too (../platformStripe.ts). */
export function terminalStripe(testClient?: unknown): Stripe | null {
  return platformStripe(testClient)
}

/** Stripe's own sentence for a refusal, for the person at the register; anything else a plain one. */
function stripeSays(e: any, fallback: string): string {
  const m = typeof e?.raw?.message === 'string' ? e.raw.message : typeof e?.message === 'string' && e?.type ? e.message : ''
  return m ? String(m).slice(0, 300) : fallback
}

export interface ChargeView {
  id: string; status: string; failure: string | null; amountCents: number; tipCents: number
  checkId: string | null; orderId: string | null; readerId: string; readerLabel: string | null; paymentId: string | null; createdAt: string
}

export function createBarTerminal(deps: {
  db: BarDb
  register: BarRegister
  loyalty: BarLoyalty
  food: FoodSettingsStore
  connectedAccountFor: (companyId: string) => Promise<string | null>
  stripe?: () => Stripe | null
  /** A kiosk order paid on the reader becomes its paid check here (barOrders.ts); set once the orders service is made. */
  onOrderPaid?: (tx: Tx, order: typeof barOrder.$inferSelect, payment: { amountCents: number; tipCents: number; paymentIntentId: string; stripeAccount: string | null }) => Promise<{ checkId: string; fired: boolean }>
  afterOrderPaid?: (companyId: string, orderId: string, fired: boolean) => Promise<void>
  now?: () => number
}) {
  const { db, register, loyalty, food, connectedAccountFor } = deps
  const stripeOf = deps.stripe ?? (() => terminalStripe())
  const now = deps.now ?? (() => Date.now())

  /** The client and the business's account, or the refusal that says what is missing. */
  async function account(companyId: string): Promise<{ stripe: Stripe; acct: string; opts: { stripeAccount: string } }> {
    const stripe = stripeOf()
    if (!stripe) throw new TerminalError('Card readers are not available on this server yet. Take cash, or record a card run on another machine.', 503, 'STRIPE_NOT_CONFIGURED')
    const acct = await connectedAccountFor(companyId)
    if (!acct) throw new TerminalError('Connect your Stripe account first (Settings › Integrations), then add the reader.', 409, 'STRIPE_NOT_CONNECTED')
    return { stripe, acct, opts: { stripeAccount: acct } }
  }

  // ─── Readers ───────────────────────────────────────────────────────────────────────────────────────────────
  async function listReaders(companyId: string, live = false) {
    const rows = await db.select().from(barReader).where(eq(barReader.companyId, companyId)).orderBy(barReader.createdAt)
    if (!live || !rows.length) return rows.map((r) => ({ ...view(r), status: null as string | null }))
    // Each reader's online/offline as Stripe sees it now; a reader Stripe cannot answer for shows as unknown.
    const stripe = stripeOf()
    return Promise.all(rows.map(async (r) => {
      let status: string | null = null
      if (stripe && r.stripeAccount) {
        try { status = String((await stripe.terminal.readers.retrieve(r.stripeReaderId, {}, { stripeAccount: r.stripeAccount }) as any).status || '') || null } catch { status = null }
      }
      return { ...view(r), status }
    }))
  }
  const view = (r: typeof barReader.$inferSelect) => ({
    id: r.id, label: r.label, deviceType: r.deviceType, serialNumber: r.serialNumber, simulated: String(r.deviceType || '').startsWith('simulated'), createdAt: r.createdAt.toISOString(),
  })

  /** The business's Stripe Terminal Location: made once from its address (Stripe requires one per reader). */
  async function ensureLocation(companyId: string, stripe: Stripe, acct: string): Promise<string> {
    const s = await food.read(companyId)
    if (s.terminal.locationId && s.terminal.locationAccount === acct) return s.terminal.locationId
    const [co] = await db.select({ name: company.name, address: company.address, city: company.city, state: company.state, zip: company.zip }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!co?.address || !co.city || !co.state || !co.zip) throw new TerminalError('Stripe needs the business address for a card reader. Add it in Settings › Company, then add the reader again.', 409, 'ADDRESS_NEEDED')
    let loc: any
    try {
      loc = await stripe.terminal.locations.create({ display_name: co.name.slice(0, 100), address: { line1: co.address, city: co.city, state: co.state, postal_code: co.zip, country: 'US' } }, { stripeAccount: acct })
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not take the business address. Check it in Settings › Company.'), 400) }
    let configurationId = s.terminal.configurationId
    if (s.terminal.tipping) configurationId = await tippingConfiguration(stripe, acct, loc.id, configurationId)
    await food.write(companyId, { ...s, terminal: { ...s.terminal, locationId: loc.id, locationAccount: acct, configurationId } })
    return loc.id
  }

  /** On-reader tipping: a Terminal configuration with tip suggestions, set on the business's location. */
  async function tippingConfiguration(stripe: Stripe, acct: string, locationId: string, existing: string | null): Promise<string> {
    let id = existing
    if (!id) {
      const cfg: any = await stripe.terminal.configurations.create({ tipping: { usd: { percentages: TIP_PERCENTAGES } } } as any, { stripeAccount: acct })
      id = cfg.id as string
    }
    await stripe.terminal.locations.update(locationId, { configuration_overrides: id } as any, { stripeAccount: acct })
    return id as string
  }

  async function registerReader(actor: Actor, input: { code?: unknown; label?: unknown }) {
    const code = String(input.code ?? '').trim()
    const label = String(input.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Card reader'
    if (!code || code.length > 100) throw new TerminalError('Type the code the reader shows (Settings on the reader › Generate pairing code).')
    const { stripe, acct, opts } = await account(actor.companyId)
    const location = await ensureLocation(actor.companyId, stripe, acct)
    let r: any
    try { r = await stripe.terminal.readers.create({ registration_code: code, label, location }, opts) }
    catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not accept that code. Generate a new one on the reader and try again.'), 400) }
    const [row] = await db.insert(barReader).values({
      companyId: actor.companyId, stripeReaderId: r.id, stripeAccount: acct, locationId: location, label: String(r.label || label),
      deviceType: r.device_type ?? null, serialNumber: r.serial_number ?? null, createdByName: actor.name,
    }).onConflictDoUpdate({ target: [barReader.companyId, barReader.stripeReaderId], set: { label: String(r.label || label), stripeAccount: acct, locationId: location } }).returning()
    return view(row)
  }

  async function removeReader(actor: Actor, id: string) {
    const [r] = await db.select().from(barReader).where(and(eq(barReader.id, id), eq(barReader.companyId, actor.companyId))).limit(1)
    if (!r) throw new TerminalError('That reader is gone.', 404)
    const [busy] = await db.select({ id: barTerminalCharge.id }).from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, actor.companyId), eq(barTerminalCharge.readerId, id), eq(barTerminalCharge.status, 'pending'))).limit(1)
    if (busy) throw new TerminalError('That reader is taking a payment. Let it finish first.', 409)
    const stripe = stripeOf()
    // Taken off the business's Stripe account too, so it can be paired again; one already gone there is fine.
    if (stripe && r.stripeAccount) { try { await stripe.terminal.readers.del(r.stripeReaderId, {}, { stripeAccount: r.stripeAccount }) } catch { /* gone already */ } }
    await db.delete(barReader).where(eq(barReader.id, id))
    return { removed: true }
  }

  /** Tipping on or off: the setting, and the configuration on the location when there is one. */
  async function setTipping(companyId: string, on: boolean) {
    const s = await food.read(companyId)
    let configurationId = s.terminal.configurationId
    if (s.terminal.locationId && s.terminal.locationAccount) {
      const stripe = stripeOf()
      if (stripe) {
        try {
          if (on) configurationId = await tippingConfiguration(stripe, s.terminal.locationAccount, s.terminal.locationId, configurationId)
          else await stripe.terminal.locations.update(s.terminal.locationId, { configuration_overrides: '' } as any, { stripeAccount: s.terminal.locationAccount })
        } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not change the reader\'s tipping. Try again.'), 400) }
      }
    }
    return food.write(companyId, { ...s, terminal: { ...s.terminal, tipping: on, configurationId } })
  }

  // ─── Taking a card ─────────────────────────────────────────────────────────────────────────────────────────
  async function readerOf(companyId: string, readerId: string) {
    const [r] = await db.select().from(barReader).where(and(eq(barReader.id, String(readerId || '')), eq(barReader.companyId, companyId))).limit(1)
    if (!r) throw new TerminalError('Pick a card reader.', 404)
    return r
  }

  /**
   * Send an amount to the reader. For a check: the amount must be no more than its balance, and nothing else may be on
   * a reader for it. For a kiosk order: the order's whole total. The PaymentIntent is made on the business's account.
   */
  async function startCharge(actor: Actor, input: { checkId?: string | null; orderId?: string | null; readerId: string; amountCents?: unknown }): Promise<ChargeView> {
    const companyId = actor.companyId
    const reader = await readerOf(companyId, input.readerId)
    const { stripe, acct, opts } = await account(companyId)
    if (reader.stripeAccount && reader.stripeAccount !== acct) throw new TerminalError('That reader was set up on a different Stripe account. Remove it and add it again.', 409)
    let amount: number, description: string
    const metadata: Record<string, string> = { twomiah_company: companyId }
    if (input.checkId) {
      const check = await register.getCheck(companyId, String(input.checkId)).catch(() => null)
      if (!check) throw new TerminalError('That check is gone.', 404)
      if (check.status !== 'open') throw new TerminalError('That check is already closed.', 409)
      amount = Math.round(Number(input.amountCents))
      if (!Number.isFinite(amount) || amount < 50) throw new TerminalError('A card payment is at least $0.50.')
      if (amount > check.totals.balanceCents) throw new TerminalError('That is more than the balance.')
      const [busy] = await db.select({ id: barTerminalCharge.id }).from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, companyId), eq(barTerminalCharge.checkId, check.id), eq(barTerminalCharge.status, 'pending'))).limit(1)
      if (busy) throw new TerminalError('A card payment for this check is already on a reader.', 409)
      description = `Check #${check.number} ${check.label}`.slice(0, 200)
      metadata.twomiah_check = check.id
    } else if (input.orderId) {
      const [o] = await db.select().from(barOrder).where(and(eq(barOrder.id, String(input.orderId)), eq(barOrder.companyId, companyId))).limit(1)
      if (!o || o.status !== 'awaiting_payment') throw new TerminalError('That order is no longer waiting to be paid.', 409)
      amount = o.totalCents
      description = `Kiosk order · ${o.name || o.tableLabel || 'guest'}`.slice(0, 200)
      metadata.twomiah_order = o.id
    } else throw new TerminalError('Which check?')

    const settings = await food.read(companyId)
    let pi: any
    try {
      pi = await stripe.paymentIntents.create({ amount, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'automatic', description, metadata }, opts)
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not start the payment. Try again.'), 502) }
    try {
      await stripe.terminal.readers.processPaymentIntent(reader.stripeReaderId, {
        payment_intent: pi.id,
        process_config: settings.terminal.tipping ? { tipping: { amount_eligible: amount }, enable_customer_cancellation: true } : { skip_tipping: true, enable_customer_cancellation: true },
      } as any, opts)
    } catch (e) {
      // The reader is offline, busy or asleep: nothing was taken. The PaymentIntent goes, so it never lingers.
      try { await stripe.paymentIntents.cancel(pi.id, {}, opts) } catch { /* nothing to cancel */ }
      throw new TerminalError(stripeSays(e, 'The reader did not answer. Check it is on and connected, then try again.'), 409, 'READER_UNAVAILABLE')
    }
    const [row] = await db.insert(barTerminalCharge).values({
      companyId, checkId: input.checkId ? String(input.checkId) : null, orderId: input.orderId ? String(input.orderId) : null, readerId: reader.id, stripeAccount: acct,
      paymentIntentId: pi.id, amountCents: amount, startedById: actor.id || null, startedByName: actor.name,
    }).returning()
    return chargeView(row, reader.label)
  }

  const chargeView = (r: typeof barTerminalCharge.$inferSelect, readerLabel: string | null = null): ChargeView => ({
    id: r.id, status: r.status, failure: r.failure, amountCents: r.amountCents, tipCents: r.tipCents, checkId: r.checkId, orderId: r.orderId,
    readerId: r.readerId, readerLabel, paymentId: r.paymentId, createdAt: r.createdAt.toISOString(),
  })

  async function chargeRow(companyId: string, id: string) {
    const [r] = await db.select().from(barTerminalCharge).where(and(eq(barTerminalCharge.id, String(id || '')), eq(barTerminalCharge.companyId, companyId))).limit(1)
    if (!r) throw new TerminalError('That card payment is gone.', 404)
    return r
  }

  /** Mark a pending charge finished (failed / canceled / timed_out), once. */
  async function finish(id: string, status: string, failure: string | null) {
    await db.update(barTerminalCharge).set({ status, failure, updatedAt: new Date() }).where(and(eq(barTerminalCharge.id, id), eq(barTerminalCharge.status, 'pending')))
  }

  /**
   * Stripe CONFIRMED the PaymentIntent: write the payment (a check) or make the paid check (a kiosk order), once. The
   * charge row is locked first; a second poll finds it no longer pending and writes nothing.
   */
  async function record(charge: typeof barTerminalCharge.$inferSelect, pi: any): Promise<void> {
    const received = Number(pi.amount_received ?? pi.amount ?? 0)
    const tip = Math.max(0, Number(pi.amount_details?.tip?.amount ?? 0) || Math.max(0, received - charge.amountCents))
    const amount = Math.max(0, received - tip) || charge.amountCents
    const by: Actor = { id: charge.startedById as string, name: charge.startedByName || 'Card reader', companyId: charge.companyId, role: 'field' }
    // Decided before the transaction (an outside read inside one deadlocks a one-connection database).
    const earn = charge.checkId ? await loyalty.loyaltyRunning(charge.companyId) : false
    let fired = false, orderId: string | null = null
    await db.transaction(async (tx: Tx) => {
      const [locked] = await tx.select().from(barTerminalCharge).where(eq(barTerminalCharge.id, charge.id)).limit(1).for('update')
      if (!locked || locked.status !== 'pending') return
      let paymentId: string | null = null
      if (locked.checkId) {
        const r = await register.recordCardInTx(tx, by, locked.checkId, { tender: 'card_terminal', amountCents: amount, tipCents: tip, providerPaymentId: locked.paymentIntentId, stripeAccount: locked.stripeAccount }, earn)
        paymentId = r.paymentId; fired = r.fired
      } else if (locked.orderId && deps.onOrderPaid) {
        const [o] = await tx.select().from(barOrder).where(and(eq(barOrder.id, locked.orderId), eq(barOrder.companyId, locked.companyId))).limit(1).for('update')
        if (o && o.status === 'awaiting_payment') {
          const r = await deps.onOrderPaid(tx, o, { amountCents: amount, tipCents: tip, paymentIntentId: locked.paymentIntentId, stripeAccount: locked.stripeAccount })
          fired = r.fired; orderId = o.id
          const [p] = await tx.select({ id: barCheckPayment.id }).from(barCheckPayment).where(and(eq(barCheckPayment.companyId, locked.companyId), eq(barCheckPayment.providerPaymentId, locked.paymentIntentId))).limit(1)
          paymentId = p?.id ?? null
        }
      }
      await tx.update(barTerminalCharge).set({ status: 'succeeded', tipCents: tip, paymentId, updatedAt: new Date() }).where(eq(barTerminalCharge.id, locked.id))
    })
    if (orderId && deps.afterOrderPaid) await deps.afterOrderPaid(charge.companyId, orderId, fired)
    else register.afterCardPayment(charge.companyId, fired)
  }

  /** Where the payment stands, asked of Stripe while it is pending. */
  async function pollCharge(companyId: string, id: string): Promise<ChargeView> {
    let charge = await chargeRow(companyId, id)
    if (charge.status === 'pending') {
      const stripe = stripeOf()
      const opts = charge.stripeAccount ? { stripeAccount: charge.stripeAccount } : undefined
      if (stripe) {
        let pi: any = null
        try { pi = await stripe.paymentIntents.retrieve(charge.paymentIntentId, {}, opts) } catch { pi = null }
        // The reader authorised it but the capture is still ours to make (manual capture on the account): make it.
        if (pi?.status === 'requires_capture') { try { pi = await stripe.paymentIntents.capture(pi.id, {}, opts) } catch { /* the next poll tries again */ } }
        if (pi?.status === 'succeeded') await record(charge, pi)
        else if (pi?.status === 'canceled') await finish(charge.id, 'canceled', 'The payment was cancelled.')
        else {
          const [reader] = await db.select().from(barReader).where(eq(barReader.id, charge.readerId)).limit(1)
          let action: any = null
          if (reader) { try { action = ((await stripe.terminal.readers.retrieve(reader.stripeReaderId, {}, opts)) as any).action } catch { action = null } }
          const ours = action && action.process_payment_intent?.payment_intent === charge.paymentIntentId
          if (ours && action.status === 'failed') {
            // Declined, or the guest pressed cancel on the reader: Stripe's words, and the PaymentIntent cancelled.
            await finish(charge.id, 'failed', String(action.failure_message || 'The card was declined.').slice(0, 300))
            try { await stripe.paymentIntents.cancel(charge.paymentIntentId, {}, opts) } catch { /* already gone */ }
          } else if (now() - charge.createdAt.getTime() > CHARGE_TIMEOUT_MS) {
            await giveUp(stripe, charge, reader?.stripeReaderId ?? null, 'timed_out', 'The reader waited too long for a card. Nothing was taken.')
          }
        }
      }
      charge = await chargeRow(companyId, id)
    }
    const [reader] = await db.select({ label: barReader.label }).from(barReader).where(eq(barReader.id, charge.readerId)).limit(1)
    return chargeView(charge, reader?.label ?? null)
  }

  /** Stop the reader and cancel the PaymentIntent — and if Stripe says it already went through, record it instead. */
  async function giveUp(stripe: Stripe, charge: typeof barTerminalCharge.$inferSelect, stripeReaderId: string | null, status: 'canceled' | 'timed_out', why: string) {
    const opts = charge.stripeAccount ? { stripeAccount: charge.stripeAccount } : undefined
    if (stripeReaderId) { try { await stripe.terminal.readers.cancelAction(stripeReaderId, {}, opts) } catch { /* no action on it */ } }
    try {
      await stripe.paymentIntents.cancel(charge.paymentIntentId, {}, opts)
    } catch {
      // A PaymentIntent that cannot be cancelled may have just succeeded: ask, and record it if so.
      try {
        const pi: any = await stripe.paymentIntents.retrieve(charge.paymentIntentId, {}, opts)
        if (pi?.status === 'succeeded') { await record(charge, pi); return }
      } catch { /* leave it pending for the next poll */ return }
    }
    await finish(charge.id, status, why)
  }

  async function cancelCharge(actor: Actor, id: string): Promise<ChargeView> {
    const charge = await chargeRow(actor.companyId, id)
    if (charge.status !== 'pending') return pollCharge(actor.companyId, id)
    const stripe = stripeOf()
    if (!stripe) { await finish(charge.id, 'canceled', 'Cancelled at the register.'); return pollCharge(actor.companyId, id) }
    const [reader] = await db.select().from(barReader).where(eq(barReader.id, charge.readerId)).limit(1)
    await giveUp(stripe, charge, reader?.stripeReaderId ?? null, 'canceled', `Cancelled at the register by ${actor.name}.`)
    return pollCharge(actor.companyId, id)
  }

  /** Stripe's test helper: present a test card on a SIMULATED reader (a test account only), for setting up and the live test. */
  async function simulateCard(companyId: string, id: string, outcome: 'approve' | 'decline', tipCents = 0) {
    const charge = await chargeRow(companyId, id)
    const reader = await readerOf(companyId, charge.readerId)
    if (!String(reader.deviceType || '').startsWith('simulated')) throw new TerminalError('Only a simulated reader can be handed a test card.', 409)
    const stripe = stripeOf()
    if (!stripe) throw new TerminalError('Card readers are not available on this server yet.', 503)
    const number = outcome === 'decline' ? '4000000000000002' : '4242424242424242'
    try {
      await (stripe as any).testHelpers.terminal.readers.presentPaymentMethod(reader.stripeReaderId, { type: 'card_present', card_present: { number }, ...(tipCents > 0 ? { amount_tip: tipCents } : {}) }, charge.stripeAccount ? { stripeAccount: charge.stripeAccount } : undefined)
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not take the test card.'), 400) }
    return pollCharge(companyId, id)
  }

  /** The pending reader payments on these checks (the register shows "on the reader"). */
  async function pendingFor(companyId: string, checkIds: string[]) {
    if (!checkIds.length) return []
    return db.select().from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, companyId), inArray(barTerminalCharge.checkId, checkIds), eq(barTerminalCharge.status, 'pending')))
  }

  // ─── Refunds ─────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Give money back to the card, through Stripe, then record it. On a PAID check a refund is recorded against the
   * payment (refunded_cents; the night's report shows it) and the check stays closed. On an OPEN check only the whole
   * payment can come back, and it is then crossed off the check (voided, "Refunded"), so the balance is owed again.
   * Stripe's idempotency key is the payment and what was refunded before, so a retried click cannot refund twice.
   */
  async function refundPayment(actor: Actor, byName: string, paymentId: string, input: { amountCents?: unknown; reason?: unknown }) {
    const companyId = actor.companyId
    const [p] = await db.select().from(barCheckPayment).where(and(eq(barCheckPayment.id, String(paymentId || '')), eq(barCheckPayment.companyId, companyId))).limit(1)
    if (!p) throw new TerminalError('That payment is gone.', 404)
    if (!p.providerPaymentId || !(p.tender === 'card_terminal' || p.tender === 'card_online')) throw new TerminalError('Only a card payment taken through Stripe can be refunded here. Give cash back from the drawer.', 409)
    if (p.voidedAt) throw new TerminalError('That payment was already taken off the check.', 409)
    const [check] = await db.select({ status: barCheck.status, number: barCheck.number }).from(barCheck).where(eq(barCheck.id, p.checkId)).limit(1)
    const left = p.amountCents + p.tipCents - p.refundedCents
    if (left <= 0) throw new TerminalError('That payment has already been refunded in full.', 409)
    const want = input.amountCents === undefined || input.amountCents === null || input.amountCents === '' ? left : Math.round(Number(input.amountCents))
    if (!Number.isFinite(want) || want <= 0) throw new TerminalError('Enter an amount to refund.')
    if (want > left) throw new TerminalError('That is more than is left on this payment.')
    if (check?.status === 'open' && want !== left) throw new TerminalError('On an open check, refund the whole payment, then take the right amount again.', 409)
    const reason = String(input.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!reason) throw new TerminalError('Give a reason for the refund.')
    const stripe = stripeOf()
    if (!stripe) throw new TerminalError('Card refunds are not available on this server yet.', 503)
    try {
      await stripe.refunds.create({ payment_intent: p.providerPaymentId, amount: want, metadata: { twomiah_payment: p.id, reason } }, { ...(p.stripeAccount ? { stripeAccount: p.stripeAccount } : {}), idempotencyKey: `twomiah-refund-${p.id}-${p.refundedCents}-${want}` })
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not make the refund. Try again.'), 502) }
    await db.transaction(async (tx: Tx) => {
      const [locked] = await tx.select().from(barCheckPayment).where(eq(barCheckPayment.id, p.id)).limit(1).for('update')
      const set: Record<string, unknown> = { refundedCents: locked.refundedCents + want, refundedAt: new Date(), refundReason: reason, refundedByName: byName }
      if (check?.status === 'open') Object.assign(set, { voidedAt: new Date(), voidReason: `Refunded: ${reason}`.slice(0, 80), voidedByName: byName })
      await tx.update(barCheckPayment).set(set).where(eq(barCheckPayment.id, p.id))
    })
    register.notifyRegister(companyId)
    return { refundedCents: want, checkNumber: check?.number ?? null, checkId: p.checkId }
  }

  return { listReaders, registerReader, removeReader, setTipping, startCharge, pollCharge, cancelCharge, simulateCard, pendingFor, refundPayment, chargeView }
}
export type BarTerminal = ReturnType<typeof createBarTerminal>
