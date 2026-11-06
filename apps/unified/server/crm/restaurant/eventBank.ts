// Paying an event's instalments from a US bank account (ACH direct debit) — restaurant-bar parity #3 (docs/parity/restaurant-2-payments.md).
//
// A bank debit is not a card charge. Stripe ACCEPTS it when the client confirms it and the payment is PROCESSING for up to four
// business days; it then succeeds or comes back failed, and a failure can arrive at any time after it was started. So:
//
//   · nothing is recorded on the invoice when the client confirms or when autopay starts a debit — only when Stripe says the PaymentIntent
//     SUCCEEDED (the webhook, or the hourly pass asking Stripe for any debit still on its way): event_bank_payment follows each debit;
//   · while one is on its way the instalment cannot be paid a second time (card, bank or autopay) and is not reminded;
//   · a debit that comes back is told to the client in plain words with the pay link, once, and shown to the venue;
//   · a bank account can be left for the later instalments (a SetupIntent, or kept from a payment) with its mandate words kept; a bank
//     that must be verified with micro-deposits waits, unrecorded, until Stripe says it is verified.
//
// Money rule as the card's: every Stripe call carries the venue's connected account; the client's bank details never reach us (Stripe's
// Payment Element and Financial Connections collect them). Behind 'event_bank_payments' (not ready) on the API and in the screens.
// A debit already on its way is still settled and recorded with the feature off: the money is taken whatever the switch says.
import { Hono } from 'hono'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type Stripe from 'stripe'
import { round2, invoiceBalance } from '@twomiah/tenant-backend'
import { event, eventPayment, eventAutopay, eventBankPayment, contact, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { platformStripe } from '../platformStripe.ts'
import { cardPaymentsFor } from '../cardPayments.ts'
import { EXIT_STATUSES } from './eventBooking.ts'
import {
  type InstalmentModel, connectedAccount, payTokenFor, recordInstalmentPayment, instalmentById, ensureAutopayRow,
  activateAutopay, stopAutopay, consentOf,
} from './eventPayments.ts'

const money = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const BANK_CONSENT = 'I authorise this business to debit my bank account for this payment. The debit can take up to four business days to clear, and I will be told if my bank returns it.'
export const BANK_AUTOPAY_CONSENT = 'I authorise this business to debit this bank account for the remaining payments on my event, on the dates they are due. I can stop this at any time by telling them.'

/** What a debit on its way is: it has been accepted and the bank has not answered yet. */
const LIVE = ['requires_action', 'processing']
/** A bank that cannot be debited again: closed, not found, refused in advance or restricted. An autopay on it is stopped, not retried. */
const UNUSABLE = new Set(['account_closed', 'no_account', 'invalid_account_number', 'debit_not_authorized', 'bank_account_restricted'])
/** Why the bank sent a debit back, in words for the client. A code we do not know is told as Stripe's own sentence, never as the code. */
const REASONS: Record<string, string> = {
  insufficient_funds: 'the account did not have enough money in it',
  account_closed: 'the account is closed',
  no_account: 'the bank could not find the account',
  invalid_account_number: 'the account number was not valid',
  debit_not_authorized: 'the account holder told the bank this debit was not authorised',
  bank_account_restricted: 'the account cannot be debited',
  payment_method_microdeposit_verification_timeout: 'the bank account was not verified in time',
  payment_method_microdeposit_verification_attempts_exceeded: 'the bank account could not be verified',
  generic_decline: 'the bank returned the payment',
}
const reasonWords = (code: string | null, message: string | null) => (code && REASONS[code]) || (message ? message.replace(/\.$/, '').toLowerCase() : 'the bank returned the payment')

const stripeOf = (d: CrmDeps) => platformStripe(d.services.testStripeClient)

/**
 * Can this venue take a bank debit right now: the switch is on, cards are (their Stripe account is connected and Online Payments is on),
 * and Stripe says bank debits are active on that account — the ACH capability is something the owner turns on in Stripe, so it is asked.
 */
export async function bankPaymentsFor(d: CrmDeps, companyId: string): Promise<boolean> {
  if (!(await d.features.isFeatureEnabled(companyId, 'event_bank_payments'))) return false
  if (!(await cardPaymentsFor(d)(companyId))) return false
  const stripe = stripeOf(d), acct = await connectedAccount(d, companyId)
  if (!stripe || !acct) return false
  try { const a: any = await stripe.accounts.retrieve(acct); return a?.capabilities?.us_bank_account_ach_payments === 'active' } catch { return false }
}

/** The debit of this instalment that is on its way, if any. */
export async function bankInFlight(db: any, eventPaymentId: string) {
  const [row] = await db.select().from(eventBankPayment).where(and(eq(eventBankPayment.eventPaymentId, eventPaymentId), inArray(eventBankPayment.status, LIVE))).limit(1)
  return row || null
}
/** Autopay leaves an instalment alone while a debit of it is on its way, and after the bank sent its own debit back (the client is told; it is not retried). */
export async function bankBlocksAutopay(db: any, eventPaymentId: string): Promise<boolean> {
  if (await bankInFlight(db, eventPaymentId)) return true
  const [failed] = await db.select({ id: eventBankPayment.id }).from(eventBankPayment).where(and(eq(eventBankPayment.eventPaymentId, eventPaymentId), eq(eventBankPayment.status, 'failed'), eq(eventBankPayment.source, 'autopay'))).limit(1)
  return !!failed
}

/** What the payment pages add for a bank: whether it can be used, the words to agree to, and a debit on its way or sent back. */
export async function bankOffer(d: CrmDeps, m: InstalmentModel) {
  const canPayByBank = await bankPaymentsFor(d, m.row.companyId)
  const inflight = await bankInFlight(d.db, m.row.id)
  const rows = await d.db.select().from(eventBankPayment).where(eq(eventBankPayment.eventPaymentId, m.row.id))
  const last = rows.filter((r: any) => r.status === 'failed').sort((a: any, b: any) => +new Date(b.failedAt || 0) - +new Date(a.failedAt || 0))[0]
  return {
    canPayByBank, bankConsent: BANK_CONSENT, bankAutopayConsent: BANK_AUTOPAY_CONSENT,
    bankPending: inflight ? { amount: round2(inflight.amountCents / 100), waitingToVerify: inflight.status === 'requires_action', verifyUrl: inflight.verifyUrl || null, bank: inflight.bankName || null, last4: inflight.last4 || null, since: inflight.initiatedAt || inflight.createdAt } : null,
    bankFailed: !inflight && last && m.owed > 0.005 ? { message: last.failureMessage, at: last.failedAt } : null,
  }
}

// ── Following a debit ───────────────────────────────────────────────────────────────────────────────────────────────
async function clientMail(d: CrmDeps, ev: any, m: { subject: string; headline: string; body: string; token: string; button: string }) {
  const [client] = ev.contactId ? await d.db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
  if (!client?.email || client.emailOptOut) return
  const [co] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, ev.companyId)).limit(1)
  await d.services.emailService.send(client.email, 'eventNote', { companyName: co?.name || 'The venue', contactName: client.name || 'there', subject: m.subject, headline: m.headline, body: m.body, button: m.button, path: `/event-pay/${m.token}` })
}

