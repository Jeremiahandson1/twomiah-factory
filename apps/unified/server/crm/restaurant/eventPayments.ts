// Deposit and balance, collected (restaurant-bar-depth #2; Tripleseat guest-portal payments, Perfect Venue scheduled
// payments on the card on file). The instalments are already on the event's invoice (eventLedger.ts); this adds:
//
//   · REMINDERS   an email before each instalment is due, on the day, and once after (the venue sets the days:
//                 eventSettings), each sent once — claimed before it goes — to a client who has not unsubscribed;
//   · A PAY LINK  per instalment, /pay/<token>: the amount still owed on it, paid by card on the venue's own Stripe
//                 account (the PaymentIntent is made on the connected account; the phone app takes no cards);
//   · AUTOPAY     the client may leave a card for the event (a Stripe SetupIntent on the venue's account, with their
//                 consent kept); each instalment is charged to it on its due date, off session, once a day at most,
//                 retried a few days if it fails, and the client told. The card number never reaches us.
//
// Money rule: every Stripe call carries the venue's connected account (company.integrations.stripeAccountId); nothing is
// ever charged on the platform's account. A payment is recorded on the invoice (recordInvoicePayment) by PaymentIntent id,
// once, whether the browser's confirmation or Stripe's webhook gets there first. Behind the 'event_payment_automation'
// feature (not ready).
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { recordInvoicePayment, round2, invoiceBalance, companyTimeZone } from '@twomiah/tenant-backend'
import { event, eventPayment, eventAutopay, invoice, payment, contact, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { createTokenGuessGuard } from '../../http/guards.ts'
import { platformStripe } from '../platformStripe.ts'
import { cardPaymentsFor } from '../cardPayments.ts'
import { loadEventLedger, syncEventInvoiceDueDate } from './eventLedger.ts'
import { bookOnDeposit, venueToday, eventDayWords, EXIT_STATUSES } from './eventBooking.ts'
import { getEventSettings } from './eventSettings.ts'
import { dayBefore } from './eventGuarantee.ts'

const money = (n: number) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const tokenNew = () => crypto.randomBytes(24).toString('hex')
export const AUTOPAY_CONSENT = 'I authorise this business to charge this card for the remaining payments on my event, on the dates they are due. I can stop this at any time by telling them.'
/** Days after the due date that a failed card charge is tried again. */
const RETRY_DAYS = 3

const dayAfter = (date: string, days: number) => dayBefore(date, -days)

async function connectedAccount(d: CrmDeps, companyId: string): Promise<string | null> {
  return d.services.stripeService.connectedAccountFor(companyId)
}

/** An instalment with its pay-link token, minted now if it has none. */
async function payTokenFor(db: any, paymentId: string): Promise<string> {
  const [row] = await db.select({ t: eventPayment.payToken }).from(eventPayment).where(eq(eventPayment.id, paymentId)).limit(1)
  if (row?.t) return row.t
  const t = tokenNew()
  await db.update(eventPayment).set({ payToken: t }).where(and(eq(eventPayment.id, paymentId), isNull(eventPayment.payToken)))
  const [again] = await db.select({ t: eventPayment.payToken }).from(eventPayment).where(eq(eventPayment.id, paymentId)).limit(1)
  return again.t
}

/** Record a card payment Stripe says succeeded on the event's invoice, once per PaymentIntent, then move the event along. */
export async function recordInstalmentPayment(d: CrmDeps, pi: { id: string; amount: number; created?: number }, invoiceId: string, note: string): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const out = await recordInvoicePayment(d.db, { invoice, payment }, false, {
    invoiceId, amount: round2(pi.amount / 100), method: 'card', reference: pi.id, notes: note,
    paidAt: pi.created ? new Date(pi.created * 1000) : new Date(), allowOverpayment: true, idempotentByReference: true,
  })
  if (!out.ok) return { ok: false, error: out.error }
  if (!out.duplicate) {
    // Money arriving books the date, then the invoice's due date moves to the next instalment (as an online payment does).
    await d.db.transaction(async (tx: any) => {
      const [inv] = await tx.select({ companyId: invoice.companyId, eventId: invoice.eventId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
      if (inv?.eventId) await bookOnDeposit(tx, inv.companyId, inv.eventId)
    })
    await syncEventInvoiceDueDate(d.db, invoiceId)
  }
  return { ok: true, duplicate: !!out.duplicate }
}

/** The instalment as the pay link and the reminders see it: what is owed on it now. */
async function instalmentByToken(d: CrmDeps, token: string) {
  if (!/^[0-9a-f]{48}$/.test(token)) return null
  const [row] = await d.db.select().from(eventPayment).where(eq(eventPayment.payToken, token)).limit(1)
  if (!row) return null
  const [ev] = await d.db.select().from(event).where(eq(event.id, row.eventId)).limit(1)
  const ledger = await loadEventLedger(d.db, row.companyId, row.eventId)
  const inst = ledger?.payments.find((p: any) => p.id === row.id)
  if (!ev || !ledger || !inst) return null
  return { row, ev, ledger, inst, owed: round2(inst.amount - inst.paidAmount) }
}

export function createEventPaymentRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /event-payments/:eventId — each instalment with its reminders, its pay link and the event's autopay card.
  app.get('/:eventId', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const [ev] = await db.select().from(event).where(and(eq(event.id, c.req.param('eventId')), eq(event.companyId, u.companyId))).limit(1)
    if (!ev) return fail(c, 404, 'Event not found')
    const ledger = await loadEventLedger(db, u.companyId, ev.id)
    const rows = await db.select().from(eventPayment).where(eq(eventPayment.eventId, ev.id))
    const mayLink = hasPermission(u.role, 'invoices:update', await getExtraPermissions(u.userId))
    const instalments = []
    for (const p of ledger?.payments || []) {
      const r = rows.find((x: any) => x.id === p.id)
      instalments.push({
        id: p.id, label: p.label, amount: p.amount, dueDate: p.dueDate, state: p.state, paidAmount: p.paidAmount,
        remindedBeforeAt: r?.reminderBeforeAt || null, remindedDueAt: r?.reminderDueAt || null, remindedOverdueAt: r?.reminderOverdueAt || null,
        autopayStatus: r?.autopayStatus || null, autopayError: r?.autopayError || null,
        ...(mayLink && p.state !== 'paid' && p.state !== 'void' ? { payPath: `/event-pay/${await payTokenFor(db, p.id)}` } : {}),
      })
    }
    const [auto] = await db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, ev.id), eq(eventAutopay.companyId, u.companyId))).limit(1)
    return one(c, { instalments, autopay: auto ? { status: auto.status, brand: auto.brand, last4: auto.last4, consentAt: auto.consentAt } : null, cardsOn: await cardPaymentsFor(d)(u.companyId) })
  })

  // POST /event-payments/:eventId/autopay/stop — the card is forgotten here and detached at Stripe.
  app.post('/:eventId/autopay/stop', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const [auto] = await db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, c.req.param('eventId')), eq(eventAutopay.companyId, u.companyId), ne(eventAutopay.status, 'stopped'))).limit(1)
    if (!auto) return fail(c, 404, 'No card is saved for this event.')
    await stopAutopay(d, auto)
    await audit.log({ action: 'update', entity: 'event_autopay', entityId: auto.id, entityName: 'Autopay stopped', req: { user: u } })
    return one(c, { success: true })
  })

  // POST /event-payments/:eventId/remind/:paymentId — send the reminder now.
  app.post('/:eventId/remind/:paymentId', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user') as any
    const [p] = await db.select().from(eventPayment).where(and(eq(eventPayment.id, c.req.param('paymentId')), eq(eventPayment.eventId, c.req.param('eventId')), eq(eventPayment.companyId, u.companyId))).limit(1)
    if (!p) return fail(c, 404, 'Payment not found')
    const sent = await sendReminder(d, p, 'manual')
    if (!sent.ok) return fail(c, 409, sent.error)
    return one(c, { success: true })
  })
  return app
}

