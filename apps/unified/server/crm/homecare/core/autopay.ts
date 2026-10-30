// Autopay: a family's saved card pays each invoice as the agency issues it — on the AGENCY's own Stripe account.
//
// Money rules (the brief's, and the reason for most of the code below):
//   · every call carries the agency's connected account (stripeAccount); with none connected, or Online Payments off
//     (crm/cardPayments.ts — the same answer the pay page uses), nothing is asked of Stripe. Nothing is ever charged to ours.
//   · the card is typed only on Stripe's own page (Checkout in setup mode) and the wording the family agrees to is shown
//     there with it. We keep Stripe's ids, the brand and last four, and the wording + moment of consent. No card field in our
//     code, none on the phone.
//   · once per try: a try is CLAIMED in autopay_attempt (unique per invoice and try number) before Stripe is asked, and
//     Stripe is given the same idempotency key for the same try — a replayed release, two scans or two servers cannot take
//     the money twice. A try whose answer was lost (a dropped connection) stays 'pending' and is re-asked, with the same key,
//     after a few minutes; Stripe answers it with what already happened.
//   · what is charged is what is owed when the try starts, and a payment lands on the invoice ledger by the payment intent's id,
//     whichever of our reply or Stripe's webhook gets there first — recorded once (recordInvoicePayment dedupes by reference).
//   · a draft invoice is never charged; an invoice with nothing owed is not charged; one sent and paid another way is not.
//
// Failures: a card that is declined is retried 2, 3 and 4 days apart (four tries in all) and the family and the office are
// told each time, in plain words. A card that can never work (lost, stolen, expired, closed) is not retried and autopay
// pauses until a new card is saved. A bank that asks the card's owner to approve (authentication) ends the tries for that
// invoice — it needs the family — and says so.
//
// Runs only for a company with the care_autopay feature on (not ready until the owner has tested it with a real card).
import { and, eq } from 'drizzle-orm'
import { documentLinkToken, documentLinkPath } from '@twomiah/tenant-backend'
import { autopayAttempt, clientAutopay, clients, company, invoices } from '../../../db/schema/index.ts'
import {
  attemptByIntent, attemptsForInvoice, attemptsNeedingAttention, autopayClients, billingContactOf, claimAttempt, companiesWithAutopay, invoicesDueForCharge,
  reclaimStaleAttempt, releaseHardDeclines,
} from '../../../data/homecareAutopay.ts'
import { invoiceForEmail } from '../../../data/homecareBillingRoutes.ts'
import type { CrmDeps } from '../../deps.ts'
import { cardPaymentsFor } from '../../cardPayments.ts'
import type { AgencyTime } from './agencyTime.ts'
import { ymdIn } from './agencyTime.ts'
import type { InvoiceEngine } from './invoiceEngine.ts'
import type { VisitNotify } from './visitNotify.ts'
import type { HomecareEmail } from './messages.ts'
import { stripeClientFor } from './stripeClient.ts'

export const AUTOPAY_FEATURE = 'care_autopay'
/** Four tries in all, then the family is asked to pay another way. */
export const MAX_ATTEMPTS = 4
/** Days to wait after try 1, 2 and 3. */
export const RETRY_DAYS = [2, 3, 4] as const
/** A try that started this long ago and never finished is asked again (with the same key). */
export const STALE_MINUTES = 15
/** Codes after which this card can never be charged: the tries stop and autopay pauses until a new card is saved. */
export const HARD_DECLINES = new Set([
  'lost_card', 'stolen_card', 'pickup_card', 'expired_card', 'invalid_account', 'card_not_supported', 'fraudulent',
  'incorrect_number', 'invalid_number', 'invalid_expiry_month', 'invalid_expiry_year', 'restricted_card', 'no_account', 'closed_account',
])
const needsOwner = (code: string | null | undefined) => code === 'authentication_required' || code === 'authentication_not_handled'

