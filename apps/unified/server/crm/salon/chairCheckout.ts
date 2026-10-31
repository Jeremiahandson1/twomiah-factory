// Checkout at the chair: a client pays on a card reader, the tip goes to the stylist (salon gap #7; hidden feature `chair_checkout`;
// docs/parity/salon-chair-checkout.md). Stripe Terminal's SERVER-DRIVEN integration, every call on the SALON'S OWN connected Stripe
// account (Settings › Integrations) with the Stripe-Account header — the money lands in the salon's Stripe, never Twomiah's, and the
// phone app takes no cards (it only shows the sale; the card is tapped on the reader).
//
//   registerReader  a Location for the salon (once, from its address), then the reader by the code it shows
//   startCharge     a card_present PaymentIntent for the amount + the tip chosen at the desk → process_payment_intent on the reader
//   pollCharge      Stripe's word: the PaymentIntent succeeded → the sale's payment is written ONCE (the tip beside it); the reader's
//                   action failed → declined; too long → timed out and cancelled
//   cancelCharge    cancel_action on the reader and cancel the PaymentIntent — unless it already went through (then it is recorded)
//   simulateCard    Stripe's test helper on a SIMULATED reader (no hardware): a test card is "tapped", approving or declining
//
// Nothing is recorded until Stripe says the PaymentIntent succeeded. The payment goes through the same locked write every payment on a
// sale uses (recordInvoicePayment), under the sale's row lock, with the PaymentIntent id as its reference: polled twice, written once.
// A split bill is the same machinery used more than once: cash, a gift card and the reader each take their part of the balance.
// A card taken above what is still owing (the sale was paid some other way while the reader waited) is recorded, not lost, and the
// payment says so; a card taken on a sale that was voided meanwhile is marked for a person to refund.
import Stripe from 'stripe'
import { Hono } from 'hono'
import { and, desc, eq, like, lt } from 'drizzle-orm'
import { invoiceBalance, recordInvoicePayment, recordInvoiceRefund, round2 } from '@twomiah/tenant-backend'
import { company, invoice, payment, salonReader, salonTerminalCharge } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { platformStripe } from '../platformStripe.ts'
import { tipsOutstanding } from '../../data/salon.ts'
import { createTipShares } from './tipShares.ts'
import { createTipPresets } from './tipPresets.ts'
import type { SaleReceipts } from './saleReceipt.ts'
import { parseTipSettings } from './tipSettings.ts'
import { weightsFromPercents } from './tipSplit.ts'

type Tx = any
export type ChargeRow = typeof salonTerminalCharge.$inferSelect

export class TerminalError extends Error { constructor(message: string, public status: 400 | 404 | 409 | 502 | 503 = 400, public code?: string, public field?: string) { super(message) } }

/** A reader payment still waiting this long is given up: the reader's action is cancelled, the PaymentIntent too. */
export const CHARGE_TIMEOUT_MS = 3 * 60_000
export const MIN_CARD_CENTS = 50
export const MAX_TIP_CENTS = 100_000

const nameOf = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || 'Staff'
const dollars = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100))
const CLOSED = new Set(['paid', 'void', 'refunded'])

/** Stripe's own sentence for a refusal, for the person at the desk; anything else a plain one. */
function stripeSays(e: any, fallback: string): string {
  const m = typeof e?.raw?.message === 'string' ? e.raw.message : typeof e?.message === 'string' && e?.type ? e.message : ''
  return m ? String(m).slice(0, 300) : fallback
}

export interface ChargeView {
  id: string; status: string; failure: string | null; amountCents: number; tipCents: number
  invoiceId: string; readerId: string; readerLabel: string | null; paymentId: string | null; createdAt: string
}