/** Stripe's answer for a debit, read now — never the event's own copy of it, which can arrive out of order or twice. */
async function currentIntent(d: CrmDeps, row: any): Promise<any | null> {
  const stripe = stripeOf(d); if (!stripe) return null
  try { return await stripe.paymentIntents.retrieve(row.paymentIntentId, { stripeAccount: row.stripeAccount }) } catch { return null }
}

/**
 * Bring the venue's record of a debit up to what Stripe says it is. Safe to run any number of times and in any order (webhook, the
 * client's browser, the hourly pass): the money is recorded once, on SUCCEEDED, and a failure is told once.
 */
export async function applyBankIntent(d: CrmDeps, pi: any): Promise<{ status: string } | null> {
  const [row] = await d.db.select().from(eventBankPayment).where(eq(eventBankPayment.paymentIntentId, pi.id)).limit(1)
  if (!row) return null
  const now = new Date()
  const set = (v: Record<string, unknown>) => d.db.update(eventBankPayment).set({ ...v, updatedAt: now }).where(eq(eventBankPayment.id, row.id))
  const wasLive = LIVE.includes(row.status)
  if (row.status === 'succeeded') return { status: 'succeeded' }

  if (pi.status === 'succeeded') return settle(d, row, pi)

  if (pi.status === 'processing' || pi.status === 'requires_action') {
    const next = pi.status
    const bank = row.bankName ? null : await bankDetails(d, row, pi.payment_method)
    await set({
      status: next, initiatedAt: row.initiatedAt || now, verifyUrl: next === 'requires_action' ? pi.next_action?.verify_with_microdeposits?.hosted_verification_url || null : null,
      ...(bank ? { bankName: bank.name, last4: bank.last4 } : {}),
    })
    return { status: next }
  }

  if (pi.status === 'canceled') { if (row.status !== 'canceled') await set({ status: 'canceled', verifyUrl: null }); return { status: 'canceled' } }

  // Back at requires_payment_method: a debit that was on its way and came back has FAILED; one the client never finished is still theirs to finish.
  if (pi.status === 'requires_payment_method' && wasLive) {
    const code = pi.last_payment_error?.code || null
    const message = reasonWords(code, pi.last_payment_error?.message || null)
    const claimed = await d.db.update(eventBankPayment).set({ status: 'failed', failureCode: code, failureMessage: `The bank returned the payment: ${message}.`, failedAt: now, verifyUrl: null, updatedAt: now })
      .where(and(eq(eventBankPayment.id, row.id), inArray(eventBankPayment.status, LIVE))).returning({ id: eventBankPayment.id })
    if (claimed.length) await failed(d, row, code, message)
    return { status: 'failed' }
  }
  return { status: row.status }
}