async function stopAutopay(d: CrmDeps, auto: any) {
  await d.db.update(eventAutopay).set({ status: 'stopped', updatedAt: new Date() }).where(eq(eventAutopay.id, auto.id))
  const stripe = platformStripe(d.services.testStripeClient)
  if (stripe && auto.paymentMethodId) { try { await stripe.paymentMethods.detach(auto.paymentMethodId, {}, { stripeAccount: auto.stripeAccount }) } catch { /* already gone */ } }
}

// ── Reminders ───────────────────────────────────────────────────────────────────────────────────────────────────────
type Kind = 'before' | 'due' | 'overdue' | 'manual'

/** One reminder email for an instalment: what is owed, when, the pay link, and a card on file's charge date. */
async function sendReminder(d: CrmDeps, p: any, kind: Kind): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = await instalmentByToken(d, await payTokenFor(d.db, p.id))
  if (!m || m.owed <= 0.005) return { ok: false, error: 'That payment is already paid.' }
  if (EXIT_STATUSES.includes(m.ev.status)) return { ok: false, error: 'This event is no longer on the books.' }
  const [client] = m.ev.contactId ? await d.db.select().from(contact).where(eq(contact.id, m.ev.contactId)).limit(1) : [null]
  if (!client?.email) return { ok: false, error: 'The client has no email address.' }
  if (client.emailOptOut) return { ok: false, error: 'The client has asked not to be emailed.' }
  const [co] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, p.companyId)).limit(1)
  const [auto] = await d.db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, p.eventId), eq(eventAutopay.status, 'active'))).limit(1)
  const due = m.inst.dueDate ? eventDayWords(m.inst.dueDate) : null
  const headline = kind === 'overdue' ? `${m.inst.label} for ${m.ev.name} is past due.`
    : kind === 'due' ? `${m.inst.label} for ${m.ev.name} is due today.` : `${m.inst.label} for ${m.ev.name} is coming up.`
  const body = `${money(m.owed)} ${due ? (kind === 'overdue' ? `was due ${due}.` : kind === 'due' ? 'is due today.' : `is due ${due}.`) : 'is due.'}` +
    (auto && kind !== 'overdue' ? ` We will charge the ${auto.brand || 'card'} ending ${auto.last4} you left for this event on that day.` : ' You can pay by card with the button below.')
  await d.services.emailService.send(client.email, 'eventNote', {
    companyName: co?.name || 'The venue', contactName: client.name || 'there', subject: `${m.inst.label}: ${money(m.owed)} ${kind === 'overdue' ? 'past due' : 'for ' + m.ev.name}`,
    headline, body, button: auto && kind !== 'overdue' ? 'See your payment' : 'Pay now', path: `/event-pay/${m.row.payToken}`,
  })
  return { ok: true }
}

