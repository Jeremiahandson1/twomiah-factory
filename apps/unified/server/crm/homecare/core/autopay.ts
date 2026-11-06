// Autopay: a family's saved card or bank account pays each invoice as the agency issues it — on the AGENCY's own Stripe account.
//
// Money rules (the brief's, and the reason for most of the code below):
//   · every call carries the agency's connected account (stripeAccount); with none connected, or Online Payments off
//     (crm/cardPayments.ts — the same answer the pay page uses), nothing is asked of Stripe. Nothing is ever charged to ours.
//   · the card or bank account is typed only on Stripe's own page (Checkout in setup mode) and the wording the family agrees
//     to is shown there with it. We keep Stripe's ids, the brand / bank name and last four, and the wording + moment of consent.
//     No card field in our code, none on the phone.
//   · once per try: a try is CLAIMED in autopay_attempt (unique per invoice and try number) before Stripe is asked, and
//     Stripe is given the same idempotency key for the same try — a replayed release, two scans or two servers cannot take
//     the money twice. A try whose answer was lost (a dropped connection) stays 'pending' and is re-asked, with the same key,
//     after a few minutes; Stripe answers it with what already happened.
//   · what is charged is what is owed when the try starts (or the scheduled part of it), and a payment lands on the invoice
//     ledger by the payment intent's id, whichever of our reply or Stripe's webhook gets there first — recorded once.
//   · a draft invoice is never charged; an invoice with nothing owed is not charged; one sent and paid another way is not.
//
// Failures: a declined card is retried on the agency's own schedule (settings.retryDays — up to 7 waits, 14 days in all, as
// Stripe's Smart Retries allow 8 tries in 2 weeks; 2, 3 and 4 days apart until the agency changes it) and the family and the
// office are told each time, in plain words. A card that can never work (lost, stolen, expired, closed) is not retried and
// autopay pauses until a new one is saved. A bank that asks the card's owner to approve (authentication) ends the tries for
// that invoice — it needs the family — and says so; reminders follow on the agency's days (settings.approvalReminderDays).
// A bank debit (ACH, PAD) is retried only for insufficient funds and at most twice, Stripe's own rule for ACH.
//
// Row 22 (parity, 10/31) added: bank debit — US ACH (us_bank_account) and Canadian pre-authorized debit (acss_debit) — each
// with its authorisation wording; a relative or the client saving the card or bank from the portal; a receipt email after each
// successful charge; charges the office schedules for a later day, as a whole or in parts (autopay_schedule); a warning email
// about a month before a card expires; the stored-credential usage type sent on save and on each charge.
//
// Runs only for a company with the care_autopay feature on (not ready until the owner has tested it with a real card).
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { documentLinkToken, documentLinkPath } from '@twomiah/tenant-backend'
import { autopayAttempt, autopaySchedule, clientAutopay, clients, company, invoices } from '../../../db/schema/index.ts'
import {
  attemptByIntent, attemptsForInvoice, attemptsNeedingAttention, attemptsNeedingReminder, autopayClients, billingContactOf, cardsExpiringSoon, claimAttempt,
  companiesWithAutopay, invoicesDueForCharge, reclaimStaleAttempt, releaseHardDeclines, scheduleRows, schedulesDue,
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
/** The waits (days) after try 1, 2 and 3 until the agency sets its own: four tries in all. */
export const DEFAULT_RETRY_DAYS = [2, 3, 4] as const
/** Stripe's Smart Retries ceiling: 8 tries in 2 weeks — at most 7 waits adding up to 14 days. */
export const MAX_RETRY_WAITS = 7
export const MAX_RETRY_SPAN_DAYS = 14
/** Days after the "bank needs the owner" notice on which the family is reminded, until the agency sets its own. */
export const DEFAULT_APPROVAL_REMINDER_DAYS = [3, 7] as const
export const MAX_APPROVAL_REMINDERS = 5
/** A bank debit (ACH / PAD) is tried again only for insufficient funds, and at most this many times more (Stripe's ACH rule). */
export const BANK_MAX_RETRIES = 2
/** A card is warned about this many days before the end of its expiry month. */
export const CARD_EXPIRY_WARNING_DAYS = 30
/** A try that started this long ago and never finished is asked again (with the same key). */
export const STALE_MINUTES = 15
/** The four tries of the original schedule, kept for callers that read it (the office screen's "fourth try" wording). */
export const MAX_ATTEMPTS = DEFAULT_RETRY_DAYS.length + 1

export type PayMethod = 'card' | 'us_bank_account' | 'acss_debit'
export const PAY_METHODS: PayMethod[] = ['card', 'us_bank_account', 'acss_debit']
export const METHOD_LABELS: Record<PayMethod, string> = { card: 'Card', us_bank_account: 'US bank account (ACH debit)', acss_debit: 'Canadian bank account (pre-authorized debit)' }
const isBank = (m: string | null | undefined) => m === 'us_bank_account' || m === 'acss_debit'
const currencyOf = (m: string | null | undefined) => (m === 'acss_debit' ? 'cad' : 'usd')

/** Codes after which this card or account can never be charged: the tries stop and autopay pauses until a new one is saved. */
export const HARD_DECLINES = new Set([
  'lost_card', 'stolen_card', 'pickup_card', 'expired_card', 'invalid_account', 'card_not_supported', 'fraudulent',
  'incorrect_number', 'invalid_number', 'invalid_expiry_month', 'invalid_expiry_year', 'restricted_card', 'no_account', 'closed_account',
  // a bank account (ACH / PAD) that cannot be debited
  'account_closed', 'bank_account_restricted', 'bank_account_unusable', 'debit_not_authorized', 'account_frozen', 'bank_account_declined',
  'incorrect_account_holder_name', 'bank_account_verification_failed', 'invalid_account_number',
])
const needsOwner = (code: string | null | undefined) => code === 'authentication_required' || code === 'authentication_not_handled'

/** What a family is told, in plain words, for a Stripe reason. */
export function reasonInWords(code: string | null | undefined, method: string | null | undefined = 'card'): string {
  const bank = isBank(method)
  switch (code) {
    case 'insufficient_funds': return bank ? 'the bank account did not have enough available' : 'the card did not have enough available'
    case 'expired_card': return 'the card has expired'
    case 'lost_card': case 'stolen_card': case 'pickup_card': case 'invalid_account': case 'closed_account': case 'no_account': return bank ? 'the bank account can no longer be used' : 'the card can no longer be used'
    case 'account_closed': case 'bank_account_restricted': case 'bank_account_unusable': case 'account_frozen': case 'bank_account_declined': return 'the bank account can no longer be used'
    case 'debit_not_authorized': return 'the bank says the debit was not authorized'
    case 'incorrect_account_holder_name': case 'bank_account_verification_failed': case 'invalid_account_number': return 'the bank account details on file are not valid'
    case 'incorrect_number': case 'invalid_number': case 'invalid_expiry_month': case 'invalid_expiry_year': return 'the card details on file are not valid'
    case 'incorrect_cvc': case 'invalid_cvc': return 'the card\'s security code was not accepted'
    case 'authentication_required': case 'authentication_not_handled': return bank ? 'the bank needs the account owner to approve this payment' : 'the card\'s bank needs the card owner to approve this payment'
    case 'card_velocity_exceeded': case 'withdrawal_count_limit_exceeded': return 'the card has reached a limit set by its bank'
    case 'amount_changed': return 'the amount owed changed while the payment was being made'
    default: return bank ? 'the bank did not accept the debit' : 'the card was declined by its bank'
  }
}

/** The wording the family agrees to, shown on Stripe's page beside the card form. */
export const consentWording = (agencyName: string) =>
  `I authorize ${agencyName} to charge this card for each invoice it sends me for care, when the invoice is issued, until I cancel by telling ${agencyName}. I can pay an invoice another way at any time.`
/** The ACH debit authorisation (US bank account), as the NACHA rules ask: who, what, how often, how to stop. */
export const achConsentWording = (agencyName: string) =>
  `I authorize ${agencyName} to electronically debit the bank account I enter here for each invoice it sends me for care, for the amount of that invoice, when the invoice is issued, and to credit the account to correct an error. This authorization stays in effect until I cancel it by telling ${agencyName}, which I may do at any time; a cancellation is honoured from the next invoice. I can pay an invoice another way at any time.`
/** The Canadian pre-authorized debit agreement (Payments Canada Rule H1): sporadic personal PADs, with the recourse statement. */
export const padConsentWording = (agencyName: string) =>
  `I authorize ${agencyName} to debit the bank account I enter here for each invoice it sends me for care, for the amount of that invoice, when the invoice is issued (sporadic personal pre-authorized debits). I waive the right to receive advance notice of each debit. I may cancel this agreement at any time by telling ${agencyName}; a cancellation takes effect from the next invoice. I have certain recourse rights if any debit does not comply with this agreement — for example, the right to reimbursement of a debit not authorized by it. Information on recourse rights and on cancelling is at payments.ca.`
export const wordingFor = (method: PayMethod, agencyName: string) => (method === 'us_bank_account' ? achConsentWording(agencyName) : method === 'acss_debit' ? padConsentWording(agencyName) : consentWording(agencyName))

/** Stripe's errors that mean it did NOT take the money; anything else (a dropped connection) leaves the answer unknown. */
const DEFINITE = new Set(['StripeCardError', 'StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError', 'card_error', 'invalid_request_error'])

const cents = (dollars: number) => Math.round(dollars * 100)
const owedOf = (inv: { total: unknown; amountPaid?: unknown; amountAdjusted?: unknown }) =>
  Math.max(0, Math.round((Number(inv.total) - Number(inv.amountPaid || 0) - Number(inv.amountAdjusted || 0)) * 100) / 100)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type ChargeResult = { status: 'charged' | 'failed' | 'needs_family' | 'pending' | 'skipped'; reason?: string; attemptNo?: number }

export interface AutopaySettings {
  /** Days to wait after each failed try (try n+1 comes retryDays[n-1] days after try n). */
  retryDays: number[]
  /** Days after a "bank needs the owner" notice on which the family is reminded. */
  approvalReminderDays: number[]
  /** Which ways of paying the agency offers (a bank method needs the owner's step on the Stripe account first). */
  methods: { card: boolean; usBank: boolean; cad: boolean }
}

/** Why these settings cannot be kept — or null. Pure. */
export function settingsProblem(input: any): string | null {
  const days = input?.retryDays
  if (days !== undefined) {
    if (!Array.isArray(days) || days.length > MAX_RETRY_WAITS) return `At most ${MAX_RETRY_WAITS} waits between tries (${MAX_RETRY_WAITS + 1} tries in all).`
    if (!days.every((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_RETRY_SPAN_DAYS)) return 'Each wait is a whole number of days from 1 to 14.'
    if ((days as number[]).reduce((a, b) => a + b, 0) > MAX_RETRY_SPAN_DAYS) return `The waits add up to more than ${MAX_RETRY_SPAN_DAYS} days — Stripe allows ${MAX_RETRY_WAITS + 1} tries in two weeks.`
  }
  const rem = input?.approvalReminderDays
  if (rem !== undefined) {
    if (!Array.isArray(rem) || rem.length > MAX_APPROVAL_REMINDERS) return `At most ${MAX_APPROVAL_REMINDERS} reminders.`
    if (!rem.every((n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 60)) return 'Each reminder is a whole number of days from 1 to 60 after the notice.'
    for (let i = 1; i < rem.length; i++) if (rem[i] <= rem[i - 1]) return 'Reminder days go up: each later than the one before.'
  }
  const m = input?.methods
  if (m !== undefined && (typeof m !== 'object' || m === null || ['card', 'usBank', 'cad'].some((k) => m[k] !== undefined && typeof m[k] !== 'boolean'))) return 'Each way of paying is on or off.'
  return null
}

/** The owner's outside steps for a bank method: nothing in the product can do these. */
export const BANK_OWNER_STEPS = {
  usBank: 'On the agency\'s own Stripe account (Settings › Payment methods), turn on ACH Direct Debit and, if asked, Financial Connections for instant bank verification. Until then a family that picks the bank option is refused with a plain sentence.',
  cad: 'On the agency\'s own Stripe account (Settings › Payment methods), turn on Pre-authorized debit (PAD, Canada); the account must be able to take CAD. Until then a family that picks it is refused with a plain sentence.',
}

export function createAutopay(d: CrmDeps, deps: { invoices: Pick<InvoiceEngine, 'recordInvoicePayment'>; time: AgencyTime; notify: VisitNotify; email: HomecareEmail }) {
  const canTakeCards = cardPaymentsFor(d)
  const stripe = () => stripeClientFor(d)
  const accountFor = (companyId: string) => d.services.stripeService.connectedAccountFor(companyId)
  const isOn = (companyId: string) => d.features.isFeatureEnabled(companyId, AUTOPAY_FEATURE)

  async function companyRow(companyId: string) {
    const [row] = await d.db.select({ name: company.name, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return row ?? null
  }
  async function agencyName(companyId: string): Promise<string> {
    return (await companyRow(companyId))?.name || 'Our agency'
  }

  // ── The agency's settings ────────────────────────────────────────────────────────────────────────

  async function settings(companyId: string): Promise<AutopaySettings> {
    const raw = ((await companyRow(companyId))?.settings as any)?.autopay ?? {}
    const retryDays = Array.isArray(raw.retryDays) && settingsProblem({ retryDays: raw.retryDays }) === null ? raw.retryDays.map(Number) : [...DEFAULT_RETRY_DAYS]
    const approvalReminderDays = Array.isArray(raw.approvalReminderDays) && settingsProblem({ approvalReminderDays: raw.approvalReminderDays }) === null ? raw.approvalReminderDays.map(Number) : [...DEFAULT_APPROVAL_REMINDER_DAYS]
    return { retryDays, approvalReminderDays, methods: { card: raw.methods?.card !== false, usBank: raw.methods?.usBank === true, cad: raw.methods?.cad === true } }
  }

  async function saveSettings(companyId: string, input: any): Promise<AutopaySettings | { problem: string }> {
    const problem = settingsProblem(input)
    if (problem) return { problem }
    const cur = await settings(companyId)
    const next: AutopaySettings = {
      retryDays: input?.retryDays !== undefined ? input.retryDays : cur.retryDays,
      approvalReminderDays: input?.approvalReminderDays !== undefined ? input.approvalReminderDays : cur.approvalReminderDays,
      methods: { ...cur.methods, ...(input?.methods ?? {}) },
    }
    const row = await companyRow(companyId)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), autopay: next } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return next
  }

  const rowFor = async (companyId: string, clientId: string) =>
    (await d.db.select().from(clientAutopay).where(and(eq(clientAutopay.companyId, companyId), eq(clientAutopay.clientId, clientId))).limit(1))[0] ?? null

  /** "Visa ending 4242" / "Chase bank account ending 6789": what every notice calls the thing on file. */
  const onFileLabel = (row: { method?: string | null; brand?: string | null; bankName?: string | null; last4?: string | null } | null) => {
    if (!row) return 'the card on file'
    if (isBank(row.method)) return `${row.bankName ? `${row.bankName} ` : ''}bank account ending ${row.last4 ?? ''}`.trim()
    const brand = row.brand ? row.brand.charAt(0).toUpperCase() + row.brand.slice(1) : 'Card'
    return `${brand} ending ${row.last4 ?? ''}`.trim()
  }

  /** What the office (or the portal) sees for one client: nothing, a link out, or what is on file (brand / bank and last four only). */
  async function statusOf(companyId: string, clientId: string) {
    const row = await rowFor(companyId, clientId)
    if (!row || row.status === 'removed') return { status: 'none' as const }
    return {
      status: row.status as 'pending' | 'active' | 'paused', pausedReason: row.pausedReason ? reasonInWords(row.pausedReason, row.method) : null,
      method: (row.method || 'card') as PayMethod, methodLabel: METHOD_LABELS[(row.method || 'card') as PayMethod], label: onFileLabel(row),
      brand: row.brand, bankName: row.bankName, last4: row.last4, expMonth: row.expMonth, expYear: row.expYear, consentAt: row.consentAt, savedBy: row.savedBy,
    }
  }

  // ── Saving a card or a bank account ──────────────────────────────────────────────────────────────

  /**
   * Stripe's own page for saving a card or a bank account, on the agency's account. Returns the page's address, or why it
   * cannot be made. Saving a second one replaces the first only once the new one is saved. `by` says who asked for the page
   * ('office', or a relative / the client from the portal — row 22).
   */
  async function startSetup(companyId: string, clientId: string, urls: { success: string; cancel: string }, userId?: string | null, opts: { method?: string; by?: 'office' | 'family' | 'client' } = {}):
    Promise<{ url: string } | { problem: string; code: string; status: number }> {
    const method = (opts.method || 'card') as PayMethod
    if (!PAY_METHODS.includes(method)) return { problem: 'Choose a card, a US bank account or a Canadian bank account.', code: 'bad_method', status: 400 }
    const cfg = await settings(companyId)
    if ((method === 'card' && !cfg.methods.card) || (method === 'us_bank_account' && !cfg.methods.usBank) || (method === 'acss_debit' && !cfg.methods.cad)) {
      return { problem: `${METHOD_LABELS[method]} is not offered by this agency yet.`, code: 'method_off', status: 400 }
    }
    const s = await stripe()
    if (!s) return { problem: 'Card payments are not available on your account yet — contact Twomiah to switch them on.', code: 'payments_unavailable', status: 503 }
    if (!(await canTakeCards(companyId).catch(() => false))) {
      return { problem: 'Card payments are not connected — connect Stripe in Settings › Integrations and switch on Online Payments.', code: 'payments_unavailable', status: 400 }
    }
    const account = await accountFor(companyId)
    if (!account) return { problem: 'Card payments are not connected — connect Stripe in Settings › Integrations.', code: 'payments_unavailable', status: 400 }
    const [client] = await d.db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    if (!client) return { problem: 'Client not found', code: 'not_found', status: 404 }

    const stripeOpts = { stripeAccount: account }
    let row = await rowFor(companyId, clientId)
    // A customer made on another account is no use on this one.
    let customerId = row?.stripeCustomerId && row.stripeAccount === account ? row.stripeCustomerId : null
    if (!customerId) {
      const customer = await s.customers.create({
        name: `${client.firstName} ${client.lastName}`.trim(), email: client.email || undefined,
        metadata: { client_id: clientId, company_id: companyId },
      }, stripeOpts)
      customerId = String(customer.id)
    }
    const wording = wordingFor(method, await agencyName(companyId))
    const by = opts.by || 'office'
    // The stored-credential usage type at save: these are unscheduled merchant-initiated charges (each invoice, when issued) —
    // Checkout's setup mode makes the SetupIntent for off-session use; the type rides on it so Stripe's record says why.
    const usage = 'unscheduled'
    const session = await s.checkout.sessions.create({
      mode: 'setup', customer: customerId, payment_method_types: [method], currency: currencyOf(method),
      success_url: urls.success, cancel_url: urls.cancel,
      custom_text: { submit: { message: wording } },
      ...(method === 'us_bank_account' ? { payment_method_options: { us_bank_account: { verification_method: 'automatic' } } } : {}),
      ...(method === 'acss_debit' ? { payment_method_options: { acss_debit: { currency: 'cad', mandate_options: { payment_schedule: 'sporadic', transaction_type: 'personal' } } } } : {}),
      metadata: { autopay_client_id: clientId, autopay_company_id: companyId, autopay_method: method, autopay_by: by },
      setup_intent_data: { metadata: { autopay_client_id: clientId, autopay_company_id: companyId, autopay_method: method, usage_type: usage } },
    }, stripeOpts)

    if (row) {
      await d.db.update(clientAutopay).set({
        stripeAccount: account, stripeCustomerId: customerId, setupSessionId: String(session.id), consentText: wording,
        status: row.status === 'removed' ? 'pending' : row.status, updatedAt: new Date(),
      }).where(eq(clientAutopay.id, row.id))
    } else {
      await d.db.insert(clientAutopay).values({
        companyId, clientId, status: 'pending', stripeAccount: account, stripeCustomerId: customerId,
        setupSessionId: String(session.id), consentText: wording, createdBy: userId || null, method,
      }).onConflictDoNothing()
    }
    return { url: String(session.url) }
  }

  /** The card or bank was saved on Stripe's page: keep its id, brand / bank and last four, and the moment the family agreed. */
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
      const method: PayMethod = pm.type === 'us_bank_account' || pm.type === 'acss_debit' ? pm.type : 'card'
      const bank = method === 'us_bank_account' ? pm.us_bank_account : method === 'acss_debit' ? pm.acss_debit : null
      const mandate = typeof intent.mandate === 'string' ? intent.mandate : intent.mandate?.id ?? null
      await d.db.update(clientAutopay).set({
        status: 'active', pausedReason: null, paymentMethodId: pmId, method,
        brand: method === 'card' ? pm.card?.brand ?? null : null, last4: method === 'card' ? pm.card?.last4 ?? null : bank?.last4 ?? null,
        bankName: bank?.bank_name ?? null, mandateId: mandate,
        expMonth: method === 'card' ? pm.card?.exp_month ?? null : null, expYear: method === 'card' ? pm.card?.exp_year ?? null : null,
        savedBy: String(session.metadata?.autopay_by || 'office'), expiryWarnedFor: null,
        consentAt: new Date(), updatedAt: new Date(),
      }).where(eq(clientAutopay.id, row.id))
      if (previous) await s.paymentMethods.detach(previous, opts).catch(() => {})
      // Invoices that stopped because the old card was finished are tried again with this one, and any waiting are tried now.
      await releaseHardDeclines(d.db, companyId, clientId, (await settings(companyId)).retryDays.length + 1)
      await sweepCompany(companyId).catch(() => 0)
    } catch (e: any) {
      d.logger.error('[autopay] could not read the saved card', { error: e?.message })
    }
    return true
  }

  /** Stop charging this client's card or account. Their open invoices are left to be paid another way. */
  async function remove(companyId: string, clientId: string): Promise<boolean> {
    const row = await rowFor(companyId, clientId)
    if (!row || row.status === 'removed') return false
    await d.db.update(clientAutopay).set({ status: 'removed', paymentMethodId: null, updatedAt: new Date() }).where(eq(clientAutopay.id, row.id))
    const s = await stripe()
    if (s && row.paymentMethodId && row.stripeAccount) await s.paymentMethods.detach(row.paymentMethodId, { stripeAccount: row.stripeAccount }).catch(() => {})
    return true
  }

  // ── Scheduled charges and instalments (row 22) ───────────────────────────────────────────────────

  /**
   * Set the charge(s) for an invoice: one part on a chosen day (the balance, or an amount), or several parts (an instalment
   * plan). Replaces any plan waiting on the invoice. Refused for a paid invoice, a day before today, a part above what is owed,
   * or parts adding up to more than what is owed. Returns the rows, or the reason.
   */
  async function schedule(companyId: string, invoiceId: string, parts: Array<{ chargeOn?: unknown; amountCents?: unknown; label?: unknown }>, userId?: string | null): Promise<any[] | { problem: string; status: number; code: string }> {
    const [inv] = await d.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1)
    if (!inv) return { problem: 'Invoice not found', status: 404, code: 'not_found' }
    if (inv.paymentStatus === 'paid' || owedOf(inv) <= 0) return { problem: 'This invoice is already paid — there is nothing to schedule.', status: 400, code: 'paid' }
    if (inv.billTo !== 'family') return { problem: 'This invoice is billed to a payer, not the family; a saved card or bank account pays only the family\'s invoices.', status: 400, code: 'not_family' }
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > 24) return { problem: 'Give one charge, or up to 24 parts.', status: 400, code: 'bad_parts' }
    const today = await deps.time.today(companyId)
    const owedCents = cents(owedOf(inv))
    let sum = 0
    const rows: Array<{ chargeOn: string; amountCents: number | null; label: string | null }> = []
    for (const [i, p] of parts.entries()) {
      const day = String(p?.chargeOn ?? '')
      if (!DATE_RE.test(day)) return { problem: 'Each part needs a date (YYYY-MM-DD).', status: 400, code: 'bad_date' }
      if (day < today) return { problem: `${day} has passed — a charge is scheduled for today or a later day.`, status: 400, code: 'past_date' }
      let amount: number | null = null
      if (p?.amountCents !== undefined && p?.amountCents !== null && p?.amountCents !== '') {
        amount = Number(p.amountCents)
        if (!Number.isInteger(amount) || amount <= 0) return { problem: 'An amount is a whole number of cents above zero.', status: 400, code: 'bad_amount' }
        sum += amount
      } else if (parts.length > 1) return { problem: 'Each part of a plan needs an amount; only a single charge may be "the balance".', status: 400, code: 'bad_amount' }
      if (sum > owedCents) return { problem: `The parts add up to more than the $${(owedCents / 100).toFixed(2)} owed on this invoice.`, status: 400, code: 'over_owed' }
      if (i > 0 && day < rows[i - 1]!.chargeOn) return { problem: 'Put the parts in date order.', status: 400, code: 'bad_order' }
      rows.push({ chargeOn: day, amountCents: amount, label: typeof p?.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 80) : parts.length > 1 ? `Part ${i + 1} of ${parts.length}` : null })
    }
    await d.db.update(autopaySchedule).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(autopaySchedule.companyId, companyId), eq(autopaySchedule.invoiceId, invoiceId), eq(autopaySchedule.status, 'waiting')))
    const made = await d.db.insert(autopaySchedule).values(rows.map((r) => ({ companyId, invoiceId, clientId: inv.clientId, chargeOn: r.chargeOn, amountCents: r.amountCents, label: r.label, createdBy: userId || null }))).returning()
    return made
  }

  /** Take back every waiting part of an invoice's plan. The invoice goes back to being charged as a whole when next due. */
  async function cancelSchedule(companyId: string, invoiceId: string): Promise<number> {
    const rows = await d.db.update(autopaySchedule).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(autopaySchedule.companyId, companyId), eq(autopaySchedule.invoiceId, invoiceId), eq(autopaySchedule.status, 'waiting'))).returning({ id: autopaySchedule.id })
    return rows.length
  }

  // ── Charging an invoice ──────────────────────────────────────────────────────────────────────────

  async function recordSuccess(companyId: string, invoiceId: string, attemptId: string, intentId: string, amountCents: number, scheduleId: string | null) {
    const paymentDate = await deps.time.today(companyId)
    await deps.invoices.recordInvoicePayment({
      companyId, invoiceId, amount: amountCents / 100, paymentDate, method: 'stripe', reference: intentId, notes: scheduleId ? 'Autopay (scheduled)' : 'Autopay', allowOverpayment: true,
    })
    await d.db.update(invoices).set({ stripePaymentIntentId: intentId, updatedAt: new Date() }).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    await d.db.update(autopayAttempt).set({ status: 'succeeded', paymentIntentId: intentId, failureCode: null, failureMessage: null, nextAttemptAt: null, updatedAt: new Date() })
      .where(eq(autopayAttempt.id, attemptId))
    if (scheduleId) await d.db.update(autopaySchedule).set({ status: 'charged', updatedAt: new Date() }).where(eq(autopaySchedule.id, scheduleId))
    await sendReceipt(companyId, invoiceId, attemptId, amountCents, paymentDate).catch((e: any) => d.logger.error('[autopay] receipt', { error: e?.message }))
  }

  /** The receipt after a successful charge: once per try (receipt_sent_at), to the billing contact, else the family's email. */
  async function sendReceipt(companyId: string, invoiceId: string, attemptId: string, amountCents: number, paidOn: string) {
    const claimed = await d.db.update(autopayAttempt).set({ receiptSentAt: new Date() })
      .where(and(eq(autopayAttempt.id, attemptId), eq(autopayAttempt.status, 'succeeded'))).returning({ id: autopayAttempt.id, receiptSentAt: autopayAttempt.receiptSentAt })
    if (!claimed.length) return
    const inv = await invoiceForEmail(d.db, companyId, invoiceId)
    if (!inv) return
    const billing = await billingContactOf(d.db, companyId, inv.clientId)
    const to = billing?.email || inv.clientEmail
    if (!to || !deps.email.isConfigured) return
    const onFile = await rowFor(companyId, inv.clientId)
    const token = await documentLinkToken(d.db, invoices, invoiceId)
    const after = (await d.db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1))[0]
    await deps.email.sendAutopayReceipt(to, {
      companyName: await agencyName(companyId), contactName: (billing?.email ? billing.name : null) || `${inv.firstName} ${inv.lastName}`.trim(),
      invoiceNumber: String(inv.seqNumber ?? inv.invoiceNumber), amount: (amountCents / 100).toFixed(2), paidOn, paidWith: onFileLabel(onFile),
      stillOwed: after ? owedOf(after).toFixed(2) : '0.00', documentPath: token ? documentLinkPath(token) : null,
    })
  }

  /** Close a try that did not take the money: when the next one is, whether this card is finished, and who is told. */
  async function recordFailure(attempt: { id: string; companyId: string; invoiceId: string; clientId: string; attemptNo: number; amountCents: number; scheduleId?: string | null },
    f: { code: string | null; message: string | null; intentId?: string | null }, at: Date): Promise<ChargeResult> {
    const cfg = await settings(attempt.companyId)
    const onFile = await rowFor(attempt.companyId, attempt.clientId)
    const bank = isBank(onFile?.method)
    const ownerNeeded = needsOwner(f.code)
    const hard = !!f.code && HARD_DECLINES.has(f.code)
    const maxAttempts = bank ? Math.min(cfg.retryDays.length, BANK_MAX_RETRIES) + 1 : cfg.retryDays.length + 1
    const last = attempt.attemptNo >= maxAttempts
    // A bank debit is retried only when the account lacked the money (Stripe's ACH rule); a card for any soft decline.
    const retry = !hard && !ownerNeeded && !last && (!bank || f.code === 'insufficient_funds')
    const nextAt = retry ? new Date(at.getTime() + (cfg.retryDays[attempt.attemptNo - 1] ?? cfg.retryDays[cfg.retryDays.length - 1] ?? 2) * 86_400_000) : null
    await d.db.update(autopayAttempt).set({
      status: ownerNeeded ? 'needs_action' : 'failed', paymentIntentId: f.intentId ?? null, failureCode: f.code, failureMessage: f.message,
      hardDecline: hard, nextAttemptAt: nextAt, updatedAt: new Date(),
    }).where(eq(autopayAttempt.id, attempt.id))
    if (hard) {
      await d.db.update(clientAutopay).set({ status: 'paused', pausedReason: f.code, updatedAt: new Date() })
        .where(and(eq(clientAutopay.companyId, attempt.companyId), eq(clientAutopay.clientId, attempt.clientId), eq(clientAutopay.status, 'active')))
    }
    if (attempt.scheduleId && !retry && !ownerNeeded) await d.db.update(autopaySchedule).set({ status: 'failed', updatedAt: new Date() }).where(eq(autopaySchedule.id, attempt.scheduleId))
    await notifyFailure(attempt, f.code, nextAt, onFile?.method).catch((e: any) => d.logger.error('[autopay] failure notice', { error: e?.message }))
    return { status: ownerNeeded ? 'needs_family' : 'failed', reason: reasonInWords(f.code, onFile?.method), attemptNo: attempt.attemptNo }
  }

  /** The family's email and the office's notice for a failed try. Once per try; again as a reminder (row 22). */
  async function notifyFailure(attempt: { id: string; companyId: string; invoiceId: string; attemptNo: number; amountCents: number }, code: string | null, nextAt: Date | null, method: string | null | undefined, reminder = false) {
    const inv = await invoiceForEmail(d.db, attempt.companyId, attempt.invoiceId)
    if (!inv) return
    const tz = await deps.time.timezone(attempt.companyId)
    const reason = reasonInWords(code, method)
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
        invoiceNumber: number, amountDue, reason, retryOn, documentPath: token ? documentLinkPath(token) : null, bank: isBank(method), reminder,
      }).catch((e: any) => d.logger.error('[autopay] email not sent', { error: e?.message }))
    }
    if (!reminder) {
      await deps.notify.notifyAdmins(attempt.companyId, 'autopay_failed',
        nextAt ? 'Automatic payment did not go through' : 'Automatic payment failed — needs a call',
        `${inv.firstName} ${inv.lastName}, invoice #${number} ($${amountDue}): ${reason}. ${nextAt ? `Trying again on ${retryOn}.` : 'No more automatic tries — ask the family to pay another way.'}`)
      await d.db.update(autopayAttempt).set({ notifiedAt: new Date() }).where(eq(autopayAttempt.id, attempt.id))
    }
  }

  /**
   * Charge one invoice's balance — or one scheduled part of it (`scheduleId`) — to its client's saved card or bank account, if
   * it is due. `force` (the office's "Try now") skips the wait between tries but never a card that is finished, a family that
   * must approve, a paid invoice or the last try.
   */
  async function chargeInvoice(companyId: string, invoiceId: string, opts: { force?: boolean; at?: Date; scheduleId?: string | null } = {}): Promise<ChargeResult> {
    const at = opts.at ?? new Date()
    const skip = (reason: string): ChargeResult => ({ status: 'skipped', reason })
    if (!(await isOn(companyId))) return skip('autopay_off')
    const [inv] = await d.db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId))).limit(1)
    if (!inv) return skip('no_invoice')
    if (!inv.sentAt) return skip('draft')
    if (inv.paymentStatus === 'paid') return skip('paid')
    if (inv.billTo !== 'family') return skip('billed_to_payer')
    const owed = owedOf(inv)
    if (owed <= 0) return skip('nothing_owed')
    // A scheduled part: its row says how much and when; an invoice with a plan is never charged as a whole.
    let part: typeof autopaySchedule.$inferSelect | null = null
    if (opts.scheduleId) {
      part = (await d.db.select().from(autopaySchedule).where(and(eq(autopaySchedule.id, opts.scheduleId), eq(autopaySchedule.companyId, companyId), eq(autopaySchedule.invoiceId, invoiceId))).limit(1))[0] ?? null
      if (!part || part.status !== 'waiting') return skip('no_schedule')
      if (!opts.force && part.chargeOn > (await deps.time.today(companyId))) return skip('not_yet')
    } else {
      const waiting = await d.db.select({ id: autopaySchedule.id }).from(autopaySchedule)
        .where(and(eq(autopaySchedule.invoiceId, invoiceId), eq(autopaySchedule.companyId, companyId), inArray(autopaySchedule.status, ['waiting', 'charged', 'failed']))).limit(1)
      if (waiting.length) return skip('scheduled')
    }
    const card = await rowFor(companyId, inv.clientId)
    if (!card || card.status !== 'active' || !card.paymentMethodId || !card.stripeCustomerId) return skip('no_card')
    const s = await stripe()
    if (!s) return skip('stripe_unavailable')
    // The agency's own account, always: refused when it is not connected, or the card was saved on another account.
    if (!(await canTakeCards(companyId).catch(() => false))) return skip('cards_not_connected')
    const account = await accountFor(companyId)
    if (!account || card.stripeAccount !== account) return skip('account_changed')
    const cfg = await settings(companyId)
    const bank = isBank(card.method)
    const maxAttempts = bank ? Math.min(cfg.retryDays.length, BANK_MAX_RETRIES) + 1 : cfg.retryDays.length + 1

    // Which try is this? Read the history first: what stops another try is written down there. A part's tries are its own.
    const scheduleId = part?.id ?? null
    const history = (await attemptsForInvoice(d.db, companyId, invoiceId)).filter((a: any) => (a.scheduleId ?? null) === scheduleId)
    const all = await attemptsForInvoice(d.db, companyId, invoiceId)
    const latest = history[history.length - 1]
    let attemptNo = (all.length ? Math.max(...all.map((a: any) => Number(a.attemptNo))) : 0) + 1
    let claimed: string | null = null
    let amountCents = part?.amountCents != null ? Math.min(Number(part.amountCents), cents(owed)) : cents(owed)
    if (latest) {
      if (latest.status === 'succeeded') return skip('already_charged')
      if (latest.status === 'needs_action') return skip('needs_family')
      if (latest.status === 'failed') {
        if (latest.hardDecline) return skip('card_finished')
        if (history.length >= maxAttempts) return skip('no_more_tries')
        if (!latest.nextAttemptAt) return skip('no_more_tries')
        if (!opts.force && new Date(latest.nextAttemptAt).getTime() > at.getTime()) return skip('waiting')
      }
      if (latest.status === 'pending') {
        // Still being asked of Stripe — or never finished. Only a stale one is taken over, and only at the amount it was made for.
        claimed = await reclaimStaleAttempt(d.db, companyId, invoiceId, Number(latest.attemptNo), STALE_MINUTES)
        if (!claimed) return skip('in_progress')
        attemptNo = Number(latest.attemptNo)
        amountCents = Number(latest.amountCents)
        if (amountCents !== (part?.amountCents != null ? Math.min(Number(part.amountCents), cents(owed)) : cents(owed))) {
          const row = { id: claimed, companyId, invoiceId, clientId: inv.clientId, attemptNo, amountCents, scheduleId }
          return recordFailure(row, { code: 'authentication_required', message: 'The amount owed changed while a try was unfinished.' }, at)
            .then((r) => ({ ...r, reason: reasonInWords('amount_changed') }))
        }
      }
    }
    if (!claimed) {
      claimed = await claimAttempt(d.db, companyId, invoiceId, inv.clientId, attemptNo, amountCents, scheduleId)
      if (!claimed) return skip('in_progress')
    }
    const attempt = { id: claimed, companyId, invoiceId, clientId: inv.clientId, attemptNo, amountCents, scheduleId }

    try {
      const method = (card.method || 'card') as PayMethod
      const intent = await s.paymentIntents.create({
        amount: amountCents, currency: currencyOf(method), customer: card.stripeCustomerId, payment_method: card.paymentMethodId,
        payment_method_types: [method],
        // The stored-credential usage type on the charge: a part of an instalment plan is one of a series ('recurring'); an
        // invoice charged as it is issued is an unscheduled merchant-initiated charge ('one_off'). Both are off-session.
        off_session: part && part.amountCents != null ? 'recurring' : 'one_off', confirm: true,
        ...(method === 'acss_debit' ? { payment_method_options: { acss_debit: { mandate_options: { payment_schedule: 'sporadic', transaction_type: 'personal' } } } } : {}),
        description: `Invoice #${inv.seqNumber ?? inv.invoiceNumber} (autopay${part?.label ? `, ${part.label}` : ''})`,
        metadata: { kind: 'homecare_autopay', invoice_id: invoiceId, company_id: companyId, client_id: inv.clientId, attempt: String(attemptNo), ...(scheduleId ? { schedule_id: scheduleId } : {}) },
      }, { stripeAccount: account, idempotencyKey: `autopay-${invoiceId}-${attemptNo}` })
      await d.db.update(autopayAttempt).set({ paymentIntentId: String(intent.id), updatedAt: new Date() }).where(eq(autopayAttempt.id, claimed))
      if (intent.status === 'succeeded') {
        await recordSuccess(companyId, invoiceId, claimed, String(intent.id), amountCents, scheduleId)
        return { status: 'charged', attemptNo }
      }
      if (intent.status === 'processing') return { status: 'pending', reason: 'processing', attemptNo } // the webhook finishes it (every bank debit)
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

  /** The office's "Try now": the invoice as a whole, or its first waiting part when it has a plan. */
  async function tryNow(companyId: string, invoiceId: string): Promise<ChargeResult> {
    const [part] = await d.db.select({ id: autopaySchedule.id }).from(autopaySchedule)
      .where(and(eq(autopaySchedule.companyId, companyId), eq(autopaySchedule.invoiceId, invoiceId), eq(autopaySchedule.status, 'waiting')))
      .orderBy(autopaySchedule.chargeOn, autopaySchedule.createdAt).limit(1)
    return chargeInvoice(companyId, invoiceId, { force: true, scheduleId: part?.id ?? null })
  }

  /** An invoice was just issued (released or emailed): charge it if its client has a card. Never throws, never delays the release. */
  async function onIssued(companyId: string, invoiceId: string): Promise<ChargeResult | null> {
    try { return await chargeInvoice(companyId, invoiceId) } catch (e: any) {
      d.logger.error('[autopay] could not charge on issue', { invoiceId, error: e?.message }); return null
    }
  }

  // ── Stripe's events ──────────────────────────────────────────────────────────────────────────────

  /** A payment intent of ours finished after our call returned (a slow bank, every bank debit): settle its try. */
  async function onIntentEvent(event: any): Promise<boolean> {
    const pi = event?.data?.object
    if (!pi || pi.metadata?.kind !== 'homecare_autopay') return false
    const attempt = await attemptByIntent(d.db, String(pi.id))
    // Only a try we made counts: the intent is on the row we claimed, or the row the metadata names, at the amount we asked.
    const row = attempt ?? (await d.db.select().from(autopayAttempt)
      .where(and(eq(autopayAttempt.invoiceId, String(pi.metadata.invoice_id)), eq(autopayAttempt.attemptNo, Number(pi.metadata.attempt)))).limit(1))
      .map((r: any) => ({ id: r.id, companyId: r.companyId, invoiceId: r.invoiceId, clientId: r.clientId, status: r.status, amountCents: r.amountCents, attemptNo: r.attemptNo, scheduleId: r.scheduleId }))[0]
    if (!row) return true
    const full = (await d.db.select().from(autopayAttempt).where(eq(autopayAttempt.id, row.id)).limit(1))[0]
    if (!full || full.companyId !== pi.metadata.company_id || full.amountCents !== Number(pi.amount)) return true
    if (event.type === 'payment_intent.succeeded' && full.status !== 'succeeded') {
      await recordSuccess(full.companyId, full.invoiceId, full.id, String(pi.id), full.amountCents, full.scheduleId ?? null)
    } else if (event.type === 'payment_intent.payment_failed' && full.status === 'pending') {
      const code = pi.last_payment_error?.decline_code || pi.last_payment_error?.code || null
      await recordFailure({ ...full, scheduleId: full.scheduleId ?? null }, { code, message: pi.last_payment_error?.message ?? null, intentId: String(pi.id) }, new Date())
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
    const cfg = await settings(companyId)
    const maxAttempts = cfg.retryDays.length + 1
    let charged = 0
    for (const due of await invoicesDueForCharge(d.db, companyId, maxAttempts, STALE_MINUTES)) {
      try { if ((await chargeInvoice(due.companyId, due.id, { at })).status === 'charged') charged++ } catch (e: any) { d.logger.error('[autopay] one invoice', { error: e?.message }) }
    }
    const today = ymdIn(at, await deps.time.timezone(companyId))
    for (const due of await schedulesDue(d.db, companyId, today, maxAttempts, STALE_MINUTES)) {
      try { if ((await chargeInvoice(companyId, due.invoiceId, { at, scheduleId: due.id })).status === 'charged') charged++ } catch (e: any) { d.logger.error('[autopay] one scheduled charge', { error: e?.message }) }
    }
    return charged
  }

  /** Row 22: a warning to the family about a month before the card on file expires, once per expiry month; the office is told too. */
  async function scanExpiringCards(): Promise<number> {
    let n = 0
    for (const card of await cardsExpiringSoon(d.db, CARD_EXPIRY_WARNING_DAYS)) {
      try {
        if (!(await isOn(card.companyId))) continue
        const monthKey = `${card.expYear}-${String(card.expMonth).padStart(2, '0')}`
        // Claimed by the update itself: two scans cannot both warn for the same month.
        const claimed = await d.db.update(clientAutopay).set({ expiryWarnedFor: monthKey, updatedAt: new Date() })
          .where(and(eq(clientAutopay.id, card.id), eq(clientAutopay.status, 'active'), or(isNull(clientAutopay.expiryWarnedFor), ne(clientAutopay.expiryWarnedFor, monthKey)))).returning({ id: clientAutopay.id })
        if (!claimed.length) continue
        const billing = await billingContactOf(d.db, card.companyId, card.clientId)
        const [client] = await d.db.select({ email: clients.email, portalEmail: clients.portalEmail }).from(clients).where(eq(clients.id, card.clientId)).limit(1)
        const to = billing?.email || client?.portalEmail || client?.email
        const expires = `${String(card.expMonth).padStart(2, '0')}/${card.expYear}`
        if (to && deps.email.isConfigured) {
          await deps.email.sendCardExpiring(to, {
            companyName: await agencyName(card.companyId), contactName: (billing?.email ? billing.name : null) || `${card.firstName} ${card.lastName}`.trim(),
            cardLabel: onFileLabel(card), expires, portalUrl: `${process.env.FRONTEND_URL || ''}/family`,
          }).catch((e: any) => d.logger.error('[autopay] expiry email not sent', { error: e?.message }))
        }
        await deps.notify.notifyAdmins(card.companyId, 'autopay_card_expiring', 'A card on file expires soon',
          `${card.firstName} ${card.lastName}: ${onFileLabel(card)} expires ${expires}. Ask the family to save a new card before then.`)
        n++
      } catch (e: any) { d.logger.error('[autopay] expiry warning', { error: e?.message }) }
    }
    return n
  }

  /** Row 22: reminders to the family after the "bank needs the owner" notice, on the agency's days, while the invoice is still owed. */
  async function scanApprovalReminders(at: Date = new Date()): Promise<number> {
    let n = 0
    const byCompany = new Map<string, AutopaySettings>()
    for (const t of await attemptsNeedingReminder(d.db)) {
      try {
        if (!(await isOn(t.companyId))) continue
        const cfg = byCompany.get(t.companyId) ?? (await settings(t.companyId))
        byCompany.set(t.companyId, cfg)
        const sent = Number(t.remindersSent)
        const dueDay = cfg.approvalReminderDays[sent]
        if (dueDay === undefined || Number(t.daysSince) < dueDay) continue
        const claimed = await d.db.update(autopayAttempt).set({ remindersSent: sent + 1, lastReminderAt: at, updatedAt: new Date() })
          .where(and(eq(autopayAttempt.id, t.id), eq(autopayAttempt.remindersSent, sent), eq(autopayAttempt.status, 'needs_action'))).returning({ id: autopayAttempt.id })
        if (!claimed.length) continue
        const onFile = await rowFor(t.companyId, t.clientId)
        await notifyFailure({ id: t.id, companyId: t.companyId, invoiceId: t.invoiceId, attemptNo: Number(t.attemptNo), amountCents: Number(t.amountCents) }, t.failureCode, null, onFile?.method, true)
        n++
      } catch (e: any) { d.logger.error('[autopay] approval reminder', { error: e?.message }) }
    }
    return n
  }

  /** Every company's due invoices and scheduled charges — the safety net behind the charge on issue, and the retries. Returns how many were charged. */
  async function sweep(at: Date = new Date()): Promise<number> {
    let n = 0
    for (const companyId of await companiesWithAutopay(d.db)) {
      try { n += await sweepCompany(companyId, at) } catch (e: any) { d.logger.error('[autopay] one company', { companyId, error: e?.message }) }
    }
    await scanExpiringCards().catch((e: any) => d.logger.error('[autopay] expiring cards', { error: e?.message }))
    await scanApprovalReminders(at).catch((e: any) => d.logger.error('[autopay] approval reminders', { error: e?.message }))
    return n
  }

  return {
    statusOf, startSetup, remove, chargeInvoice, tryNow, onIssued, onEvent, sweep, sweepCompany, scanExpiringCards, scanApprovalReminders,
    settings, saveSettings, schedule, cancelSchedule, onFileLabel,
    schedules: (companyId: string, invoiceId: string | null = null) => scheduleRows(d.db, companyId, invoiceId),
    attemptsForInvoice: (companyId: string, invoiceId: string) => attemptsForInvoice(d.db, companyId, invoiceId),
    clients: (companyId: string) => autopayClients(d.db, companyId),
    needingAttention: (companyId: string) => attemptsNeedingAttention(d.db, companyId),
    /** The portal's view: what is on file and which ways of paying the agency offers (row 22). */
    async portalStatus(companyId: string, clientId: string) {
      const cfg = await settings(companyId)
      return { ...(await statusOf(companyId, clientId)), methods: cfg.methods, wording: { card: consentWording(await agencyName(companyId)), usBank: achConsentWording(await agencyName(companyId)), cad: padConsentWording(await agencyName(companyId)) } }
    },
  }
}

export type Autopay = ReturnType<typeof createAutopay>