async function bankDetails(d: CrmDeps, row: any, pm: unknown): Promise<{ name: string | null; last4: string | null } | null> {
  const stripe = stripeOf(d); if (!stripe || typeof pm !== 'string') return null
  try { const x: any = await stripe.paymentMethods.retrieve(pm, { stripeAccount: row.stripeAccount }); return { name: x.us_bank_account?.bank_name || null, last4: x.us_bank_account?.last4 || null } } catch { return null }
}

/** The bank settled the debit: recorded on the invoice (once), the event moves along, the account kept if asked, the client thanked. */
async function settle(d: CrmDeps, row: any, pi: any): Promise<{ status: string }> {
  const m = await instalmentById(d, row.eventPaymentId)
  const label = m?.inst.label || 'Payment'
  // Paid when the bank settled it, not when it was started.
  const rec = await recordInstalmentPayment(d, { id: pi.id, amount: pi.amount_received || pi.amount, created: Math.floor(Date.now() / 1000) }, row.invoiceId, `${label} — bank account debit settled`, 'bank_transfer')
  const now = new Date()
  const claimed = await d.db.update(eventBankPayment).set({
    status: 'succeeded', settledAt: now, verifyUrl: null, updatedAt: now,
    ...(rec.ok ? {} : { failureMessage: `The bank settled this payment but it could not be recorded on the invoice: ${rec.error || 'unknown reason'}. Record it by hand.` }),
  }).where(and(eq(eventBankPayment.id, row.id), eq(eventBankPayment.status, row.status))).returning({ id: eventBankPayment.id })
  if (!rec.ok) d.logger.error('[events] bank debit settled but not recorded', { payment: row.eventPaymentId, pi: pi.id, error: rec.error })
  if (!claimed.length) return { status: 'succeeded' } // another pass got here first
  if (row.source === 'autopay') await d.db.update(eventPayment).set({ autopayStatus: 'succeeded', autopayError: null }).where(eq(eventPayment.id, row.eventPaymentId))
  const [ev] = await d.db.select().from(event).where(eq(event.id, row.eventId)).limit(1)
  const stripe = stripeOf(d)
  if (row.keepForAutopay && ev && stripe && pi.payment_method) {
    try { await activateAutopay(d, ev, row.stripeAccount, stripe, String(pi.payment_method), { at: row.consentAt || now, ip: row.consentIp, text: row.consentText || BANK_AUTOPAY_CONSENT }) }
    catch (err: any) { d.logger.warn('[events] bank account not kept for autopay', { payment: row.eventPaymentId, error: err?.message }) }
  }
  try {
    if (ev) await clientMail(d, ev, { subject: `Your bank payment for ${ev.name} has cleared`, headline: `Your ${money(row.amountCents / 100)} bank payment for ${label} has cleared.`, body: 'Thank you. There is nothing more to do for this payment.', token: await payTokenFor(d.db, row.eventPaymentId), button: 'See your payment' })
  } catch { /* the payment is recorded either way */ }
  return { status: 'succeeded' }
}