/**
 * The reminders due now, for every venue with the feature on. Each instalment gets at most one email a pass — the latest
 * step reached (before, on the day, after) — and each step once: it is claimed (its column set) before the email goes.
 * Runs hourly from 8am on the venue's clock; callable on its own (the test). Returns how many went.
 */
export async function runPaymentReminders(d: CrmDeps, now = new Date(), opts: { fromHour?: number } = {}): Promise<number> {
  let sent = 0
  const cos = await d.db.select({ id: company.id }).from(company)
  for (const co of cos) {
    if (!(await d.features.isFeatureEnabled(co.id, 'event_payment_automation'))) continue
    const s = await getEventSettings(d.db, co.id)
    // Never at 2am: from the hour the venue's clock says (the job passes 8).
    if (opts.fromHour != null) {
      const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: await companyTimeZone(d.db, co.id) }).format(now))
      if (hour < opts.fromHour) continue
    }
    const today = await venueToday(d.db, co.id)
    const rows = await d.db.select({ p: eventPayment, ev: event }).from(eventPayment).innerJoin(event, eq(eventPayment.eventId, event.id))
      .where(and(eq(eventPayment.companyId, co.id), inArray(event.status, ['tentative', 'confirmed'])))
    for (const { p } of rows) {
      if (!p.dueDate) continue
      const ledger = await loadEventLedger(d.db, co.id, p.eventId)
      const inst = ledger?.payments.find((x: any) => x.id === p.id)
      if (!inst || inst.state === 'paid' || inst.state === 'void' || inst.state === 'refunded') continue
      let kind: Kind | null = null, column: 'reminderBeforeAt' | 'reminderDueAt' | 'reminderOverdueAt' | null = null
      if (s.payRemindOverdueDays > 0 && today >= dayAfter(p.dueDate, s.payRemindOverdueDays) && !p.reminderOverdueAt) { kind = 'overdue'; column = 'reminderOverdueAt' }
      else if (s.payRemindOnDue && today >= p.dueDate && today < dayAfter(p.dueDate, Math.max(1, s.payRemindOverdueDays)) && !p.reminderDueAt && !p.reminderOverdueAt) { kind = 'due'; column = 'reminderDueAt' }
      else if (s.payRemindBeforeDays > 0 && today >= dayBefore(p.dueDate, s.payRemindBeforeDays) && today < p.dueDate && !p.reminderBeforeAt && !p.reminderDueAt) { kind = 'before'; column = 'reminderBeforeAt' }
      if (!kind || !column) continue
      // Claimed first, with the steps before it, so a step passed over is not sent later and two passes send one.
      const mark: any = { reminderBeforeAt: p.reminderBeforeAt || now }
      if (kind !== 'before') mark.reminderDueAt = p.reminderDueAt || now
      if (kind === 'overdue') mark.reminderOverdueAt = now
      const claimed = await d.db.update(eventPayment).set(mark).where(and(eq(eventPayment.id, p.id), isNull(eventPayment[column]))).returning({ id: eventPayment.id })
      if (!claimed.length) continue
      try {
        const r = await sendReminder(d, p, kind)
        if (r.ok) sent++
      } catch (err: any) { d.logger.warn('[events] payment reminder not sent', { payment: p.id, error: err?.message }) }
    }
  }
  return sent
}