export function createChairCheckout(d: CrmDeps, deps: { stripe?: () => Stripe | null; now?: () => number; receipts?: SaleReceipts; /** Runs when a sale is paid in full here (a gift card sold on the reader goes live). */ afterPaid?: (invoiceId: string) => Promise<unknown> } = {}) {
  const { db, logger } = d
  const live = d.realtime
  const stripeOf = deps.stripe ?? (() => platformStripe(d.services.testStripeClient))
  const now = deps.now ?? (() => Date.now())
  const tips = createTipPresets(d, stripeOf)

  /** The client and the salon's account, or the refusal that says what is missing. */
  async function account(companyId: string): Promise<{ stripe: Stripe; acct: string; opts: { stripeAccount: string } }> {
    const stripe = stripeOf()
    if (!stripe) throw new TerminalError('Card readers are not available on this server yet. Take cash, or record a card taken on another machine.', 503, 'STRIPE_NOT_CONFIGURED')
    const acct = await d.services.stripeService.connectedAccountFor(companyId)
    if (!acct) throw new TerminalError('Connect your Stripe account first (Settings › Integrations), then add the reader.', 409, 'STRIPE_NOT_CONNECTED')
    return { stripe, acct, opts: { stripeAccount: acct } }
  }

  const readerView = (r: typeof salonReader.$inferSelect) => ({
    id: r.id, label: r.label, deviceType: r.deviceType, serialNumber: r.serialNumber, simulated: String(r.deviceType || '').startsWith('simulated'), createdAt: r.createdAt.toISOString(),
  })

  async function listReaders(companyId: string, liveStatus = false) {
    const rows: Array<typeof salonReader.$inferSelect> = await db.select().from(salonReader).where(eq(salonReader.companyId, companyId)).orderBy(salonReader.createdAt)
    const stripe = liveStatus ? stripeOf() : null
    return Promise.all(rows.map(async (r) => {
      let status: string | null = null
      if (stripe && r.stripeAccount) { try { status = String((await stripe.terminal.readers.retrieve(r.stripeReaderId, {}, { stripeAccount: r.stripeAccount }) as any).status || '') || null } catch { status = null } }
      return { ...readerView(r), status }
    }))
  }

  /** The salon's Terminal Location on this account: the one its other readers use, else made once from its address (Stripe needs one per reader). */
  async function ensureLocation(companyId: string, stripe: Stripe, acct: string): Promise<string> {
    const [have] = await db.select({ locationId: salonReader.locationId }).from(salonReader).where(and(eq(salonReader.companyId, companyId), eq(salonReader.stripeAccount, acct))).limit(1)
    if (have) return have.locationId
    const [co] = await db.select({ name: company.name, address: company.address, city: company.city, state: company.state, zip: company.zip }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!co?.address || !co.city || !co.state || !co.zip) throw new TerminalError('Stripe needs the salon\'s address for a card reader. Add it in Settings › Company, then add the reader again.', 409, 'ADDRESS_NEEDED')
    let loc: any
    try {
      loc = await stripe.terminal.locations.create({ display_name: co.name.slice(0, 100), address: { line1: co.address, city: co.city, state: co.state, postal_code: co.zip, country: 'US' } }, { stripeAccount: acct })
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not take the salon\'s address. Check it in Settings › Company.'), 400) }
    // On-reader tipping (the client picks 15 / 18 / 20% on the reader's own screen) is a Terminal configuration set on the location. A charge that
    // takes its tip at the desk hides that screen (skip_tipping), so having it here costs nothing; if Stripe refuses, desk tips still work.
    try {
      const { cfg } = await tips.configFor(companyId, stripe, acct)
      await stripe.terminal.locations.update(loc.id, { configuration_overrides: cfg.id } as any, { stripeAccount: acct })
      await tips.remember(companyId, loc.id, cfg.id)
    } catch (e: any) { logger.warn('[chair-checkout] on-reader tipping not set up', { error: e?.message }) }
    return loc.id as string
  }

  async function registerReader(actor: any, input: { code?: unknown; label?: unknown }) {
    const code = String(input.code ?? '').trim()
    const label = String(input.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Card reader'
    if (!code || code.length > 100) throw new TerminalError('Type the code the reader shows (Settings on the reader › Generate pairing code).', 400, 'CODE_REQUIRED', 'code')
    const { stripe, acct, opts } = await account(actor.companyId)
    const location = await ensureLocation(actor.companyId, stripe, acct)
    let r: any
    try { r = await stripe.terminal.readers.create({ registration_code: code, label, location }, opts) }
    catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not accept that code. Generate a new one on the reader and try again.'), 400, 'BAD_CODE', 'code') }
    const [row] = await db.insert(salonReader).values({
      companyId: actor.companyId, stripeReaderId: r.id, stripeAccount: acct, locationId: location, label: String(r.label || label),
      deviceType: r.device_type ?? null, serialNumber: r.serial_number ?? null, createdByName: nameOf(actor),
    }).onConflictDoUpdate({ target: [salonReader.companyId, salonReader.stripeReaderId], set: { label: String(r.label || label), stripeAccount: acct, locationId: location } }).returning()
    return readerView(row)
  }

  async function removeReader(companyId: string, id: string) {
    const [r] = await db.select().from(salonReader).where(and(eq(salonReader.id, id), eq(salonReader.companyId, companyId))).limit(1)
    if (!r) throw new TerminalError('That reader is gone.', 404)
    const [busy] = await db.select({ id: salonTerminalCharge.id }).from(salonTerminalCharge).where(and(eq(salonTerminalCharge.companyId, companyId), eq(salonTerminalCharge.readerId, id), eq(salonTerminalCharge.status, 'pending'))).limit(1)
    if (busy) throw new TerminalError('That reader is taking a payment. Let it finish first.', 409)
    const stripe = stripeOf()
    // Taken off the salon's Stripe account too, so it can be paired again; one already gone there is fine.
    if (stripe && r.stripeAccount) { try { await stripe.terminal.readers.del(r.stripeReaderId, {}, { stripeAccount: r.stripeAccount }) } catch { /* gone already */ } }
    await db.delete(salonReader).where(eq(salonReader.id, id))
    return { removed: true }
  }

  async function readerOf(companyId: string, readerId: string) {
    const [r] = await db.select().from(salonReader).where(and(eq(salonReader.id, String(readerId || '')), eq(salonReader.companyId, companyId))).limit(1)
    if (!r) throw new TerminalError('Pick a card reader.', 404, 'NO_READER', 'readerId')
    return r
  }

  const chargeView = (r: ChargeRow, readerLabel: string | null = null): ChargeView => ({
    id: r.id, status: r.status, failure: r.failure, amountCents: r.amountCents, tipCents: r.tipCents, invoiceId: r.invoiceId,
    readerId: r.readerId, readerLabel, paymentId: r.paymentId, createdAt: r.createdAt.toISOString(),
  })

  async function chargeRow(companyId: string, id: string): Promise<ChargeRow> {
    const [r] = await db.select().from(salonTerminalCharge).where(and(eq(salonTerminalCharge.id, String(id || '')), eq(salonTerminalCharge.companyId, companyId))).limit(1)
    if (!r) throw new TerminalError('That card payment is gone.', 404)
    return r
  }

  // ─── Taking a card ────────────────────────────────────────────────────────────────────────────
  /**
   * Send an amount to the reader. `amountCents` is what goes on the sale (default: the whole balance; less is a split bill),
   * `tipCents` the tip the client chose at the desk — the card is charged both, the tip is recorded beside the payment.
   */
  async function startCharge(actor: any, input: { invoiceId?: unknown; readerId?: unknown; amountCents?: unknown; tipCents?: unknown; tipOnReader?: unknown }): Promise<ChargeView> {
    const companyId = actor.companyId
    const reader = await readerOf(companyId, String(input.readerId ?? ''))
    const { stripe, acct, opts } = await account(companyId)
    if (reader.stripeAccount && reader.stripeAccount !== acct) throw new TerminalError('That reader was set up on a different Stripe account. Remove it and add it again.', 409, 'OTHER_ACCOUNT')
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, String(input.invoiceId ?? ''), ), eq(invoice.companyId, companyId))).limit(1)
    if (!inv) throw new TerminalError('That sale was not found.', 404, 'NO_SALE', 'invoiceId')
    if (CLOSED.has(inv.status)) throw new TerminalError(inv.status === 'paid' ? 'That sale is already paid.' : 'That sale is closed and cannot take a card.', 409, 'SALE_CLOSED')
    const dueCents = Math.round(invoiceBalance({ status: inv.status, total: inv.total, amountPaid: inv.amountPaid, amountRefunded: inv.amountRefunded }) * 100)
    if (dueCents <= 0) throw new TerminalError('Nothing is owing on that sale.', 409, 'NOTHING_OWING')
    const amount = input.amountCents == null || input.amountCents === '' ? dueCents : Number(input.amountCents)
    if (!Number.isInteger(amount) || amount < MIN_CARD_CENTS) throw new TerminalError(`A card payment is at least ${dollars(MIN_CARD_CENTS)}.`, 400, 'BAD_AMOUNT', 'amountCents')
    if (amount > dueCents) throw new TerminalError(`Only ${dollars(dueCents)} is owing on that sale.`, 400, 'OVER_DUE', 'amountCents')
    const tip = input.tipCents == null || input.tipCents === '' ? 0 : Number(input.tipCents)
    if (!Number.isInteger(tip) || tip < 0 || tip > MAX_TIP_CENTS) throw new TerminalError(`A tip is a whole number of cents, up to ${dollars(MAX_TIP_CENTS)}.`, 400, 'BAD_TIP', 'tipCents')
    const onReader = input.tipOnReader === true
    if (onReader && tip > 0) throw new TerminalError('Either type the tip here or let the client choose it on the reader, not both.', 400, 'BAD_TIP', 'tipCents')
    const [busy] = await db.select({ id: salonTerminalCharge.id }).from(salonTerminalCharge).where(and(eq(salonTerminalCharge.companyId, companyId), eq(salonTerminalCharge.invoiceId, inv.id), eq(salonTerminalCharge.status, 'pending'))).limit(1)
    if (busy) throw new TerminalError('A card payment for this sale is already on a reader.', 409, 'ALREADY_PENDING')

    let pi: any
    try {
      pi = await stripe.paymentIntents.create({
        amount: amount + tip, currency: 'usd', payment_method_types: ['card_present'], capture_method: 'automatic',
        description: `${inv.number}`.slice(0, 200), metadata: { twomiah_company: companyId, twomiah_invoice: inv.id, twomiah_tip_cents: String(tip) },
      }, opts)
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not start the payment. Try again.'), 502) }
    try {
      // A tip chosen at the desk is already in the amount: the reader is not asked for one. Otherwise the reader shows its own tip screen first,
      // and the tip the client picks arrives on the PaymentIntent (recorded as the tip when Stripe confirms it).
      // On the reader's own screen the suggestions are worked on the services of this charge (Stripe's tip-eligible amount): retail on the sale is
      // left out. A charge that is all retail has nothing to tip on, so the screen is skipped.
      const eligible = onReader ? (await tips.eligibleFor(companyId, inv.id, amount))?.eligibleCents ?? amount : amount
      const readerTipping = eligible <= 0 ? { skip_tipping: true } : eligible < amount ? { tipping: { amount_eligible: eligible } } : {}
      await stripe.terminal.readers.processPaymentIntent(reader.stripeReaderId, { payment_intent: pi.id, process_config: onReader ? { enable_customer_cancellation: true, ...readerTipping } : { skip_tipping: true, enable_customer_cancellation: true } } as any, opts)
    } catch (e) {
      // The reader is offline, busy or asleep: nothing was taken. The PaymentIntent goes, so it never lingers.
      try { await stripe.paymentIntents.cancel(pi.id, {}, opts) } catch { /* nothing to cancel */ }
      throw new TerminalError(stripeSays(e, 'The reader did not answer. Check it is on and connected, then try again.'), 409, 'READER_UNAVAILABLE')
    }
    const [row] = await db.insert(salonTerminalCharge).values({
      companyId, invoiceId: inv.id, readerId: reader.id, stripeAccount: acct, paymentIntentId: pi.id, amountCents: amount, tipCents: tip, startedById: actor.userId || actor.id || null, startedByName: nameOf(actor),
    }).returning()
    return chargeView(row, reader.label)
  }

  /** Mark a pending charge finished (failed / canceled / timed_out), once. */
  async function finish(id: string, status: string, failure: string | null) {
    await db.update(salonTerminalCharge).set({ status, failure, updatedAt: new Date() }).where(and(eq(salonTerminalCharge.id, id), eq(salonTerminalCharge.status, 'pending')))
  }

  /**
   * Stripe CONFIRMED the PaymentIntent: write the sale's payment (and the tip), once. The charge row is locked inside the payment's own
   * transaction and flipped to succeeded there, so a second poll finds it no longer pending and writes nothing.
   */
  async function record(charge: ChargeRow, pi: any): Promise<void> {
    const received = Number(pi.amount_received ?? pi.amount ?? 0)
    // What the card paid above the sale's amount is the tip — what the desk asked for, plus anything the reader added.
    const tip = Math.max(0, received - charge.amountCents)
    const amount = charge.amountCents
    let already = false
    const outcome = await recordInvoicePayment(db, { invoice, payment }, true, {
      invoiceId: charge.invoiceId, companyId: charge.companyId, amount: round2(amount / 100), method: 'card', reference: charge.paymentIntentId,
      notes: 'Card reader', tipAmount: round2(tip / 100), idempotentByReference: true,
      // Stripe already took this money: recorded even if the sale was paid another way while the reader waited.
      allowOverpayment: true,
      beforeWrite: async (tx: Tx) => {
        const [locked] = await tx.select().from(salonTerminalCharge).where(eq(salonTerminalCharge.id, charge.id)).limit(1).for('update')
        if (!locked || locked.status !== 'pending') { already = true; return 'recorded already' }
        await tx.update(salonTerminalCharge).set({ status: 'succeeded', tipCents: tip, updatedAt: new Date() }).where(eq(salonTerminalCharge.id, charge.id))
        return null
      },
    })
    if (already) return
    if (!outcome.ok) {
      // The card was charged but the sale cannot take it (voided meanwhile): a person must refund it. Said on the charge, in the log.
      logger.error('[chair-checkout] card taken but not recorded', { company: charge.companyId, charge: charge.id, error: outcome.error })
      await db.update(salonTerminalCharge).set({ status: 'needs_review', failure: `The card was charged but the sale could not take it (${outcome.error}). Refund it in Stripe.`.slice(0, 300), updatedAt: new Date() }).where(and(eq(salonTerminalCharge.id, charge.id), eq(salonTerminalCharge.status, 'pending')))
      return
    }
    await db.update(salonTerminalCharge).set({ paymentId: outcome.payment.id }).where(eq(salonTerminalCharge.id, charge.id))
    if (outcome.duplicate) return
    live.emitToCompany(charge.companyId, live.EVENTS.PAYMENT_RECEIVED, { invoiceId: charge.invoiceId, invoiceNumber: outcome.row.number, amount: round2(amount / 100), newBalance: outcome.newBalance, status: outcome.newStatus })
    if (outcome.newStatus === 'paid') live.emitToCompany(charge.companyId, live.EVENTS.INVOICE_PAID, { id: charge.invoiceId, number: outcome.row.number, total: outcome.row.total })
    try {
      await d.audit.log({ action: 'payment', entity: 'invoice', entityId: charge.invoiceId, entityName: outcome.row.number, companyId: charge.companyId, req: { user: { id: charge.startedById, companyId: charge.companyId } }, metadata: { amount: round2(amount / 100), tip: round2(tip / 100), method: 'card reader', reader: charge.readerId } })
    } catch (e: any) { logger.warn('[chair-checkout] payment not audited', { error: e?.message }) }
    // Same as any other payment: the stylist of a visit paid for this way earns on it.
    void d.services.earnCommission(charge.invoiceId).catch(() => {})
    // A paid sale is emailed its receipt (with the link to add a tip afterwards), once.
    if (outcome.newStatus === 'paid') void deps.receipts?.onPaid(charge.invoiceId)
    if (outcome.newStatus === 'paid') void deps.afterPaid?.(charge.invoiceId)?.catch?.(() => {})
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
          const [reader] = await db.select().from(salonReader).where(eq(salonReader.id, charge.readerId)).limit(1)
          let action: any = null
          if (reader) { try { action = ((await stripe.terminal.readers.retrieve(reader.stripeReaderId, {}, opts)) as any).action } catch { action = null } }
          const ours = action && action.process_payment_intent?.payment_intent === charge.paymentIntentId
          if (ours && action.status === 'failed') {
            // Declined, or the client pressed cancel on the reader: Stripe's words, and the PaymentIntent cancelled.
            await finish(charge.id, 'failed', String(action.failure_message || 'The card was declined.').slice(0, 300))
            try { await stripe.paymentIntents.cancel(charge.paymentIntentId, {}, opts) } catch { /* already gone */ }
          } else if (now() - charge.createdAt.getTime() > CHARGE_TIMEOUT_MS) {
            await giveUp(stripe, charge, reader?.stripeReaderId ?? null, 'timed_out', 'The reader waited too long for a card. Nothing was taken.')
          }
        }
      }
      charge = await chargeRow(companyId, id)
    }
    const [reader] = await db.select({ label: salonReader.label }).from(salonReader).where(eq(salonReader.id, charge.readerId)).limit(1)
    return chargeView(charge, reader?.label ?? null)
  }

  /** Stop the reader and cancel the PaymentIntent — and if Stripe says it already went through, record it instead. */
  async function giveUp(stripe: Stripe, charge: ChargeRow, stripeReaderId: string | null, status: 'canceled' | 'timed_out', why: string) {
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

  async function cancelCharge(actor: any, id: string): Promise<ChargeView> {
    const charge = await chargeRow(actor.companyId, id)
    if (charge.status !== 'pending') return pollCharge(actor.companyId, id)
    const stripe = stripeOf()
    if (!stripe) { await finish(charge.id, 'canceled', 'Cancelled at the desk.'); return pollCharge(actor.companyId, id) }
    const [reader] = await db.select().from(salonReader).where(eq(salonReader.id, charge.readerId)).limit(1)
    await giveUp(stripe, charge, reader?.stripeReaderId ?? null, 'canceled', `Cancelled at the desk by ${nameOf(actor)}.`)
    return pollCharge(actor.companyId, id)
  }

  /** Stripe's test helper: tap a test card on a SIMULATED reader (a test account only), to set up and to try the whole flow without hardware. */
  async function simulateCard(companyId: string, id: string, outcome: 'approve' | 'decline', extraTipCents = 0) {
    const charge = await chargeRow(companyId, id)
    const reader = await readerOf(companyId, charge.readerId)
    if (!String(reader.deviceType || '').startsWith('simulated')) throw new TerminalError('Only a simulated reader can be handed a test card.', 409, 'NOT_SIMULATED')
    const stripe = stripeOf()
    if (!stripe) throw new TerminalError('Card readers are not available on this server yet.', 503)
    const number = outcome === 'decline' ? '4000000000000002' : '4242424242424242'
    try {
      await (stripe as any).testHelpers.terminal.readers.presentPaymentMethod(reader.stripeReaderId, { type: 'card_present', card_present: { number }, ...(extraTipCents > 0 ? { amount_tip: extraTipCents } : {}) }, charge.stripeAccount ? { stripeAccount: charge.stripeAccount } : undefined)
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not take the test card.'), 400) }
    return pollCharge(companyId, id)
  }

  /** The card payments the reader took on a sale, with what has been refunded of each (so the sale's screen can offer "refund to card"). */
  async function paymentsFor(companyId: string, invoiceId: string) {
    const rows: ChargeRow[] = await db.select().from(salonTerminalCharge).where(and(eq(salonTerminalCharge.companyId, companyId), eq(salonTerminalCharge.invoiceId, invoiceId), eq(salonTerminalCharge.status, 'succeeded'))).orderBy(salonTerminalCharge.createdAt)
    const neg = await db.select({ amount: payment.amount, tip: payment.tipAmount, notes: payment.notes }).from(payment).where(and(eq(payment.invoiceId, invoiceId), lt(payment.amount, '0')))
    return rows.map((r) => {
      const marker = `Card reader refund (${r.id})`
      const mine = neg.filter((n: any) => String(n.notes || '').startsWith(marker))
      const refundedCents = mine.reduce((t: number, n: any) => t + Math.round(-Number(n.amount) * 100), 0)
      // The tip that already went back to the card (a refund row carries it as a negative tip).
      const tipRefundedCents = mine.reduce((t: number, n: any) => t + Math.round(-Number(n.tip || 0) * 100), 0)
      return { chargeId: r.id, paymentId: r.paymentId, amountCents: r.amountCents, tipCents: r.tipCents, refundedCents, tipRefundedCents, at: r.updatedAt.toISOString() }
    }).filter((r) => r.paymentId)
  }

  /** The newest card payment on a sale (so the panel picks up where it was after a reload). */
  async function latestFor(companyId: string, invoiceId: string): Promise<ChargeView | null> {
    const [row] = await db.select().from(salonTerminalCharge).where(and(eq(salonTerminalCharge.companyId, companyId), eq(salonTerminalCharge.invoiceId, invoiceId))).orderBy(desc(salonTerminalCharge.createdAt)).limit(1)
    if (!row) return null
    return row.status === 'pending' ? pollCharge(companyId, row.id) : chargeView(row)
  }

  // ─── Refunds ──────────────────────────────────────────────────────────────────────────────────
  /**
   * Give (part of) a reader payment back to the card, through Stripe on the salon's account, then record it on the sale. This is the way back
   * for a card the reader took: the sale's ordinary refund only writes a line in the books and sends no money.
   *
   * THE TIP (follow-up 10/30): refunding the rest of a payment — the refund that makes it fully refunded — gives back the tip with it,
   * always: a client who is refunded the whole sale does not keep paying the stylist. A partial refund leaves the tip unless the person
   * chooses `includeTip`, which returns the whole tip still outstanding on the payment. The tip goes back to the card in the same Stripe
   * refund (the PaymentIntent held sale + tip) and comes off the stylist's tips as a negative tip on the refund line.
   * Stripe's idempotency key is the charge, what was refunded before and what this refund is, so a retried click cannot refund twice; the
   * record is written once per Stripe refund id.
   */
  async function refundPayment(actor: any, paymentId: string, input: { amountCents?: unknown; reason?: unknown; includeTip?: unknown }) {
    const companyId = actor.companyId
    const [charge] = await db.select().from(salonTerminalCharge).where(and(eq(salonTerminalCharge.paymentId, String(paymentId || '')), eq(salonTerminalCharge.companyId, companyId))).limit(1)
    if (!charge) throw new TerminalError('That is not a card reader payment. Refund it from the sale.', 404, 'NOT_READER_PAYMENT')
    const marker = `Card reader refund (${charge.id})`
    const before = await db.select({ amount: payment.amount, tip: payment.tipAmount }).from(payment).where(and(eq(payment.invoiceId, charge.invoiceId), lt(payment.amount, '0'), like(payment.notes, `${marker}%`)))
    const refundedCents = before.reduce((t: number, r: any) => t + Math.round(-Number(r.amount) * 100), 0)
    const tipRefundedCents = before.reduce((t: number, r: any) => t + Math.round(-Number(r.tip || 0) * 100), 0)
    const left = charge.amountCents - refundedCents
    if (left <= 0) throw new TerminalError('That payment has already been refunded in full.', 409, 'ALREADY_REFUNDED')
    const want = input.amountCents == null || input.amountCents === '' ? left : Number(input.amountCents)
    if (!Number.isInteger(want) || want <= 0) throw new TerminalError('Enter an amount to refund.', 400, 'BAD_AMOUNT', 'amountCents')
    if (want > left) throw new TerminalError(`Only ${dollars(left)} of that payment can still be refunded.`, 400, 'OVER_REFUND', 'amountCents')
    // The tip still on this payment, and what the sale as a whole can still give back (the sale's own refund may have returned some).
    const tipLeft = Math.max(0, Math.min(charge.tipCents - tipRefundedCents, Math.round((await tipsOutstanding(db, charge.invoiceId)) * 100)))
    const tipBack = want === left || input.includeTip === true ? tipLeft : 0
    const reason = String(input.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!reason) throw new TerminalError('Give a reason for the refund.', 400, 'REASON_REQUIRED', 'reason')
    const { stripe } = await account(companyId)
    let refund: any
    try {
      refund = await stripe.refunds.create({ payment_intent: charge.paymentIntentId, amount: want + tipBack, metadata: { twomiah_charge: charge.id, reason, tip_cents: String(tipBack) } },
        { stripeAccount: charge.stripeAccount, idempotencyKey: `twomiah-chair-refund-${charge.id}-${refundedCents}-${tipRefundedCents}-${want}-${tipBack}` })
    } catch (e) { throw new TerminalError(stripeSays(e, 'Stripe did not make the refund. Try again.'), 502) }
    const out = await recordInvoiceRefund(db, { invoice, payment }, {
      invoiceId: charge.invoiceId, companyId, amount: round2(want / 100), method: 'card', reference: refund.id, notes: `${marker}: ${reason}`, idempotentByReference: true,
      tips: { amount: round2(tipBack / 100) },
    })
    if (!out.ok) {
      // Stripe has refunded and the books refused: said plainly, so a person can fix the record; Stripe's refund id is in the log.
      logger.error('[chair-checkout] refund issued but not recorded', { company: companyId, charge: charge.id, refund: refund.id, error: out.error })
      throw new TerminalError(`The card was refunded in Stripe, but the sale could not record it (${out.error}). Do not refund again.`, 409, 'NOT_RECORDED')
    }
    live.emitToCompany(companyId, live.EVENTS.INVOICE_UPDATED, out.invoice)
    try {
      await d.audit.log({ action: 'refund', entity: 'invoice', entityId: charge.invoiceId, entityName: out.row.number, companyId, req: { user: actor }, metadata: { amount: round2(want / 100), tip: round2(tipBack / 100), method: 'card reader', reason, stripeRefund: refund.id } })
    } catch (e: any) { logger.warn('[chair-checkout] refund not audited', { error: e?.message }) }
    void d.services.earnCommission(charge.invoiceId).catch(() => {})
    return { refundedCents: want, tipRefundedCents: tipBack, invoiceStatus: out.newStatus }
  }

  return { listReaders, registerReader, removeReader, startCharge, pollCharge, cancelCharge, simulateCard, latestFor, paymentsFor, refundPayment, tips, receipts: deps.receipts }
}
export type ChairCheckout = ReturnType<typeof createChairCheckout>

/** /api/chair-checkout (behind `chair_checkout`). Taking a card asks the right a payment asks; pairing a reader is configuration. */
export function createChairCheckoutRoutes(d: CrmDeps, t: ChairCheckout) {
  const { requirePermission } = d.permissions
  // The front desk takes a card with its own narrow right (`cardreader:use`) — not pairing readers, not refunds, not general invoice editing.
  // Everyone who held invoices:update before (manager, admin, owner) passes exactly as they did.
  const mayCharge = d.permissions.requireAnyPermission(['invoices:update', 'cardreader:use'])
  const app = new Hono<AppEnv>()

  async function act(c: any, status: 200 | 201, fn: () => Promise<object>) {
    try { return one(c, { ok: true, ...(await fn()) }, status) }
    catch (e: any) {
      if (e instanceof TerminalError) return fail(c, e.status as any, e.message, e.code, e.field ? { [e.field]: e.message } : undefined)
      d.logger.error('[chair-checkout]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not go through. Try again.')
    }
  }
  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>

  app.get('/readers', mayCharge, async (c) => {
    c.header('Cache-Control', 'no-store')
    return act(c, 200, async () => ({ readers: await t.listReaders((c.get('user') as any).companyId, c.req.query('live') === '1') }))
  })
  app.post('/readers', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 201, async () => {
      const reader = await t.registerReader(u, b)
      d.audit.log({ req: c, action: 'create', entity: 'salon_reader', entityId: reader.id, entityName: reader.label })
      return { reader }
    })
  })
  app.delete('/readers/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    return act(c, 200, async () => {
      const out = await t.removeReader(u.companyId, c.req.param('id'))
      d.audit.log({ req: c, action: 'delete', entity: 'salon_reader', entityId: c.req.param('id') })
      return out
    })
  })

  app.post('/charges', mayCharge, async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 201, async () => ({ charge: await t.startCharge(u, b) }))
  })
  app.get('/charges/:id', mayCharge, async (c) => {
    c.header('Cache-Control', 'no-store')
    return act(c, 200, async () => ({ charge: await t.pollCharge((c.get('user') as any).companyId, c.req.param('id')) }))
  })
  app.get('/sales/:invoiceId/charge', mayCharge, async (c) => {
    c.header('Cache-Control', 'no-store')
    return act(c, 200, async () => ({ charge: await t.latestFor((c.get('user') as any).companyId, c.req.param('invoiceId')) }))
  })
  app.get('/sales/:invoiceId/payments', requirePermission('invoices:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return act(c, 200, async () => ({ payments: await t.paymentsFor((c.get('user') as any).companyId, c.req.param('invoiceId')) }))
  })
  app.post('/charges/:id/cancel', mayCharge, async (c) => {
    const u = c.get('user') as any
    return act(c, 200, async () => ({ charge: await t.cancelCharge(u, c.req.param('id')) }))
  })
  // Money back to the card: the right every refund asks for (payments:delete), not the right a payment asks.
  app.post('/payments/:paymentId/refund', requirePermission('payments:delete'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    return act(c, 200, async () => t.refundPayment(u, c.req.param('paymentId'), b))
  })
  // Who the sale's tip goes to (salon parity row 10): by the value of each person's services unless the salon set the shares on this sale.
  // Read by anyone who can see the sale; changed by the seat that takes the payment, at checkout and afterwards. Reports follow at once.
  const shares = createTipShares(d.db)
  // The salon's tip percentages (row 11): read by the desk, set by whoever configures the salon; a change goes to the readers' tip screens too.
  app.get('/tip-settings', requirePermission('invoices:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    return one(c, await t.tips.settings((c.get('user') as any).companyId))
  })
  app.put('/tip-settings', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    const got = parseTipSettings(b)
    if ('fields' in got) return fail(c, 400, Object.values(got.fields)[0], 'BAD_TIPS', got.fields)
    const before = await t.tips.settings(u.companyId)
    const out = await t.tips.save(u.companyId, got.values)
    d.audit.log({ req: c, action: 'update', entity: 'salon_tip_settings', entityId: u.companyId, changes: { before: before.presets.join('/') + (before.lateTipLink ? '' : ' no late-tip link'), after: out.settings.presets.join('/') + (out.settings.lateTipLink ? '' : ' no late-tip link') } })
    return one(c, { ...out.settings, readers: out.readers })
  })
  // What the desk shows for a sale: the percentages worked on the services of the amount being charged (retail left out).
  app.get('/sales/:invoiceId/tip-info', requirePermission('invoices:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    const raw = c.req.query('amountCents')
    const amount = raw == null || raw === '' ? null : Number(raw)
    if (amount != null && !(Number.isInteger(amount) && amount > 0)) return fail(c, 400, 'The amount is a whole number of cents.', 'BAD_AMOUNT')
    const out = await t.tips.info((c.get('user') as any).companyId, c.req.param('invoiceId'), amount)
    return out ? one(c, out) : fail(c, 404, 'Sale not found')
  })
  // Send the receipt again (or for the first time, for a sale paid some way that sent none).
  app.post('/sales/:invoiceId/receipt', mayCharge, async (c) => {
    const u = c.get('user') as any
    if (!t.receipts) return fail(c, 503, 'Receipts are not available.')
    const outcome = await t.receipts.send(c.req.param('invoiceId'), { auto: false, companyId: u.companyId })
    const words: Record<string, string> = { no_email: 'This client has no email address on file.', not_paid: 'The receipt is sent once the sale is paid.', off: 'Receipts are not switched on for this salon.', failed: 'The receipt could not be sent. Try again.', already_sent: 'Already sent.' }
    if (outcome !== 'sent') return fail(c, outcome === 'failed' ? 502 : 409, words[outcome] || 'The receipt was not sent.', outcome.toUpperCase())
    d.audit.log({ req: c, action: 'update', entity: 'invoice', entityId: c.req.param('invoiceId'), changes: { receipt: 'emailed' } })
    return one(c, { sent: true })
  })
  app.get('/sales/:invoiceId/tip-split', requirePermission('invoices:read'), async (c) => {
    c.header('Cache-Control', 'no-store')
    const view = await shares.view((c.get('user') as any).companyId, c.req.param('invoiceId'))
    return view ? one(c, view) : fail(c, 404, 'Sale not found')
  })
  app.put('/sales/:invoiceId/tip-split', mayCharge, async (c) => {
    const u = c.get('user') as any
    const invoiceId = c.req.param('invoiceId')
    const b = await body(c)
    const before = await shares.view(u.companyId, invoiceId)
    if (!before) return fail(c, 404, 'Sale not found')
    if (b.reset === true) {
      await shares.save(u.companyId, invoiceId, null, u.userId || u.id || null)
    } else {
      const rows = Array.isArray(b.shares) ? (b.shares as any[]).map((r) => ({ key: String(r?.key ?? ''), percent: r?.percent })) : []
      const known = await shares.knownKeys(u.companyId)
      if (rows.some((r) => !known.has(r.key))) return fail(c, 400, 'Choose people from your team.', 'UNKNOWN_PERSON')
      const got = weightsFromPercents(rows)
      if ('problem' in got) return fail(c, 400, got.problem, 'BAD_SPLIT', { shares: got.problem })
      await shares.save(u.companyId, invoiceId, got.weights, u.userId || u.id || null)
    }
    const after = await shares.view(u.companyId, invoiceId)
    d.audit.log({ req: c, action: 'update', entity: 'sale_tip_split', entityId: invoiceId, changes: { before: before.people.map((p) => `${p.name} ${p.percent}%`).join(', '), after: after!.people.map((p) => `${p.name} ${p.percent}%`).join(', ') } })
    d.realtime.emitToCompany(u.companyId, d.realtime.EVENTS.REFRESH, { entity: 'invoice' })
    return one(c, after!)
  })
  // A test card on a simulated reader: configuration-level, because it exists to set the reader up.
  app.post('/charges/:id/simulate', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const b = await body(c)
    const outcome = b.outcome === 'decline' ? 'decline' : 'approve'
    return act(c, 200, async () => ({ charge: await t.simulateCard(u.companyId, c.req.param('id'), outcome, Math.max(0, Math.round(Number(b.tipCents) || 0))) }))
  })
  return app
}