/** The bank sent the debit back (told once): shown on the instalment, and the client given the pay link to try again. */
async function failed(d: CrmDeps, row: any, code: string | null, words: string) {
  const [ev] = await d.db.select().from(event).where(eq(event.id, row.eventId)).limit(1)
  if (!ev) return
  let stopped = false
  if (row.source === 'autopay') {
    await d.db.update(eventPayment).set({ autopayStatus: 'failed', autopayError: `The bank returned the payment: ${words}.` }).where(eq(eventPayment.id, row.eventPaymentId))
    // A bank that is closed, not found or refusing debits is not debited again for the next instalment.
    if (code && UNUSABLE.has(code)) {
      const [auto] = await d.db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, row.eventId), eq(eventAutopay.status, 'active'), eq(eventAutopay.method, 'us_bank_account'))).limit(1)
      if (auto) { await stopAutopay(d, auto); stopped = true }
    }
  }
  const claimed = await d.db.update(eventBankPayment).set({ noticeSentAt: new Date() }).where(and(eq(eventBankPayment.id, row.id), isNull(eventBankPayment.noticeSentAt))).returning({ id: eventBankPayment.id })
  if (!claimed.length) return
  try {
    const m = await instalmentById(d, row.eventPaymentId)
    await clientMail(d, ev, {
      subject: `Your bank payment for ${ev.name} did not go through`,
      headline: `Your ${money(row.amountCents / 100)} bank payment for ${m?.inst.label || 'your event'} did not go through.`,
      body: `Your bank returned it: ${words}.${stopped ? ' We have removed that bank account from your event.' : ''}\n\nNothing was taken. Please pay with the button below, by card or from another bank account.`,
      token: await payTokenFor(d.db, row.eventPaymentId), button: 'Pay now',
    })
  } catch (err: any) { d.logger.warn('[events] bank failure notice not sent', { payment: row.eventPaymentId, error: err?.message }) }
}

/** Autopay started a debit of a saved bank account: accepted and processing — recorded as nothing yet, followed until the bank answers. */
export async function startBankDebit(d: CrmDeps, a: { auto: any; ev: any; inst: any; invoiceId: string; pi: { id: string }; cents: number; now: Date }) {
  await d.db.insert(eventBankPayment).values({
    id: createId(), eventId: a.ev.id, eventPaymentId: a.inst.id, invoiceId: a.invoiceId, paymentIntentId: a.pi.id, stripeAccount: a.auto.stripeAccount, amountCents: a.cents,
    source: 'autopay', status: 'processing', keepForAutopay: false, consentAt: a.auto.consentAt, consentIp: a.auto.consentIp, consentText: a.auto.consentText,
    bankName: a.auto.brand, last4: a.auto.last4, initiatedAt: a.now, companyId: a.auto.companyId,
  }).onConflictDoNothing()
  await d.db.update(eventPayment).set({ autopayStatus: 'processing', autopayError: null }).where(eq(eventPayment.id, a.inst.id))
}