// ── Autopay ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Charge each due instalment to the event's saved card, off session, on the venue's own Stripe account. Once a day at most
 * per instalment (the Stripe idempotency key names the day), retried for RETRY_DAYS after the due date if the card fails;
 * the client is told of a failure and given the pay link. Returns the number charged.
 */
export async function runAutopay(d: CrmDeps, now = new Date()): Promise<number> {
  const stripe = platformStripe(d.services.testStripeClient)
  if (!stripe) return 0
  let charged = 0
  const autos = await d.db.select().from(eventAutopay).where(eq(eventAutopay.status, 'active'))
  for (const auto of autos) {
    if (!(await d.features.isFeatureEnabled(auto.companyId, 'event_payment_automation'))) continue
    // The venue's account must still be the one the card was saved on; a reconnected account cannot charge it.
    if ((await connectedAccount(d, auto.companyId)) !== auto.stripeAccount) continue
    const today = await venueToday(d.db, auto.companyId)
    const [ev] = await d.db.select().from(event).where(eq(event.id, auto.eventId)).limit(1)
    if (!ev || !['tentative', 'confirmed'].includes(ev.status)) continue
    const ledger = await loadEventLedger(d.db, auto.companyId, auto.eventId)
    if (!ledger?.invoice) continue
    for (const inst of ledger.payments) {
      if (!inst.dueDate || inst.dueDate > today || inst.state === 'paid' || inst.state === 'void' || inst.state === 'refunded') continue
      if (today > dayAfter(inst.dueDate, RETRY_DAYS)) continue
      const [row] = await d.db.select().from(eventPayment).where(eq(eventPayment.id, inst.id)).limit(1)
      if (row.autopayAttemptedAt && String(row.autopayAttemptedAt.toISOString?.() ?? row.autopayAttemptedAt).slice(0, 10) === now.toISOString().slice(0, 10)) continue
      const owed = round2(inst.amount - inst.paidAmount)
      if (owed <= 0.005) continue
      const cents = Math.round(Math.min(owed, invoiceBalance(ledger.invoice)) * 100)
      if (cents <= 0) continue
      await d.db.update(eventPayment).set({ autopayAttemptedAt: now }).where(eq(eventPayment.id, inst.id))
      try {
        const pi = await stripe.paymentIntents.create({
          amount: cents, currency: 'usd', customer: auto.stripeCustomerId, payment_method: auto.paymentMethodId!, off_session: true, confirm: true,
          description: `${inst.label} — ${ev.name} (autopay)`,
          metadata: { invoice_id: ledger.invoice.id, company_id: auto.companyId, event_id: ev.id, event_payment_id: inst.id, kind: 'event_autopay' },
        }, { stripeAccount: auto.stripeAccount, idempotencyKey: `autopay-${inst.id}-${now.toISOString().slice(0, 10)}` })
        if (pi.status !== 'succeeded') throw Object.assign(new Error(`The card needs the cardholder to act (${pi.status}).`), { code: 'authentication_required' })
        const rec = await recordInstalmentPayment(d, pi as any, ledger.invoice.id, `${inst.label} — charged to the card on file`)
        if (!rec.ok) d.logger.error('[events] autopay charged but not recorded', { payment: inst.id, pi: pi.id, error: rec.error })
        await d.db.update(eventPayment).set({ autopayStatus: 'succeeded', autopayError: null }).where(eq(eventPayment.id, inst.id))
        charged++
      } catch (err: any) {
        const why = String(err?.raw?.message || err?.message || 'The card was declined.').slice(0, 300)
        await d.db.update(eventPayment).set({ autopayStatus: 'failed', autopayError: why }).where(eq(eventPayment.id, inst.id))
        d.logger.warn('[events] autopay failed', { payment: inst.id, error: why })
        try {
          const [client] = ev.contactId ? await d.db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
          const token = await payTokenFor(d.db, inst.id)
          const [co] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, auto.companyId)).limit(1)
          if (client?.email && !client.emailOptOut) {
            await d.services.emailService.send(client.email, 'eventNote', {
              companyName: co?.name || 'The venue', contactName: client.name || 'there', subject: `We could not charge your card for ${ev.name}`,
              headline: `The card ending ${auto.last4} did not go through for ${inst.label}.`, body: `${money(owed)} is due. Please pay with another card with the button below.`, button: 'Pay now', path: `/event-pay/${token}`,
            })
          }
        } catch { /* the failure is on the event either way */ }
      }
    }
  }
  return charged
}