/** What a family is told, in plain words, for a Stripe reason. */
export function reasonInWords(code: string | null | undefined): string {
  switch (code) {
    case 'insufficient_funds': return 'the card did not have enough available'
    case 'expired_card': return 'the card has expired'
    case 'lost_card': case 'stolen_card': case 'pickup_card': case 'invalid_account': case 'closed_account': case 'no_account': return 'the card can no longer be used'
    case 'incorrect_number': case 'invalid_number': case 'invalid_expiry_month': case 'invalid_expiry_year': return 'the card details on file are not valid'
    case 'incorrect_cvc': case 'invalid_cvc': return 'the card\'s security code was not accepted'
    case 'authentication_required': case 'authentication_not_handled': return 'the card\'s bank needs the card owner to approve this payment'
    case 'card_velocity_exceeded': case 'withdrawal_count_limit_exceeded': return 'the card has reached a limit set by its bank'
    case 'amount_changed': return 'the amount owed changed while the payment was being made'
    default: return 'the card was declined by its bank'
  }
}

/** The wording the family agrees to, shown on Stripe's page beside the card form. */
export const consentWording = (agencyName: string) =>
  `I authorize ${agencyName} to charge this card for each invoice it sends me for care, when the invoice is issued, until I cancel by telling ${agencyName}. I can pay an invoice another way at any time.`

/** Stripe's errors that mean it did NOT take the money; anything else (a dropped connection) leaves the answer unknown. */
const DEFINITE = new Set(['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError', 'card_error', 'invalid_request_error'])

const cents = (dollars: number) => Math.round(dollars * 100)
const owedOf = (inv: { total: unknown; amountPaid?: unknown; amountAdjusted?: unknown }) =>
  Math.max(0, Math.round((Number(inv.total) - Number(inv.amountPaid || 0) - Number(inv.amountAdjusted || 0)) * 100) / 100)

export type ChargeResult = { status: 'charged' | 'failed' | 'needs_family' | 'pending' | 'skipped'; reason?: string; attemptNo?: number }