/** A saved-bank SetupIntent that Stripe now says is done (or failed): the account becomes the event's autopay. */
async function applyBankSetup(d: CrmDeps, auto: any, si: any): Promise<{ saved: boolean; pending?: boolean; verifyUrl?: string | null }> {
  const stripe = stripeOf(d)
  if (si.status === 'succeeded' && si.payment_method && stripe) {
    const [ev] = await d.db.select().from(event).where(eq(event.id, auto.eventId)).limit(1)
    if (!ev) return { saved: false }
    // Consent was given when the setup began (kept on the row); verifying days later does not make a new agreement.
    await activateAutopay(d, ev, auto.stripeAccount, stripe, String(si.payment_method), null)
    return { saved: true }
  }
  if (si.status === 'requires_payment_method' && si.last_setup_error) {
    await d.db.update(eventAutopay).set({ setupMethod: null, updatedAt: new Date() }).where(eq(eventAutopay.id, auto.id))
    return { saved: false }
  }
  return { saved: false, pending: true, verifyUrl: si.next_action?.verify_with_microdeposits?.hosted_verification_url || null }
}

/**
 * Stripe's events for bank debits and bank setups, claimed ahead of the shared handler (payments/stripe.ts claimConnectedEvent), whose
 * payment_intent.succeeded would record the money as a card payment. Only debits this module started are ours; the rest is not.
 */
export function bankEventClaim(d: CrmDeps) {
  return async (ev: Stripe.Event, stripeAccount: string): Promise<Record<string, unknown> | null> => {
    const type = ev.type as string
    const obj = ev.data.object as any
    if (type.startsWith('payment_intent.')) {
      const [row] = await d.db.select().from(eventBankPayment).where(eq(eventBankPayment.paymentIntentId, obj.id)).limit(1)
      if (!row) return null
      if (row.stripeAccount !== stripeAccount) return { handled: false, reason: 'not this business\'s Stripe account' }
      const out = await applyBankIntent(d, (await currentIntent(d, row)) || obj)
      return { handled: true, bankPayment: out?.status }
    }
    if (type.startsWith('setup_intent.')) {
      const [auto] = await d.db.select().from(eventAutopay).where(and(eq(eventAutopay.setupIntentId, obj.id), eq(eventAutopay.setupMethod, 'us_bank_account'))).limit(1)
      if (!auto) return null
      if (auto.stripeAccount !== stripeAccount) return { handled: false, reason: 'not this business\'s Stripe account' }
      const stripe = stripeOf(d)
      let si = obj
      if (stripe) { try { si = await stripe.setupIntents.retrieve(obj.id, { stripeAccount }) } catch { /* the event's own copy */ } }
      const out = await applyBankSetup(d, auto, si)
      return { handled: true, bankSaved: out.saved }
    }
    return null
  }
}

/**
 * The hourly pass for debits whose event never came (a missed webhook, a closed tab): ask Stripe about every debit still on its way and every bank still being verified, and
 * give up on a payment the client started and never finished after two days. Returns how many debits changed.
 */