// ── The client's side: /api/event-pay/<token> ───────────────────────────────────────────────────────────────────────
export function createEventPayLinkRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const stripeOf = () => platformStripe(d.services.testStripeClient)
  // Guessing links: 20 wrong ones in 15 minutes from one address and every link from it reads "not valid" for the rest of the window.
  app.use('/:token/*', createTokenGuessGuard(15 * 60_000, 20, 'This payment link is not valid.'))

  app.get('/:token', async (c) => {
    const m = await instalmentByToken(d, c.req.param('token'))
    if (!m) return fail(c, 404, 'This payment link is not valid.')
    const [co] = await db.select().from(company).where(eq(company.id, m.row.companyId)).limit(1)
    const [auto] = await db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, m.ev.id), eq(eventAutopay.status, 'active'))).limit(1)
    return one(c, {
      brand: { name: co?.name, phone: co?.phone, color: co?.primaryColor || null, logo: co?.logo || null },
      event: { name: m.ev.name, dateWords: eventDayWords(m.ev.eventDate) }, label: m.inst.label, dueDate: m.inst.dueDate, amount: m.inst.amount, owed: m.owed,
      state: m.inst.state, canPayByCard: await cardPaymentsFor(d)(m.row.companyId),
      autopay: auto ? { brand: auto.brand, last4: auto.last4 } : null, autopayConsent: AUTOPAY_CONSENT,
    })
  })

  // POST /:token/intent — a PaymentIntent for what is still owed on this instalment, on the venue's own account.
  app.post('/:token/intent', async (c) => {
    const m = await instalmentByToken(d, c.req.param('token'))
    if (!m) return fail(c, 404, 'This payment link is not valid.')
    if (EXIT_STATUSES.includes(m.ev.status)) return fail(c, 409, 'This event is no longer on the books.')
    if (m.owed <= 0.005) return fail(c, 409, 'This payment has been made. Thank you!')
    if (!(await cardPaymentsFor(d)(m.row.companyId))) return fail(c, 409, 'Card payments are not set up for this venue yet. Please pay them directly.', 'cards_off')
    const stripe = stripeOf(), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct || !m.ledger.invoice) return fail(c, 503, 'Card payments are not available right now.')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const save = body.saveCard === true
    if (save && body.consent !== true) return fail(c, 400, 'Please agree to the terms for charging this card before choosing to save it.')
    const cents = Math.round(Math.min(m.owed, invoiceBalance(m.ledger.invoice)) * 100)
    if (cents <= 0) return fail(c, 409, 'There is nothing to pay on this invoice.')
    let customer: string | undefined
    if (save) customer = (await ensureAutopayRow(d, m.ev, acct, stripe)).stripeCustomerId
    const pi = await stripe.paymentIntents.create({
      amount: cents, currency: 'usd', description: `${m.inst.label} — ${m.ev.name}`, automatic_payment_methods: { enabled: true },
      ...(customer ? { customer, setup_future_usage: 'off_session' as const } : {}),
      metadata: { invoice_id: m.ledger.invoice.id, company_id: m.row.companyId, event_id: m.ev.id, event_payment_id: m.row.id, kind: 'event_instalment' },
    }, { stripeAccount: acct })
    return one(c, { clientSecret: pi.client_secret, paymentIntentId: pi.id, amount: pi.amount, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', stripeAccount: acct })
  })

  // POST /:token/confirm { paymentIntentId, saveCard?, consent? } — the browser says it paid; Stripe is asked.
  app.post('/:token/confirm', async (c) => {
    const m = await instalmentByToken(d, c.req.param('token'))
    if (!m || !m.ledger.invoice) return fail(c, 404, 'This payment link is not valid.')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const stripe = stripeOf(), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct || typeof body.paymentIntentId !== 'string') return fail(c, 400, 'paymentIntentId is required')
    const pi = await stripe.paymentIntents.retrieve(body.paymentIntentId, { stripeAccount: acct })
    // Only a PaymentIntent made for THIS instalment, and only once Stripe says the money is in.
    if (pi.metadata?.event_payment_id !== m.row.id || pi.metadata?.invoice_id !== m.ledger.invoice.id) return fail(c, 400, 'That payment is not for this link.')
    if (pi.status !== 'succeeded') return fail(c, 409, 'Stripe has not confirmed that payment yet.')
    const rec = await recordInstalmentPayment(d, pi as any, m.ledger.invoice.id, `${m.inst.label} — paid from the pay link`)
    if (!rec.ok) return fail(c, 409, rec.error || 'The payment could not be recorded.')
    // A card kept for the rest of the event, if the client asked: only with their consent, and only a card Stripe holds.
    if (body.saveCard === true && body.consent === true && pi.payment_method) {
      await activateAutopay(d, m.ev, acct, stripe, String(pi.payment_method), c)
    }
    return one(c, { success: true, duplicate: !!rec.duplicate })
  })

  // POST /:token/autopay — leave a card for the rest of the event without paying now: a SetupIntent on the venue's account.
  app.post('/:token/autopay', async (c) => {
    const m = await instalmentByToken(d, c.req.param('token'))
    if (!m) return fail(c, 404, 'This payment link is not valid.')
    if (!(await cardPaymentsFor(d)(m.row.companyId))) return fail(c, 409, 'Card payments are not set up for this venue yet.', 'cards_off')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (body.consent !== true) return fail(c, 400, 'Please agree to the terms for charging this card first.')
    const stripe = stripeOf(), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct) return fail(c, 503, 'Card payments are not available right now.')
    const auto = await ensureAutopayRow(d, m.ev, acct, stripe)
    const si = await stripe.setupIntents.create({ customer: auto.stripeCustomerId, usage: 'off_session', metadata: { event_id: m.ev.id, company_id: m.row.companyId, kind: 'event_autopay' } }, { stripeAccount: acct })
    await db.update(eventAutopay).set({ setupIntentId: si.id, updatedAt: new Date() }).where(eq(eventAutopay.id, auto.id))
    return one(c, { clientSecret: si.client_secret, setupIntentId: si.id, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '', stripeAccount: acct })
  })

  app.post('/:token/autopay/confirm', async (c) => {
    const m = await instalmentByToken(d, c.req.param('token'))
    if (!m) return fail(c, 404, 'This payment link is not valid.')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const stripe = stripeOf(), acct = await connectedAccount(d, m.row.companyId)
    if (!stripe || !acct || typeof body.setupIntentId !== 'string') return fail(c, 400, 'setupIntentId is required')
    const [auto] = await db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, m.ev.id), eq(eventAutopay.setupIntentId, body.setupIntentId))).limit(1)
    if (!auto) return fail(c, 400, 'That card setup is not for this event.')
    const si = await stripe.setupIntents.retrieve(body.setupIntentId, { stripeAccount: acct })
    if (si.status !== 'succeeded' || !si.payment_method) return fail(c, 409, 'Stripe has not confirmed the card yet.')
    await activateAutopay(d, m.ev, acct, stripe, String(si.payment_method), c)
    return one(c, { success: true })
  })

  // POST /:token/autopay/stop — the client takes their card off the event.
  app.post('/:token/autopay/stop', async (c) => {
    const m = await instalmentByToken(d, c.req.param('token'))
    if (!m) return fail(c, 404, 'This payment link is not valid.')
    const [auto] = await db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, m.ev.id), eq(eventAutopay.status, 'active'))).limit(1)
    if (!auto) return fail(c, 404, 'No card is saved for this event.')
    await stopAutopay(d, auto)
    return one(c, { success: true })
  })
  return app
}

