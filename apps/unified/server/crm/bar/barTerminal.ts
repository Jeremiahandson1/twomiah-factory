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
//   startTab         a pre-authorised TAB (restaurant-bar-depth #12): the card is held for an amount (manual capture) on the
//                    reader; closeTab takes what the check comes to plus the tip when the tab is closed (one capture, on the
//                    business's own Stripe); a voided or otherwise-paid check lets the hold go (releaseHolds)
//
// Nothing is recorded on a check until Stripe says the PaymentIntent succeeded. A reader payment arrives at the check
// through recordCardInTx (barRegister.ts), whose provider id is unique per company: polled twice, written once.
// Offline payments: the server-driven flow cannot take a card while the reader is offline (Stripe offers offline
// collection only to its mobile SDKs), so there is no offline mode — foodSettings.ts says why.
import Stripe from 'stripe'
import { and, desc, eq, inArray } from 'drizzle-orm'
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
  /** The counter reader, or null for a hold taken by Tap to Pay on the phone (parity row 14). */
  checkId: string | null; orderId: string | null; readerId: string | null; readerLabel: string | null; paymentId: string | null; createdAt: string
  /** 'sale' (an ordinary charge) or 'preauth' (a tab: amountCents is the hold). */
  kind: string
  card: { brand: string | null; last4: string | null; holder: string | null } | null
  captureBefore: string | null
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The money limits of a tab's hold: at least a dollar, at most a thousand. */
export const TAB_HOLD_MIN_CENTS = 100
export const TAB_HOLD_MAX_CENTS = 100_000
/** Stripe's documented floor for a card-present authorisation, used when the charge does not say its own capture_before. */
const HOLD_LASTS_MS = 2 * 24 * 3600_000

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
    kind: r.kind, card: r.cardLast4 || r.cardBrand ? { brand: r.cardBrand, last4: r.cardLast4, holder: r.cardholder } : null,
    captureBefore: r.captureBefore ? r.captureBefore.toISOString() : null,
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
    // A card that paid the check in full leaves a tab's hold with nothing to do: let it go.
    if (charge.checkId) await register.checkEnded(charge.companyId, charge.checkId)
  }

  /** Where the payment stands, asked of Stripe while it is pending. */
  async function pollCharge(companyId: string, id: string): Promise<ChargeView> {
    let charge = await chargeRow(companyId, id)
    if (charge.status === 'pending') {
      const stripe = stripeOf()
      const opts = charge.stripeAccount ? { stripeAccount: charge.stripeAccount } : undefined
      if (stripe) {
        let pi: any = null
        try { pi = await stripe.paymentIntents.retrieve(charge.paymentIntentId, charge.kind === 'preauth' ? { expand: ['latest_charge'] } : {}, opts) } catch { pi = null }
        // A tab: the reader authorised the card and the hold is in place. Nothing is captured until the tab is closed.
        if (charge.kind === 'preauth' && pi?.status === 'requires_capture') await authorized(charge, pi)
        // The reader authorised it but the capture is still ours to make (manual capture on the account): make it.
        else if (pi?.status === 'requires_capture') { try { pi = await stripe.paymentIntents.capture(pi.id, {}, opts) } catch { /* the next poll tries again */ } }
        // A tab is never recorded as a payment until closeTab captures it.
        if (charge.kind === 'preauth' && (pi?.status === 'requires_capture' || pi?.status === 'succeeded')) { /* held: done above */ }
        else if (pi?.status === 'succeeded') await record(charge, pi)
        else if (pi?.status === 'canceled') await finish(charge.id, 'canceled', 'The payment was cancelled.')
        else {
          const [reader] = charge.readerId ? await db.select().from(barReader).where(eq(barReader.id, charge.readerId)).limit(1) : [null]
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
    const [reader] = charge.readerId ? await db.select({ label: barReader.label }).from(barReader).where(eq(barReader.id, charge.readerId)).limit(1) : [null]
    return chargeView(charge, reader?.label ?? (charge.readerId ? null : 'This phone'))
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
        if (pi?.status === 'succeeded' && charge.kind !== 'preauth') { await record(charge, pi); return }
      } catch { /* leave it pending for the next poll */ return }
    }
    await finish(charge.id, status, why)
  }

  async function cancelCharge(actor: Actor, id: string): Promise<ChargeView> {
    const charge = await chargeRow(actor.companyId, id)
    if (charge.status !== 'pending') return pollCharge(actor.companyId, id)
    const stripe = stripeOf()
    if (!stripe) { await finish(charge.id, 'canceled', 'Cancelled at the register.'); return pollCharge(actor.companyId, id) }
    const [reader] = charge.readerId ? await db.select().from(barReader).where(eq(barReader.id, charge.readerId)).limit(1) : [null]
    await giveUp(stripe, charge, reader?.stripeReaderId ?? null, 'canceled', `Cancelled at the register by ${actor.name}.`)
    return pollCharge(actor.companyId, id)
  }

  /** Stripe's test helper: present a test card on a SIMULATED reader (a test account only), for setting up and the live test. */
  async function simulateCard(companyId: string, id: string, outcome: 'approve' | 'decline', tipCents = 0) {
    const charge = await chargeRow(companyId, id)
    if (!charge.readerId) throw new TerminalError('That hold was taken on a phone; there is no reader to hand a test card to.', 409)
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

  // ─── Pre-authorised tabs (restaurant-bar-depth #12) ───────────────────────────────────────────────────────────
  // The card is held on the reader (a card_present PaymentIntent with manual capture, on the business's own account) and
  // nothing is taken until the tab is closed: then ONE capture of what the check comes to plus the tip. If that is more
  // than the hold, Stripe tries to raise the hold as it captures (an incremental authorisation, where the card allows);
  // if the card will not, the tab closes for the hold and the rest is taken another way. A voided check, or one paid
  // another way, lets the hold go. The phone app takes no cards, so none of this is reachable from it.
  const ACTIVE_TAB = ['pending', 'authorized', 'closing']

  /** The card the reader read, from the charge Stripe expanded onto the PaymentIntent. */
  const cardOf = (pi: any) => {
    const ch = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    const c = ch?.payment_method_details?.card_present
    return { brand: c?.brand ? String(c.brand) : null, last4: c?.last4 ? String(c.last4) : null, holder: c?.cardholder_name ? String(c.cardholder_name).slice(0, 60) : null, before: Number(c?.capture_before) > 0 ? new Date(Number(c.capture_before) * 1000) : null }
  }

  /** The reader took the card and the bank put the hold on: the tab is open. Once. */
  async function authorized(charge: typeof barTerminalCharge.$inferSelect, pi: any): Promise<void> {
    const c = cardOf(pi)
    await db.update(barTerminalCharge).set({ status: 'authorized', cardBrand: c.brand, cardLast4: c.last4, cardholder: c.holder, captureBefore: c.before ?? new Date(now() + HOLD_LASTS_MS), updatedAt: new Date() })
      .where(and(eq(barTerminalCharge.id, charge.id), eq(barTerminalCharge.status, 'pending')))
    register.notifyRegister(charge.companyId)
  }

  /** Put a card on a check: the reader asks for it and holds `amountCents`. */
  async function startTab(actor: Actor, input: { checkId?: string | null; readerId: string; amountCents?: unknown }): Promise<ChargeView> {
    const companyId = actor.companyId
    const reader = await readerOf(companyId, input.readerId)
    const { stripe, acct, opts } = await account(companyId)
    if (reader.stripeAccount && reader.stripeAccount !== acct) throw new TerminalError('That reader was set up on a different Stripe account. Remove it and add it again.', 409)
    const check = await register.getCheck(companyId, String(input.checkId || '')).catch(() => null)
    if (!check) throw new TerminalError('That check is gone.', 404)
    if (check.status !== 'open') throw new TerminalError('That check is already closed.', 409)
    const hold = Math.round(Number(input.amountCents))
    if (!Number.isFinite(hold) || hold < TAB_HOLD_MIN_CENTS || hold > TAB_HOLD_MAX_CENTS) throw new TerminalError('A tab holds between $1 and $1,000 on the card.')
    const [live] = await db.select({ id: barTerminalCharge.id }).from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, companyId), eq(barTerminalCharge.checkId, check.id), inArray(barTerminalCharge.status, ACTIVE_TAB))).limit(1)
    if (live) throw new TerminalError('This check already has a card on it or on a reader.', 409)
    let pi: any
    try {
      pi = await stripe.paymentIntents.create({
        amount: hold, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'manual',
        payment_method_options: { card_present: { request_incremental_authorization_support: true } },
        description: `Tab · check #${check.number} ${check.label}`.slice(0, 200), metadata: { twomiah_company: companyId, twomiah_check: check.id, twomiah_tab: '1' },
      } as any, opts)
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not start the tab. Try again.'), 502) }
    try {
      // No tip on the reader: the tip is added when the tab is closed, on the check.
      await stripe.terminal.readers.processPaymentIntent(reader.stripeReaderId, { payment_intent: pi.id, process_config: { skip_tipping: true, enable_customer_cancellation: true } } as any, opts)
    } catch (e) {
      try { await stripe.paymentIntents.cancel(pi.id, {}, opts) } catch { /* nothing to cancel */ }
      throw new TerminalError(stripeSays(e, 'The reader did not answer. Check it is on and connected, then try again.'), 409, 'READER_UNAVAILABLE')
    }
    const [row] = await db.insert(barTerminalCharge).values({
      companyId, checkId: check.id, readerId: reader.id, stripeAccount: acct, paymentIntentId: pi.id, amountCents: hold, kind: 'preauth',
      startedById: actor.id || null, startedByName: actor.name,
    }).returning()
    return chargeView(row, reader.label)
  }

  /** The tab on this check: waiting for a card, held, or being closed. Null when there is none. */
  async function tabFor(companyId: string, checkId: string): Promise<ChargeView | null> {
    const [row] = await db.select().from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, companyId), eq(barTerminalCharge.checkId, checkId), eq(barTerminalCharge.kind, 'preauth'), inArray(barTerminalCharge.status, ACTIVE_TAB))).orderBy(desc(barTerminalCharge.createdAt)).limit(1)
    if (!row) return null
    const [reader] = row.readerId ? await db.select({ label: barReader.label }).from(barReader).where(eq(barReader.id, row.readerId)).limit(1) : [null]
    return chargeView(row, reader?.label ?? (row.readerId ? null : 'This phone'))
  }

  /**
   * Close the tab: capture what the check comes to plus the tip, record it as the card payment, and the check is paid.
   * Over the hold, Stripe tries to raise it as it captures; if the card refuses, nothing is taken and the answer says so,
   * and `partial` closes it for the hold instead (the check keeps a balance to take another way).
   */
  async function closeTab(actor: Actor, id: string, input: { tipCents?: unknown; partial?: unknown }): Promise<{ charge: ChargeView; paidCents: number; tipCents: number; leftCents: number }> {
    const companyId = actor.companyId
    const charge = await chargeRow(companyId, id)
    if (charge.kind !== 'preauth' || !charge.checkId) throw new TerminalError('That is not a tab.', 409)
    if (charge.status === 'succeeded') throw new TerminalError('This tab is already closed.', 409)
    if (charge.status === 'released') throw new TerminalError('This tab was released. The card was not charged.', 409)
    if (charge.status !== 'authorized' && !(charge.status === 'closing' && now() - charge.updatedAt.getTime() > 30_000)) throw new TerminalError(charge.status === 'pending' ? 'The card has not been read yet.' : 'This tab cannot be closed.', 409)
    const check = await register.getCheck(companyId, charge.checkId).catch(() => null)
    if (!check || check.status !== 'open') throw new TerminalError('That check is already closed.', 409)
    const balance = check.totals.balanceCents
    if (balance <= 0) throw new TerminalError('Nothing is owed on this check. Release the tab instead.', 409)
    const tip = Math.round(Number(input.tipCents ?? 0))
    if (!Number.isFinite(tip) || tip < 0 || tip > Math.max(10000, balance * 2)) throw new TerminalError('That tip looks wrong. Check it.')
    const stripe = stripeOf()
    if (!stripe) throw new TerminalError('Card readers are not available on this server yet.', 503)
    const opts = { stripeAccount: charge.stripeAccount as string }
    const hold = charge.amountCents
    // Claimed first, so two clicks capture once.
    const claimed = await db.update(barTerminalCharge).set({ status: 'closing', updatedAt: new Date() })
      .where(and(eq(barTerminalCharge.id, charge.id), inArray(barTerminalCharge.status, ['authorized', 'closing']))).returning({ id: barTerminalCharge.id })
    if (!claimed.length) throw new TerminalError('This tab is being closed.', 409)
    const back = async () => { await db.update(barTerminalCharge).set({ status: 'authorized', updatedAt: new Date() }).where(and(eq(barTerminalCharge.id, charge.id), eq(barTerminalCharge.status, 'closing'))) }

    let toward = balance, tipped = tip, pi: any = null
    const capture = async (amount: number) => stripe.paymentIntents.capture(charge.paymentIntentId, { amount_to_capture: amount }, { ...opts, idempotencyKey: `twomiah-tab-${charge.id}-${amount}` })
    try {
      // Stripe's order (docs.stripe.com/terminal/features/incremental-authorizations, row 18's check of the fake): a capture
      // can never take more than the hold, so over it the hold is RAISED first (increment_authorization - the tab asked for
      // it when it was made), and only then captured. A card that will not raise it (declined, or a card that cannot) leaves
      // the original hold: the tab closes for the hold, when the bartender says so, and the rest is taken another way.
      if (balance + tip > hold) {
        try { await stripe.paymentIntents.incrementAuthorization(charge.paymentIntentId, { amount: balance + tip }, { ...opts, idempotencyKey: `twomiah-tab-${charge.id}-raise-${balance + tip}` }) }
        catch (e: any) {
          if (e?.code !== 'card_declined' && e?.code !== 'incremental_authorization_not_supported') throw e
          if (input.partial !== true) {
            await back()
            throw new TerminalError(`The tab comes to ${money(balance + tip)} and the card is held for ${money(hold)}; the card would not raise it. Close it for ${money(hold)}, then take the rest another way.`, 409, 'TAB_OVER_HOLD')
          }
          toward = Math.min(balance, hold); tipped = Math.min(tip, hold - toward)
        }
      }
      pi = await capture(toward + tipped)
    } catch (e: any) {
      if (e instanceof TerminalError) throw e
      await back()
      throw new TerminalError(stripeSays(e, 'Stripe did not take the tab. Try again, or take the card again as a new payment.'), 502)
    }

    const by: Actor = { id: actor.id as string, name: actor.name, companyId, role: actor.role }
    const earn = await loyalty.loyaltyRunning(companyId)
    let fired = false, paymentId: string | null = null
    try {
      await db.transaction(async (tx: Tx) => {
        const [locked] = await tx.select().from(barTerminalCharge).where(eq(barTerminalCharge.id, charge.id)).limit(1).for('update')
        if (!locked || locked.status !== 'closing') return
        const r = await register.recordCardInTx(tx, by, charge.checkId as string, { tender: 'card_terminal', amountCents: toward, tipCents: tipped, providerPaymentId: charge.paymentIntentId, stripeAccount: charge.stripeAccount }, earn)
        paymentId = r.paymentId; fired = r.fired
        await tx.update(barTerminalCharge).set({ status: 'succeeded', tipCents: tipped, paymentId, updatedAt: new Date() }).where(eq(barTerminalCharge.id, locked.id))
      })
    } catch (e: any) {
      // The check ended while the card was being charged (voided at another till): the money goes straight back.
      try { await stripe.refunds.create({ payment_intent: charge.paymentIntentId }, { ...opts, idempotencyKey: `twomiah-tab-undo-${charge.id}` }) } catch { /* the Stripe dashboard shows it */ }
      await db.update(barTerminalCharge).set({ status: 'released', failure: 'The check ended while the tab was being closed. The card was charged and refunded.', updatedAt: new Date() }).where(eq(barTerminalCharge.id, charge.id))
      throw new TerminalError('That check ended while the tab was being closed. The card was refunded in full.', 409)
    }
    register.afterCardPayment(companyId, fired)
    const left = Math.max(0, balance - toward)
    const [row] = await db.select().from(barTerminalCharge).where(eq(barTerminalCharge.id, charge.id)).limit(1)
    return { charge: chargeView(row), paidCents: toward, tipCents: tipped, leftCents: left }
  }

  /** Let go of every held tab on a check (it was voided or paid another way). Returns how many were released. */
  async function releaseHolds(companyId: string, checkId: string, why: string): Promise<number> {
    const rows = await db.select().from(barTerminalCharge).where(and(eq(barTerminalCharge.companyId, companyId), eq(barTerminalCharge.checkId, checkId), eq(barTerminalCharge.kind, 'preauth'), eq(barTerminalCharge.status, 'authorized')))
    let n = 0
    for (const r of rows) if (await releaseOne(r, why)) n++
    return n
  }

  async function releaseOne(r: typeof barTerminalCharge.$inferSelect, why: string): Promise<boolean> {
    const claimed = await db.update(barTerminalCharge).set({ status: 'released', failure: why, updatedAt: new Date() }).where(and(eq(barTerminalCharge.id, r.id), eq(barTerminalCharge.status, 'authorized'))).returning({ id: barTerminalCharge.id })
    if (!claimed.length) return false
    const stripe = stripeOf()
    if (stripe) {
      try { await stripe.paymentIntents.cancel(r.paymentIntentId, {}, r.stripeAccount ? { stripeAccount: r.stripeAccount } : undefined) }
      catch {
        // Stripe would not say it let go (it may already have): the hold lapses on its own, and the tab says when.
        await db.update(barTerminalCharge).set({ failure: `${why} Stripe did not confirm the release; the hold lapses by itself${r.captureBefore ? ' by ' + r.captureBefore.toISOString().slice(0, 10) : ''}.` }).where(eq(barTerminalCharge.id, r.id))
      }
    }
    register.notifyRegister(r.companyId)
    return true
  }

  /** Release a tab on purpose ("give the card back"): only while it is held. */
  // ─── Parity row 14: the tip on the reader at close, tabs that lapse by the venue's window, and a tab held by Tap to Pay ───

  /**
   * The guest chooses the tip on the counter reader as the tab closes (Toast): a sale for what the check comes to is sent
   * to the reader with on-reader tipping, the guest picks the tip and taps; paid, the check ends and the hold is released
   * (register.hooks.checkEnded). Needs "Ask for a tip on the reader" on, as the salon's reader does.
   */
  async function closeTabOnReader(actor: Actor, id: string, readerId: string): Promise<ChargeView> {
    const charge = await chargeRow(actor.companyId, id)
    if (charge.kind !== 'preauth' || !charge.checkId) throw new TerminalError('That is not a tab.', 409)
    if (charge.status !== 'authorized') throw new TerminalError('That tab is not open.', 409)
    const s = await food.read(actor.companyId)
    if (!s.terminal.tipping) throw new TerminalError('Turn on "Ask for a tip on the reader" in Register Settings first.', 409, 'TIPPING_OFF')
    const check = await register.getCheck(actor.companyId, charge.checkId).catch(() => null)
    if (!check || check.status !== 'open') throw new TerminalError('That check is already closed.', 409)
    if (check.totals.balanceCents < 50) throw new TerminalError('Nothing left to pay on the reader. Close the tab with no tip.', 409)
    return startCharge(actor, { checkId: charge.checkId, readerId, amountCents: check.totals.balanceCents })
  }

  /** Tabs open longer than the venue's window (Register Settings, Toast's pre-auth settings) are released: hourly, every business. */
  async function releaseStaleTabs(now = new Date()): Promise<number> {
    const rows = await db.select().from(barTerminalCharge).where(and(eq(barTerminalCharge.kind, 'preauth'), eq(barTerminalCharge.status, 'authorized')))
    const windows = new Map<string, number>()
    let n = 0
    for (const r of rows) {
      if (!windows.has(r.companyId)) windows.set(r.companyId, (await food.read(r.companyId)).terminal.tabHoldHours)
      const hours = windows.get(r.companyId)!
      if (r.createdAt.getTime() + hours * 3600_000 > now.getTime()) continue
      if (await releaseOne(r, `The tab was open longer than the venue's ${hours} hours.`)) n++
    }
    return n
  }

  /**
   * A tab held by Tap to Pay on the phone (through the existing tap_to_pay): the server makes the hold (manual capture, on the
   * business's own Stripe), the phone collects the card with the Terminal SDK, and the server reads the hold back from
   * Stripe before it counts. Closing is the ordinary closeTab (a capture, no reader needed); releasing too.
   */
  async function startPhoneTab(actor: Actor, input: { checkId?: unknown; amountCents?: unknown }): Promise<{ charge: ChargeView; clientSecret: string }> {
    const companyId = actor.companyId
    const { stripe, acct, opts } = await account(companyId)
    const check = await register.getCheck(companyId, String(input.checkId || '')).catch(() => null)
    if (!check) throw new TerminalError('That check is gone.', 404)
    if (check.status !== 'open') throw new TerminalError('That check is already closed.', 409)
    const hold = Math.round(Number(input.amountCents))
    if (!Number.isFinite(hold) || hold < 100 || hold > 100_000) throw new TerminalError('A hold is $1 to $1,000.')
    if (await tabFor(companyId, check.id)) throw new TerminalError('This check already has a tab.', 409)
    let pi: any
    try {
      pi = await stripe.paymentIntents.create({
        amount: hold, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'manual',
        description: `Tab · ${check.label}`.slice(0, 200), metadata: { twomiah_company: companyId, twomiah_check: check.id, twomiah_phone_tab: '1' },
      }, opts)
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not start the hold. Try again.'), 502) }
    const [row] = await db.insert(barTerminalCharge).values({
      companyId, checkId: check.id, readerId: null, stripeAccount: acct, paymentIntentId: pi.id, amountCents: hold, kind: 'preauth',
      startedById: actor.id || null, startedByName: actor.name,
    }).returning()
    return { charge: chargeView(row, 'This phone'), clientSecret: String(pi.client_secret || '') }
  }

  /** The phone says the card was tapped: the hold counts only once Stripe says it is in place (requires_capture). */
  async function phoneTabAuthorized(actor: Actor, id: string): Promise<ChargeView> {
    const companyId = actor.companyId
    const charge = await chargeRow(companyId, id)
    if (charge.kind !== 'preauth' || charge.readerId) throw new TerminalError('That is not a tab held on a phone.', 409)
    if (charge.status === 'authorized') return chargeView(charge, 'This phone')
    if (charge.status !== 'pending') throw new TerminalError('That tab is over.', 409)
    const { stripe, opts } = await account(companyId)
    let pi: any
    try { pi = await stripe.paymentIntents.retrieve(charge.paymentIntentId, { expand: ['latest_charge'] }, opts) } catch { throw new TerminalError('Stripe could not find the hold. Tap the card again.', 409) }
    if (pi.status === 'requires_capture') { await authorized(charge, pi); return chargeView(await chargeRow(companyId, id), 'This phone') }
    if (pi.status === 'canceled') { await finish(id, 'canceled', 'The card was not held.'); return chargeView(await chargeRow(companyId, id), 'This phone') }
    throw new TerminalError(`Stripe says the hold is ${String(pi.status).replace(/_/g, ' ')}. Tap the card again.`, 409)
  }

  /** The open checks and their tabs, for the phone: what to open a tab on, and what to close. */
  async function openTabs(companyId: string) {
    const checks = await db.select({ id: barCheck.id, number: barCheck.number, label: barCheck.label, kind: barCheck.kind }).from(barCheck).where(and(eq(barCheck.companyId, companyId), eq(barCheck.status, 'open'))).orderBy(desc(barCheck.updatedAt))
    const out = []
    for (const c of checks.slice(0, 60)) {
      const view = await register.getCheck(companyId, c.id).catch(() => null)
      const t = await tabFor(companyId, c.id)
      out.push({ id: c.id, number: c.number, label: c.label, kind: c.kind, balanceCents: view?.totals.balanceCents ?? 0, tab: t })
    }
    return out
  }

  async function releaseTab(actor: Actor, id: string): Promise<ChargeView> {
    const charge = await chargeRow(actor.companyId, id)
    if (charge.kind !== 'preauth') throw new TerminalError('That is not a tab.', 409)
    if (charge.status !== 'authorized') throw new TerminalError(charge.status === 'pending' ? 'The reader is waiting for the card. Cancel it there.' : 'This tab is not holding a card.', 409)
    await releaseOne(charge, `Released by ${actor.name}.`)
    const [row] = await db.select().from(barTerminalCharge).where(eq(barTerminalCharge.id, charge.id)).limit(1)
    return chargeView(row)
  }

  register.hooks.checkEnded = (companyId, checkId) => releaseHolds(companyId, checkId, 'The check ended without the tab.').then(() => undefined)

  return { startTab, tabFor, closeTab, releaseTab, releaseHolds, listReaders, registerReader, removeReader, setTipping, startCharge, pollCharge, cancelCharge, simulateCard, pendingFor, refundPayment, chargeView, closeTabOnReader, releaseStaleTabs, startPhoneTab, phoneTabAuthorized, openTabs }
}
export type BarTerminal = ReturnType<typeof createBarTerminal>