export async function runBankSettlement(d: CrmDeps, now = new Date()): Promise<number> {
  const stripe = stripeOf(d); if (!stripe) return 0
  let changed = 0
  const quarter = new Date(now.getTime() - 15 * 60_000)
  const rows = await d.db.select().from(eventBankPayment).where(inArray(eventBankPayment.status, ['awaiting', ...LIVE]))
  for (const row of rows) {
    if (row.status === 'awaiting' && new Date(row.createdAt) > quarter) continue
    const pi = await currentIntent(d, row)
    if (!pi) continue
    if (row.status === 'awaiting' && pi.status === 'requires_payment_method' && now.getTime() - new Date(row.createdAt).getTime() > 2 * 86400_000) {
      try { await stripe.paymentIntents.cancel(pi.id, {}, { stripeAccount: row.stripeAccount }) } catch { /* already gone */ }
      await d.db.update(eventBankPayment).set({ status: 'canceled', updatedAt: now }).where(and(eq(eventBankPayment.id, row.id), eq(eventBankPayment.status, 'awaiting')))
      continue
    }
    const out = await applyBankIntent(d, pi)
    if (out && out.status !== row.status) changed++
  }
  // A bank left for later that waits on micro-deposits: the verification can finish days after the client's visit, with no event to say so.
  const waiting = await d.db.select().from(eventAutopay).where(and(eq(eventAutopay.status, 'pending'), eq(eventAutopay.setupMethod, 'us_bank_account')))
  for (const auto of waiting) {
    if (!auto.setupIntentId) continue
    let si: any
    try { si = await stripe.setupIntents.retrieve(auto.setupIntentId, { stripeAccount: auto.stripeAccount }) } catch { continue }
    if ((await applyBankSetup(d, auto, si)).saved) changed++
  }
  return changed
}