/** The event's autopay row, with a Stripe customer on the venue's account (made once). */
async function ensureAutopayRow(d: CrmDeps, ev: any, acct: string, stripe: any) {
  const [existing] = await d.db.select().from(eventAutopay).where(and(eq(eventAutopay.eventId, ev.id), ne(eventAutopay.status, 'stopped'))).limit(1)
  if (existing && existing.stripeAccount === acct) return existing
  const [client] = ev.contactId ? await d.db.select().from(contact).where(eq(contact.id, ev.contactId)).limit(1) : [null]
  const cust = await stripe.customers.create({ name: client?.name || ev.name, email: client?.email || undefined, metadata: { event_id: ev.id, company_id: ev.companyId } }, { stripeAccount: acct })
  const [row] = await d.db.insert(eventAutopay).values({ id: createId(), eventId: ev.id, contactId: ev.contactId || null, stripeAccount: acct, stripeCustomerId: cust.id, status: 'pending', companyId: ev.companyId }).returning()
  return row
}

async function activateAutopay(d: CrmDeps, ev: any, acct: string, stripe: any, paymentMethodId: string, c: any) {
  const auto = await ensureAutopayRow(d, ev, acct, stripe)
  let brand: string | null = null, last4: string | null = null
  try { const pm: any = await stripe.paymentMethods.retrieve(paymentMethodId, { stripeAccount: acct }); brand = pm.card?.brand || null; last4 = pm.card?.last4 || null } catch { /* shown without them */ }
  const f = c.req.header('x-forwarded-for')
  await d.db.update(eventAutopay).set({
    status: 'active', paymentMethodId, brand, last4, consentAt: new Date(), consentIp: f ? f.split(',')[0].trim() : c.req.header('x-real-ip') || null, consentText: AUTOPAY_CONSENT, updatedAt: new Date(),
  }).where(eq(eventAutopay.id, auto.id))
}

/** The hourly pass: reminders from 8am on the venue's clock, and the day's autopay charges. Started by the CRM's job runner. */
export function startEventPaymentJobs(d: CrmDeps) {
  const pass = async () => {
    try { await runPaymentReminders(d, new Date(), { fromHour: 8 }); await runAutopay(d) } catch (err: any) { d.logger.error('[events] payment pass failed', { error: err?.message }) }
  }
  setTimeout(pass, 90_000)
  setInterval(pass, 60 * 60 * 1000)
}