export function createAutopay(d: CrmDeps, deps: { invoices: Pick<InvoiceEngine, 'recordInvoicePayment'>; time: AgencyTime; notify: VisitNotify; email: HomecareEmail }) {
  const canTakeCards = cardPaymentsFor(d)
  const stripe = () => stripeClientFor(d)
  const accountFor = (companyId: string) => d.services.stripeService.connectedAccountFor(companyId)
  const isOn = (companyId: string) => d.features.isFeatureEnabled(companyId, AUTOPAY_FEATURE)

  async function agencyName(companyId: string): Promise<string> {
    const [row] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return row?.name || 'Our agency'
  }

  const rowFor = async (companyId: string, clientId: string) =>
    (await d.db.select().from(clientAutopay).where(and(eq(clientAutopay.companyId, companyId), eq(clientAutopay.clientId, clientId))).limit(1))[0] ?? null

  /** What the office sees for one client: no card, a link out, or the card on file (brand and last four only). */
  async function statusOf(companyId: string, clientId: string) {
    const row = await rowFor(companyId, clientId)
    if (!row || row.status === 'removed') return { status: 'none' as const }
    return {
      status: row.status as 'pending' | 'active' | 'paused', pausedReason: row.pausedReason ? reasonInWords(row.pausedReason) : null,
      brand: row.brand, last4: row.last4, expMonth: row.expMonth, expYear: row.expYear, consentAt: row.consentAt,
    }
  }

  // ── Saving a card ────────────────────────────────────────────────────────────────────────────────

  /**
   * Stripe's own page for saving a card, on the agency's account. Returns the page's address, or why it cannot be made.
   * Saving a second card replaces the first only once the new one is saved.
   */
  async function startSetup(companyId: string, clientId: string, urls: { success: string; cancel: string }, userId?: string | null):
    Promise<{ url: string } | { problem: string; code: string; status: number }> {
    const s = await stripe()
    if (!s) return { problem: 'Card payments are not available on your account yet — contact Twomiah to switch them on.', code: 'payments_unavailable', status: 503 }
    if (!(await canTakeCards(companyId).catch(() => false))) {
      return { problem: 'Card payments are not connected — connect Stripe in Settings › Integrations and switch on Online Payments.', code: 'payments_unavailable', status: 400 }
    }
    const account = await accountFor(companyId)
    if (!account) return { problem: 'Card payments are not connected — connect Stripe in Settings › Integrations.', code: 'payments_unavailable', status: 400 }
    const [client] = await d.db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    if (!client) return { problem: 'Client not found', code: 'not_found', status: 404 }

    const opts = { stripeAccount: account }
    let row = await rowFor(companyId, clientId)
    // A customer made on another account is no use on this one.
    let customerId = row?.stripeCustomerId && row.stripeAccount === account ? row.stripeCustomerId : null
    if (!customerId) {
      const customer = await s.customers.create({
        name: `${client.firstName} ${client.lastName}`.trim(), email: client.email || undefined,
        metadata: { client_id: clientId, company_id: companyId },
      }, opts)
      customerId = String(customer.id)
    }
    const wording = consentWording(await agencyName(companyId))
    const session = await s.checkout.sessions.create({
      mode: 'setup', customer: customerId, payment_method_types: ['card'], currency: 'usd',
      success_url: urls.success, cancel_url: urls.cancel,
      custom_text: { submit: { message: wording } },
      metadata: { autopay_client_id: clientId, autopay_company_id: companyId },
      setup_intent_data: { metadata: { autopay_client_id: clientId, autopay_company_id: companyId } },
    }, opts)

    if (row) {
      await d.db.update(clientAutopay).set({
        stripeAccount: account, stripeCustomerId: customerId, setupSessionId: String(session.id), consentText: wording,
        status: row.status === 'removed' ? 'pending' : row.status, updatedAt: new Date(),
      }).where(eq(clientAutopay.id, row.id))
    } else {
      await d.db.insert(clientAutopay).values({
        companyId, clientId, status: 'pending', stripeAccount: account, stripeCustomerId: customerId,
        setupSessionId: String(session.id), consentText: wording, createdBy: userId || null,
      }).onConflictDoNothing()
    }
    return { url: String(session.url) }
  }

  /** The card was saved on Stripe's page: keep its id, brand and last four, and the moment the family agreed. */
  async function onSetupCompleted(session: any): Promise<boolean> {
    const clientId = session?.metadata?.autopay_client_id, companyId = session?.metadata?.autopay_company_id
    if (!clientId || !companyId) return false
    const row = await rowFor(companyId, clientId)
    // Only the page we made for this client counts: a made-up event cannot attach a card.
    if (!row || !row.setupSessionId || row.setupSessionId !== session.id) {
      d.logger.warn('[autopay] setup event for a page we did not make', { clientId })
      return true
    }
    const s = await stripe()
    if (!s || !row.stripeAccount) return true
    try {
      const opts = { stripeAccount: row.stripeAccount }
      const intent = await s.setupIntents.retrieve(String(session.setup_intent), opts)
      const pmId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id
      if (!pmId) return true
      const pm = await s.paymentMethods.retrieve(pmId, opts)
      const previous = row.paymentMethodId && row.paymentMethodId !== pmId ? row.paymentMethodId : null
      await d.db.update(clientAutopay).set({
        status: 'active', pausedReason: null, paymentMethodId: pmId, brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null, expYear: pm.card?.exp_year ?? null, consentAt: new Date(), updatedAt: new Date(),
      }).where(eq(clientAutopay.id, row.id))
      if (previous) await s.paymentMethods.detach(previous, opts).catch(() => {})
      // Invoices that stopped because the old card was finished are tried again with this one, and any waiting are tried now.
      await releaseHardDeclines(d.db, companyId, clientId, MAX_ATTEMPTS)
      await sweepCompany(companyId).catch(() => 0)
    } catch (e: any) {
      d.logger.error('[autopay] could not read the saved card', { error: e?.message })
    }
    return true
  }

  /** Stop charging this client's card. Their open invoices are left to be paid another way. */
  async function remove(companyId: string, clientId: string): Promise<boolean> {
    const row = await rowFor(companyId, clientId)
    if (!row || row.status === 'removed') return false
    await d.db.update(clientAutopay).set({ status: 'removed', paymentMethodId: null, updatedAt: new Date() }).where(eq(clientAutopay.id, row.id))
    const s = await stripe()
    if (s && row.paymentMethodId && row.stripeAccount) await s.paymentMethods.detach(row.paymentMethodId, { stripeAccount: row.stripeAccount }).catch(() => {})
    return true
  }

  // ── Charging an invoice ──────────────────────────────────────────────────────────────────────────

  async function recordSuccess(companyId: string, invoiceId: string, attemptId: string, intentId: string, amountCents: number) {
    const paymentDate = await deps.time.today(companyId)
    await deps.invoices.recordInvoicePayment({
      companyId, invoiceId, amount: amountCents / 100, paymentDate, method: 'stripe', reference: intentId, notes: 'Autopay', allowOverpayment: true,
    })
    await d.db.update(invoices).set({ stripePaymentIntentId: intentId, updatedAt: new Date() }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    await d.db.update(autopayAttempt).set({ status: 'succeeded', paymentIntentId: intentId, failureCode: null, failureMessage: null, nextAttemptAt: null, updatedAt: new Date() })
      .where(eq(autopayAttempt.id, attemptId))
  }

  /** Close a try that did not take the money: when the next one is, whether this card is finished, and who is told. */
  async function recordFailure(attempt: { id: string; companyId: string; invoiceId: string; clientId: string; attemptNo: number; amountCents: number },
    f: { code: string | null; message: string | null; intentId?: string | null }, at: Date): Promise<ChargeResult> {
    const ownerNeeded = needsOwner(f.code)
    const hard = !!f.code && HARD_DECLINES.has(f.code)
    const last = attempt.attemptNo >= MAX_ATTEMPTS
    const retry = !hard && !ownerNeeded && !last
    const nextAt = retry ? new Date(at.getTime() + RETRY_DAYS[attempt.attemptNo - 1]! * 86_400_000) : null
    await d.db.update(autopayAttempt).set({
      status: ownerNeeded ? 'needs_action' : 'failed', paymentIntentId: f.intentId ?? null, failureCode: f.code, failureMessage: f.message,
      hardDecline: hard, nextAttemptAt: nextAt, updatedAt: new Date(),
    }).where(eq(autopayAttempt.id, attempt.id))
    if (hard) {
      await d.db.update(clientAutopay).set({ status: 'paused', pausedReason: f.code, updatedAt: new Date() })
        .where(and(eq(clientAutopay.companyId, attempt.companyId), eq(clientAutopay.clientId, attempt.clientId), eq(clientAutopay.status, 'active')))
    }
    await notifyFailure(attempt, f.code, nextAt).catch((e: any) => d.logger.error('[autopay] failure notice', { error: e?.message }))
    return { status: ownerNeeded ? 'needs_family' : 'failed', reason: reasonInWords(f.code), attemptNo: attempt.attemptNo }
  }

  /** The family's email and the office's notice for a failed try. Once per try. */
  async function notifyFailure(attempt: { id: string; companyId: string; invoiceId: string; attemptNo: number; amountCents: number }, code: string | null, nextAt: Date | null) {
    const inv = await invoiceForEmail(d.db, attempt.companyId, attempt.invoiceId)
    if (!inv) return
    const tz = await deps.time.timezone(attempt.companyId)
    const reason = reasonInWords(code)
    const number = String(inv.seqNumber ?? inv.invoiceNumber)
    const amountDue = (attempt.amountCents / 100).toFixed(2)
    const retryOn = nextAt ? ymdIn(nextAt, tz) : null
    // The stored billing contact first (the person who pays), else the portal email, else the client's own email.
    const billing = await billingContactOf(d.db, attempt.companyId, inv.clientId)
    const to = billing?.email || inv.clientEmail
    if (to && deps.email.isConfigured) {
      const token = await documentLinkToken(d.db, invoices, attempt.invoiceId)
      await deps.email.sendAutopayFailed(to, {
        companyName: await agencyName(attempt.companyId), contactName: (billing?.email ? billing.name : null) || `${inv.firstName} ${inv.lastName}`.trim(),
        invoiceNumber: number, amountDue, reason, retryOn, documentPath: token ? documentLinkPath(token) : null,
      }).catch((e: any) => d.logger.error('[autopay] email not sent', { error: e?.message }))
    }
    await deps.notify.notifyAdmins(attempt.companyId, 'autopay_failed',
      nextAt ? 'Automatic payment did not go through' : 'Automatic payment failed — needs a call',
      `${inv.firstName} ${inv.lastName}, invoice #${number} ($${amountDue}): ${reason}. ${nextAt ? `Trying again on ${retryOn}.` : 'No more automatic tries — ask the family to pay another way.'}`)
    await d.db.update(autopayAttempt).set({ notifiedAt: new Date() }).where(eq(autopayAttempt.id, attempt.id))
  }

  /**
   * Charge one invoice's balance to its client's saved card, if it is due. `force` (the office's "Try now") skips the wait
   * between tries but never a card that is finished, a family that must approve, a paid invoice or the fourth try.
   */
  async function chargeInvoice(companyId: string, invoiceId: string, opts: { force?: boolean; at?: Date } = {}): Promise<ChargeResult> {
    const at = opts.at ?? new Date()
    const skip = (reason: string): ChargeResult => ({ status: 'skipped', reason })
    if (!(await isOn(companyId))) return skip('autopay_off')
    const [inv] = await d.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1)
    if (!inv) return skip('no_invoice')
    if (!inv.sentAt) return skip('draft')
    if (inv.paymentStatus === 'paid') return skip('paid')
    const owed = owedOf(inv)
    if (owed <= 0) return skip('nothing_owed')
    const card = await rowFor(companyId, inv.clientId)
    if (!card || card.status !== 'active' || !card.paymentMethodId || !card.stripeCustomerId) return skip('no_card')
    const s = await stripe()
    if (!s) return skip('stripe_unavailable')
    // The agency's own account, always: refused when it is not connected, or the card was saved on another account.
    if (!(await canTakeCards(companyId).catch(() => false))) return skip('cards_not_connected')
    const account = await accountFor(companyId)
    if (!account || card.stripeAccount !== account) return skip('account_changed')

    // Which try is this? Read the history first: what stops another try is written down there.
    const history = await attemptsForInvoice(d.db, companyId, invoiceId)
    const latest = history[history.length - 1]
    let attemptNo = (latest ? Number(latest.attemptNo) : 0) + 1
    let claimed: string | null = null
    let amountCents = cents(owed)
    if (latest) {
      if (latest.status === 'succeeded') return skip('already_charged')
      if (latest.status === 'needs_action') return skip('needs_family')
      if (latest.status === 'failed') {
        if (latest.hardDecline) return skip('card_finished')
        if (Number(latest.attemptNo) >= MAX_ATTEMPTS) return skip('no_more_tries')
        if (!opts.force && latest.nextAttemptAt && new Date(latest.nextAttemptAt).getTime() > at.getTime()) return skip('waiting')
      }
      if (latest.status === 'pending') {
        // Still being asked of Stripe — or never finished. Only a stale one is taken over, and only at the amount it was made for.
        claimed = await reclaimStaleAttempt(d.db, companyId, invoiceId, Number(latest.attemptNo), STALE_MINUTES)
        if (!claimed) return skip('in_progress')
        attemptNo = Number(latest.attemptNo)
        amountCents = Number(latest.amountCents)
        if (amountCents !== cents(owed)) {
          const row = { id: claimed, companyId, invoiceId, clientId: inv.clientId, attemptNo, amountCents }
          return recordFailure(row, { code: 'authentication_required', message: 'The amount owed changed while a try was unfinished.' }, at)
            .then((r) => ({ ...r, reason: reasonInWords('amount_changed') }))
        }
      }
    }
    if (!claimed) {
      claimed = await claimAttempt(d.db, companyId, invoiceId, inv.clientId, attemptNo, amountCents)
      if (!claimed) return skip('in_progress')
    }
    const attempt = { id: claimed, companyId, invoiceId, clientId: inv.clientId, attemptNo, amountCents }

    try {
      const intent = await s.paymentIntents.create({
        amount: amountCents, currency: 'usd', customer: card.stripeCustomerId, payment_method: card.paymentMethodId,
        off_session: true, confirm: true, description: `Invoice #${inv.seqNumber ?? inv.invoiceNumber} (autopay)`,
        metadata: { kind: 'homecare_autopay', invoice_id: invoiceId, company_id: companyId, client_id: inv.clientId, attempt: String(attemptNo) },
      }, { stripeAccount: account, idempotencyKey: `autopay-${invoiceId}-${attemptNo}` })
      await d.db.update(autopayAttempt).set({ paymentIntentId: String(intent.id), updatedAt: new Date() }).where(eq(autopayAttempt.id, claimed))
      if (intent.status === 'succeeded') {
        await recordSuccess(companyId, invoiceId, claimed, String(intent.id), amountCents)
        return { status: 'charged', attemptNo }
      }
      if (intent.status === 'processing') return { status: 'pending', reason: 'processing', attemptNo } // the webhook finishes it
      const code = intent.last_payment_error?.decline_code || intent.last_payment_error?.code || (intent.status === 'requires_action' ? 'authentication_required' : null)
      return await recordFailure(attempt, { code, message: intent.last_payment_error?.message ?? null, intentId: String(intent.id) }, at)
    } catch (err: any) {
      if (!DEFINITE.has(String(err?.type))) {
        // Stripe's answer is unknown (a dropped connection): the try stays open and is asked again, with the same key, later.
        d.logger.error('[autopay] no answer from Stripe — the try stays open', { invoiceId, error: err?.message })
        return { status: 'pending', reason: 'no_answer', attemptNo }
      }
      const code = err?.decline_code || err?.code || null
      return await recordFailure(attempt, { code, message: err?.message ?? null, intentId: err?.payment_intent?.id ?? null }, at)
    }
  }

  /** An invoice was just issued (released or emailed): charge it if its client has a card. Never throws, never delays the release. */
  async function onIssued(companyId: string, invoiceId: string): Promise<ChargeResult | null> {
    try { return await chargeInvoice(companyId, invoiceId) } catch (e: any) {
      d.logger.error('[autopay] could not charge on issue', { invoiceId, error: e?.message }); return null
    }
  }

  // ── Stripe's events ──────────────────────────────────────────────────────────────────────────────

  /** A payment intent of ours finished after our call returned (a slow bank): settle its try. */
  async function onIntentEvent(event: any): Promise<boolean> {
    const pi = event?.data?.object
    if (!pi || pi.metadata?.kind !== 'homecare_autopay') return false
    const attempt = await attemptByIntent(d.db, String(pi.id))
    // Only a try we made counts: the intent is on the row we claimed, or the row the metadata names, at the amount we asked.
    const row = attempt ?? (await d.db.select().from(autopayAttempt)
      .where(and(eq(autopayAttempt.invoiceId, String(pi.metadata.invoice_id)), eq(autopayAttempt.attemptNo, Number(pi.metadata.attempt)))).limit(1))
      .map((r: any) => ({ id: r.id, companyId: r.companyId, invoiceId: r.invoiceId, clientId: r.clientId, status: r.status, amountCents: r.amountCents, attemptNo: r.attemptNo }))[0]
    if (!row) return true
    const full = (await d.db.select().from(autopayAttempt).where(eq(autopayAttempt.id, row.id)).limit(1))[0]
    if (!full || full.companyId !== pi.metadata.company_id || full.amountCents !== Number(pi.amount)) return true
    if (event.type === 'payment_intent.succeeded' && full.status !== 'succeeded') {
      await recordSuccess(full.companyId, full.invoiceId, full.id, String(pi.id), full.amountCents)
    } else if (event.type === 'payment_intent.payment_failed' && full.status === 'pending') {
      const code = pi.last_payment_error?.decline_code || pi.last_payment_error?.code || null
      await recordFailure(full, { code, message: pi.last_payment_error?.message ?? null, intentId: String(pi.id) }, new Date())
    }
    return true
  }

  /** Home care's webhook calls this first: true when the event was autopay's (a saved card, or one of our charges). */
  async function onEvent(event: any): Promise<boolean> {
    if (event?.type === 'checkout.session.completed' && event.data?.object?.mode === 'setup') return onSetupCompleted(event.data.object)
    if (event?.type === 'payment_intent.succeeded' || event?.type === 'payment_intent.payment_failed') return onIntentEvent(event)
    return false
  }

  // ── The scan ─────────────────────────────────────────────────────────────────────────────────────

  async function sweepCompany(companyId: string, at: Date = new Date()): Promise<number> {
    if (!(await isOn(companyId))) return 0
    let charged = 0
    for (const due of await invoicesDueForCharge(d.db, companyId, MAX_ATTEMPTS, STALE_MINUTES)) {
      try { if ((await chargeInvoice(due.companyId, due.id, { at })).status === 'charged') charged++ } catch (e: any) { d.logger.error('[autopay] one invoice', { error: e?.message }) }
    }
    return charged
  }

  /** Every company's due invoices — the safety net behind the charge on issue, and the retries. Returns how many were charged. */
  async function sweep(at: Date = new Date()): Promise<number> {
    let n = 0
    for (const companyId of await companiesWithAutopay(d.db)) {
      try { n += await sweepCompany(companyId, at) } catch (e: any) { d.logger.error('[autopay] one company', { companyId, error: e?.message }) }
    }
    return n
  }

  return { statusOf, startSetup, remove, chargeInvoice, onIssued, onEvent, sweep, sweepCompany, attemptsForInvoice: (companyId: string, invoiceId: string) => attemptsForInvoice(d.db, companyId, invoiceId), clients: (companyId: string) => autopayClients(d.db, companyId), needingAttention: (companyId: string) => attemptsNeedingAttention(d.db, companyId) }
}

export type Autopay = ReturnType<typeof createAutopay>