// ── The client's side: the same three pages as the card (pay link, proposal page) ──────────────────────────────────────
export function mountBankPaying(app: Hono<AppEnv>, d: CrmDeps, at: string, resolve: (c: any) => Promise<{ m: InstalmentModel; via?: string } | { res: Response }>) {
  const { db } = d
  /** The venue's side of every door: the switch (not there at all when off), then Stripe's say-so about the account. */
  const gate = async (c: any, m: InstalmentModel): Promise<Response | null> => {
    if (!(await d.features.isFeatureEnabled(m.row.companyId, 'event_bank_payments'))) return fail(c, 404, 'Not found')
    if (!(await bankPaymentsFor(d, m.row.companyId))) return fail(c, 409, 'Bank payments are not set up for this venue yet.', 'bank_off')
    return null
  }

  // POST /bank/intent { consent, saveBank?, autopayConsent? } — a PaymentIntent for a bank debit of what is still owed, on the venue's account.
  app.post(`${at}/bank/intent`, async (c) => {
    const r = await resolve(c); if ('res' in r) return r.res
    const { m } = r
    const off = await gate(c, m); if (off) return off
    if (EXIT_STATUSES.includes(m.ev.status)) return fail(c, 409, 'This event is no longer on the books.')
    if (m.owed <= 0.005) return fail(c, 409, 'This payment has been made. Thank you!')
    if (await bankInFlight(db, m.row.id)) return fail(c, 409, 'A bank payment for this is already on its way. Please wait for it to clear.', 'bank_in_flight')
    const stripe = stripeOf(d), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct || !m.ledger.invoice) return fail(c, 503, 'Bank payments are not available right now.')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (body.consent !== true) return fail(c, 400, 'Please agree to the bank debit terms first.')
    const save = body.saveBank === true
    if (save && body.autopayConsent !== true) return fail(c, 400, 'Please agree to the terms for debiting this account before choosing to keep it.')
    const cents = Math.round(Math.min(m.owed, invoiceBalance(m.ledger.invoice)) * 100)
    if (cents <= 0) return fail(c, 409, 'There is nothing to pay on this invoice.')
    let customer: string | undefined
    if (save) customer = (await ensureAutopayRow(d, m.ev, acct, stripe)).stripeCustomerId
    const pi = await stripe.paymentIntents.create({
      amount: cents, currency: 'usd', description: `${m.inst.label} — ${m.ev.name} (bank)`, payment_method_types: ['us_bank_account'],
      payment_method_options: { us_bank_account: { verification_method: 'automatic', financial_connections: { permissions: ['payment_method'] } } } as any,
      ...(customer ? { customer, setup_future_usage: 'off_session' as const } : {}),
      metadata: { invoice_id: m.ledger.invoice.id, company_id: m.row.companyId, event_id: m.ev.id, event_payment_id: m.row.id, kind: 'event_bank' },
    }, { stripeAccount: acct })
    // An earlier try the client never finished is over: only the newest is theirs to complete.
    const earlier = await db.update(eventBankPayment).set({ status: 'canceled', updatedAt: new Date() }).where(and(eq(eventBankPayment.eventPaymentId, m.row.id), eq(eventBankPayment.status, 'awaiting'))).returning({ pi: eventBankPayment.paymentIntentId })
    for (const e of earlier) { try { await stripe.paymentIntents.cancel(e.pi, {}, { stripeAccount: acct }) } catch { /* already gone */ } }
    const consent = consentOf(c)
    await db.insert(eventBankPayment).values({
      id: createId(), eventId: m.ev.id, eventPaymentId: m.row.id, invoiceId: m.ledger.invoice.id, paymentIntentId: pi.id, stripeAccount: acct, amountCents: cents,
      source: r.via ? 'proposal_page' : 'pay_link', status: 'awaiting', keepForAutopay: save,
      consentAt: consent.at, consentIp: consent.ip, consentText: save ? `${BANK_CONSENT}\n${BANK_AUTOPAY_CONSENT}` : BANK_CONSENT, companyId: m.row.companyId,
    })
    return one(c, { clientSecret: pi.client_secret, paymentIntentId: pi.id, amount: pi.amount, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', stripeAccount: acct })
  })

  // POST /bank/confirm { paymentIntentId } — the browser says the bank account was submitted; Stripe is asked. Nothing is recorded here
  // unless Stripe already says it succeeded: the usual answer is "processing", and the money is recorded when the bank settles it.
  app.post(`${at}/bank/confirm`, async (c) => {
    const r = await resolve(c); if ('res' in r) return r.res
    const { m } = r
    const off = await gate(c, m); if (off) return off
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.paymentIntentId !== 'string') return fail(c, 400, 'paymentIntentId is required')
    const [row] = await db.select().from(eventBankPayment).where(and(eq(eventBankPayment.paymentIntentId, body.paymentIntentId), eq(eventBankPayment.eventPaymentId, m.row.id))).limit(1)
    if (!row) return fail(c, 400, 'That payment is not for this link.')
    const pi = await currentIntent(d, row)
    if (!pi) return fail(c, 503, 'Bank payments are not available right now.')
    const out = await applyBankIntent(d, pi)
    const now = (await db.select().from(eventBankPayment).where(eq(eventBankPayment.id, row.id)).limit(1))[0]
    if (!out || out.status === 'awaiting' || (pi.status === 'requires_payment_method' && now.status === 'awaiting')) return fail(c, 409, 'Stripe has not received the bank account yet.', 'bank_not_submitted')
    if (out.status === 'failed') return fail(c, 409, now.failureMessage || 'The bank returned the payment.', 'bank_failed')
    return one(c, { status: out.status, message: out.status === 'succeeded' ? 'Your bank payment has cleared. Thank you!' : out.status === 'requires_action' ? 'Your bank needs one more step: verify the account with the two small deposits it will receive.' : 'Your bank payment is on its way. It can take up to four business days to clear, and we will email you when it does.', verifyUrl: now.verifyUrl || null })
  })

  // POST /bank/autopay { consent } — leave a bank account for the rest of the event without paying now: a SetupIntent on the venue's account.
  app.post(`${at}/bank/autopay`, async (c) => {
    const r = await resolve(c); if ('res' in r) return r.res
    const { m } = r
    const off = await gate(c, m); if (off) return off
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (body.consent !== true) return fail(c, 400, 'Please agree to the terms for debiting this account first.')
    const stripe = stripeOf(d), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct) return fail(c, 503, 'Bank payments are not available right now.')
    const auto = await ensureAutopayRow(d, m.ev, acct, stripe)
    const si = await stripe.setupIntents.create({
      customer: auto.stripeCustomerId, usage: 'off_session', payment_method_types: ['us_bank_account'],
      payment_method_options: { us_bank_account: { verification_method: 'automatic', financial_connections: { permissions: ['payment_method'] } } } as any,
      metadata: { event_id: m.ev.id, company_id: m.row.companyId, kind: 'event_autopay_bank' },
    }, { stripeAccount: acct })
    // The agreement is kept as given now, whenever the account is verified.
    const consent = consentOf(c)
    await db.update(eventAutopay).set({ setupIntentId: si.id, setupMethod: 'us_bank_account', consentAt: consent.at, consentIp: consent.ip, consentText: BANK_AUTOPAY_CONSENT, updatedAt: new Date() }).where(eq(eventAutopay.id, auto.id))
    return one(c, { clientSecret: si.client_secret, setupIntentId: si.id, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', stripeAccount: acct })
  })

  app.post(`${at}/bank/autopay/confirm`, async (c) => {
    const r = await resolve(c); if ('res' in r) return r.res
    const { m } = r
    const off = await gate(c, m); if (off) return off
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const stripe = stripeOf(d), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct || typeof body.setupIntentId !== 'string') return fail(c, 400, 'setupIntentId is required')
    const [auto] = await db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, m.ev.id), eq(eventAutopay.setupIntentId, body.setupIntentId), eq(eventAutopay.setupMethod, 'us_bank_account'))).limit(1)
    if (!auto) return fail(c, 400, 'That bank account setup is not for this event.')
    const si = await stripe.setupIntents.retrieve(body.setupIntentId, { stripeAccount: acct })
    const out = await applyBankSetup(d, auto, si)
    if (out.saved) return one(c, { success: true, saved: true })
    if (out.pending) return one(c, { success: true, saved: false, message: 'Your bank needs one more step: verify the account with the two small deposits it will receive. We will keep it for your event once it is verified.', verifyUrl: out.verifyUrl || null })
    return fail(c, 409, 'The bank account could not be saved. Please try again.', 'bank_setup_failed')
  })
}

// ── The venue's side: /api/event-bank-payments ─────────────────────────────────────────────────────────────────────────
export function createEventBankRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /event-bank-payments/:eventId — each bank debit of the event's instalments, newest first, with where it stands.
  app.get('/:eventId', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const [ev] = await db.select().from(event).where(and(eq(event.id, c.req.param('eventId')), eq(event.companyId, u.companyId))).limit(1)
    if (!ev) return fail(c, 404, 'Event not found')
    const rows = await db.select({ b: eventBankPayment, label: eventPayment.label }).from(eventBankPayment).innerJoin(eventPayment, eq(eventBankPayment.eventPaymentId, eventPayment.id)).where(eq(eventBankPayment.eventId, ev.id))
    const shown = rows.filter(({ b }: any) => b.status !== 'awaiting' && b.status !== 'canceled')
      .sort((a: any, b: any) => +new Date(b.b.createdAt) - +new Date(a.b.createdAt))
      .map(({ b, label }: any) => ({
        id: b.id, label, amount: round2(b.amountCents / 100), status: b.status, source: b.source, bank: b.bankName, last4: b.last4,
        startedAt: b.initiatedAt, settledAt: b.settledAt, failedAt: b.failedAt, note: b.failureMessage, verifyUrl: b.verifyUrl || null,
      }))
    return one(c, { payments: shown })
  })

  // POST /event-bank-payments/:eventId/:id/refresh — ask Stripe where this debit stands now.
  app.post('/:eventId/:id/refresh', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(eventBankPayment).where(and(eq(eventBankPayment.id, c.req.param('id')), eq(eventBankPayment.eventId, c.req.param('eventId')), eq(eventBankPayment.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Bank payment not found')
    const pi = await currentIntent(d, row)
    if (!pi) return fail(c, 503, 'Stripe could not be reached.')
    const out = await applyBankIntent(d, pi)
    return one(c, { status: out?.status || row.status })
  })
  return app
}

