// Card payment of a visit invoice through Stripe: the office's checkout session and shareable pay link, the invoice's
// own public page (/d/<token>, the link its email carries), Stripe's webhook and the Factory's forwarded Connect events,
// the success page's check and an invoice's payment history. Moved from templates/crm-homecare/backend/src/routes/stripe.ts.
//
// Home care's own, not the CRM's shared /api/stripe (packages/tenant-backend payments/stripe.ts): that one pays the
// CRM's `invoice` (a contact's), this one a visit `invoices` row, onto the visit-invoice ledger (invoice_payments)
// through the invoice engine. The webhook's signature check is the shared service's (constructWebhookEvent — the same
// call home care made). For the home-care vertical this router answers /api/stripe in the shared one's place
// (modules/crm.ts, CrmSettings.homecare).
//
// One rule with the CRM's invoices (live test, 2026-10-23 — the agency's invoice email had no way to pay):
//   · the public page is reached by the invoice's own token (/d/<token>, packages/tenant-backend portal/documentLinks.ts),
//     never by its id — the page was /pay/<invoice id>;
//   · a card is offered only when the agency can take one (crm/cardPayments.ts: Stripe here, the agency's own account
//     connected, Online Payments on); otherwise the page says plainly how to pay, with the agency's phone and email. It
//     offered a card whenever the platform's key was set, and told a family to "contact Twomiah" when it wasn't;
//   · every charge is made on the agency's connected account, as the CRM's are — this file charged the platform's
//     account. Its events come back through the Factory's Connect forwarder (POST /factory-event), which this router
//     never answered for a home-care tenant.
//
// Who: a public mount. The invoice's page, the webhook, the Factory's events and the success check answer without a
// session (the page only for a released invoice; the webhook by Stripe's signature; the Factory's events by its key).
// Everything else signs the person in first: the status needs no permission; a checkout session or a pay link is
// care-billing:update (a pay link releases the draft); an invoice's payment history is care-billing:read.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { isDocumentToken } from '@twomiah/tenant-backend'
import { invoices, clients, company } from '../../../db/schema/index.ts'
import { isClientVisibleInvoice, round2 } from '../core/invoiceEngine.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import { cardPaymentsFor } from '../../cardPayments.ts'
import { body, who, num } from './shared.ts'
import { stripeClientFor } from '../core/stripeClient.ts'

/** The CRM's own sentences for the same two answers (packages/tenant-backend portal.ts, payments/stripe.ts). */
const LINK_GONE = 'This link is not valid. Please contact the business that sent it.'
const NOT_ONLINE = 'This business does not take card payments online. Please contact them to pay another way.'

/** What is still owed on a visit invoice: total less payments and write-downs (the invoice email's figure). */
export const visitInvoiceOwed = (inv: { total: unknown; amountPaid?: unknown; amountAdjusted?: unknown }) =>
  Math.max(0, round2(num(inv.total) - num(inv.amountPaid) - num(inv.amountAdjusted)))

export function createVisitInvoiceStripeRoutes(core: HomecareCore, d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const signedIn = d.authenticate
  const app = new Hono<AppEnv>()
  const canTakeCards = cardPaymentsFor(d)
  /** The tests' fake client when one was handed to the app (TestSeams.stripe), else the one made from the key. */
  const stripeClient = (_logger: CrmDeps['logger']) => stripeClientFor(d)
  /** The agency's own Stripe account; every call about its money carries it (payments/stripe.ts requestOpts). */
  const accountOpts = async (companyId: string) => {
    const acct = await d.services.stripeService.connectedAccountFor(companyId)
    return acct ? { stripeAccount: acct } : undefined
  }
  /** Where Stripe sends the payer back: the app's own address (the email's), else the address this request came to. */
  const originOf = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '')

  const requireStripe = async (c: any, next: any) => {
    if (!(await stripeClient(logger))) return fail(c, 503, 'Card payments are not available on your account yet — contact Twomiah to switch them on.', 'payments_unavailable')
    await next()
  }

  /** One invoice with its client's name and email (any company: the webhook knows only the id). */
  async function invoiceWithClient(invoiceId: string, companyId?: string) {
    const [row] = await db.select({ invoice: invoices, firstName: clients.firstName, lastName: clients.lastName, clientEmail: clients.email })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(companyId ? and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)) : eq(invoices.id, invoiceId))
      .limit(1)
    return row ?? null
  }
  /** The invoice its own link names, if that link is one and the invoice is released (a draft's link stops working). */
  async function invoiceByToken(token: string) {
    if (!isDocumentToken(token)) return null
    const [row] = await db.select({ invoice: invoices, firstName: clients.firstName, lastName: clients.lastName, clientEmail: clients.email })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(invoices.publicToken, token))
      .limit(1)
    return row && isClientVisibleInvoice(row.invoice) ? row : null
  }

  /** A Stripe Checkout page for what is still owed — or, from the invoice's page, a part of it (row 22) — on the agency's own account. */
  async function checkoutFor(row: NonNullable<Awaited<ReturnType<typeof invoiceWithClient>>>, urls: { success: string; cancel: string }, extra: Record<string, string> = {}, amountCents?: number) {
    const { invoice, firstName, lastName, clientEmail } = row
    const stripe = await stripeClient(logger)
    const part = amountCents != null && amountCents < Math.round(visitInvoiceOwed(invoice) * 100)
    return stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice #${invoice.seqNumber ?? invoice.invoiceNumber}${part ? ' (part payment)' : ''}`, description: `Home Care Services - ${firstName} ${lastName}` },
          unit_amount: amountCents ?? Math.round(visitInvoiceOwed(invoice) * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: urls.success,
      cancel_url: urls.cancel,
      customer_email: clientEmail || undefined,
      metadata: { invoice_id: invoice.id, ...extra },
    }, await accountOpts(invoice.companyId))
  }

  /** A paid checkout goes on the ledger (invoice_payments) like every other payment — once, by its payment intent. */
  async function onEvent(event: any): Promise<boolean> {
    // Autopay's own events first (a card saved on Stripe's page, or one of its charges finishing).
    if (await core.autopay.onEvent(event)) return true
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const invoiceId = session.metadata?.invoice_id
      const row = invoiceId ? await invoiceWithClient(invoiceId) : null
      if (!row) return false
      const companyId = row.invoice.companyId
      const amountPaid = session.amount_total / 100
      // amountPaid and the status are recomputed from the ledger; the payment intent is the reference, so a re-delivered
      // event records nothing twice. Money that arrived is recorded even past the balance.
      await core.invoices.recordInvoicePayment({
        companyId, invoiceId, amount: amountPaid, paymentDate: await core.time.today(companyId), method: 'stripe',
        reference: session.payment_intent || session.id || null, notes: 'Stripe checkout', allowOverpayment: true,
      })
      await db.update(invoices).set({ stripePaymentIntentId: session.payment_intent, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
      logger.info(`Payment received for invoice ${invoiceId}: $${amountPaid}`)
      return true
    }
    if (event.type === 'payment_intent.payment_failed') logger.error(`Payment failed: ${event.data.object.last_payment_error?.message}`)
    return false
  }

  // ── Public ─────────────────────────────────────────────────────────────────────────────────────

  // GET /document/:token — the invoice's own page (/d/<token>): what is owed, and whether it can be paid by card here or
  // how to pay the agency instead. It answers without Stripe: a family can always read what it owes.
  app.get('/document/:token', async (c) => {
    const row = await invoiceByToken(c.req.param('token'))
    if (!row) return fail(c, 404, LINK_GONE)
    const inv = row.invoice
    const [agency] = await db.select({ name: company.name, phone: company.phone, email: company.email }).from(company).where(eq(company.id, inv.companyId)).limit(1)
    const amountDue = visitInvoiceOwed(inv)
    return one(c, {
      invoiceNumber: String(inv.seqNumber ?? inv.invoiceNumber),
      clientName: `${row.firstName} ${row.lastName}`,
      total: num(inv.total).toFixed(2),
      amountPaid: num(inv.amountPaid).toFixed(2),
      amountDue: amountDue.toFixed(2),
      status: inv.paymentStatus,
      dueDate: inv.paymentDueDate,
      billingPeriod: { start: inv.billingPeriodStart, end: inv.billingPeriodEnd },
      payOnline: amountDue > 0 && !!(await stripeClient(logger)) && await canTakeCards(inv.companyId).catch(() => false),
      business: { name: agency?.name ?? null, phone: agency?.phone ?? null, email: agency?.email ?? null },
    })
  })

  // POST /document/:token/pay { amountCents? } — a checkout from the invoice's page, on the agency's account, for what is owed
  // or (row 22) a part of it. Refused, in the CRM's words, when the agency can't take a card.
  app.post('/document/:token/pay', async (c) => {
    const token = c.req.param('token')
    const row = await invoiceByToken(token)
    if (!row) return fail(c, 404, LINK_GONE)
    const owedCents = Math.round(visitInvoiceOwed(row.invoice) * 100)
    if (row.invoice.paymentStatus === 'paid' || owedCents <= 0) return fail(c, 400, 'This invoice has nothing left to pay.')
    if (!(await stripeClient(logger)) || !(await canTakeCards(row.invoice.companyId).catch(() => false))) return fail(c, 400, NOT_ONLINE, 'payments_unavailable')
    const b = await c.req.json().catch(() => ({} as any))
    let amountCents: number | undefined
    if (b?.amountCents !== undefined && b?.amountCents !== null && b?.amountCents !== '') {
      amountCents = Number(b.amountCents)
      if (!Number.isInteger(amountCents) || amountCents < 100) return fail(c, 400, 'A part payment is at least $1.00.', 'bad_amount')
      if (amountCents > owedCents) return fail(c, 400, `Only $${(owedCents / 100).toFixed(2)} is owed on this invoice.`, 'over_owed')
    }
    const origin = originOf(c)
    const session = await checkoutFor(row, {
      success: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&doc=${token}`,
      cancel: `${origin}/d/${token}?cancelled=true`,
    }, {}, amountCents)
    await db.update(invoices).set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
      .where(and(eq(invoices.id, row.invoice.id), eq(invoices.companyId, row.invoice.companyId)))
    return one(c, { url: session.url })
  })

  // POST /webhook — Stripe's events on this server's own keys, verified by signature.
  app.post('/webhook', requireStripe, async (c) => {
    const sig = c.req.header('stripe-signature')
    if (!process.env.STRIPE_WEBHOOK_SECRET) return fail(c, 500, 'Webhook secret not configured')
    let event: any
    try {
      event = await d.services.stripeService.constructWebhookEvent(await c.req.text(), sig || '')
    } catch (err: any) {
      logger.error('Webhook signature verification failed', { error: err.message })
      return fail(c, 400, `Webhook Error: ${err.message}`)
    }
    await onEvent(event)
    return one(c, { received: true })
  })

  // POST /factory-event — an event on the agency's connected account, forwarded by the Factory (apps/api
  // services/connectWebhook.ts) with its key, as the CRM's shared router takes it. A visit invoice's checkout is recorded
  // here; anything else (a booking deposit) is the shared Stripe service's, as it is for every other vertical.
  app.post('/factory-event', async (c) => {
    const syncKey = process.env.FACTORY_SYNC_KEY
    if (!syncKey) return fail(c, 503, 'Sync not configured')
    if ((c.req.header('X-Factory-Key') || '') !== syncKey) return fail(c, 401, 'Unauthorized')
    const b = await body(c)
    const event = b?.event
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || !event.data?.object) return fail(c, 400, 'event with type and data.object is required')
    if (await onEvent(event)) return one(c, { received: true })
    const result = await d.services.stripeService.handleWebhook(event)
    return one(c, { received: true, ...(result && typeof result === 'object' ? result : {}) })
  })

  // GET /verify-payment/:sessionId — the success page's check that the session was paid. `doc` (the invoice's token)
  // says which agency's account the session is on.
  app.get('/verify-payment/:sessionId', requireStripe, async (c) => {
    const stripe = await stripeClient(logger)
    const row = await invoiceByToken(c.req.query('doc') || '')
    const session = await stripe.checkout.sessions.retrieve(c.req.param('sessionId'), row ? await accountOpts(row.invoice.companyId) : undefined)
    if (session.payment_status === 'paid') {
      return one(c, { success: true, amount: session.amount_total / 100, invoiceId: session.metadata?.invoice_id, customerEmail: session.customer_email })
    }
    return one(c, { success: false, status: session.payment_status })
  })

  // ── Signed in ──────────────────────────────────────────────────────────────────────────────────

  // GET /status — whether Stripe is configured, and whether this agency can take a card.
  app.get('/status', signedIn, async (c) => one(c, { configured: !!(await stripeClient(logger)), cardPayments: await canTakeCards(who(c).companyId).catch(() => false) }))

  // POST /create-checkout-session — the office's checkout for an invoice, on the agency's account.
  app.post('/create-checkout-session', signedIn, requirePermission('care-billing:update'), requireStripe, async (c) => {
    const { companyId } = who(c)
    const { invoiceId } = await body(c)
    if (!invoiceId) return fail(c, 400, 'Invoice ID required')
    const row = await invoiceWithClient(invoiceId, companyId)
    if (!row) return fail(c, 404, 'Invoice not found')
    if (row.invoice.paymentStatus === 'paid') return fail(c, 400, 'Invoice already paid')
    if (visitInvoiceOwed(row.invoice) <= 0) return fail(c, 400, 'No amount due')
    if (!(await canTakeCards(companyId).catch(() => false))) return fail(c, 400, 'Card payments are not connected — connect Stripe in Settings › Integrations and switch on Online Payments.', 'payments_unavailable')
    const origin = originOf(c)
    const session = await checkoutFor(row, {
      success: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
      cancel: `${origin}/payment-cancelled?invoice_id=${invoiceId}`,
    }, { client_name: `${row.firstName} ${row.lastName}` })
    await db.update(invoices).set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    return one(c, { sessionId: session.id, url: session.url })
  })

  // POST /create-payment-link — a shareable pay link, on the agency's account. It is an explicit "send it out", so it
  // also releases the draft to the family portal (billing port, CVHC v55).
  app.post('/create-payment-link', signedIn, requirePermission('care-billing:update'), requireStripe, async (c) => {
    const { companyId } = who(c)
    const { invoiceId } = await body(c)
    const row = invoiceId ? await invoiceWithClient(invoiceId, companyId) : null
    if (!row) return fail(c, 404, 'Invoice not found')
    const { invoice, firstName, lastName } = row
    const amountDue = visitInvoiceOwed(invoice)
    if (amountDue <= 0) return fail(c, 400, 'No amount due')
    if (!(await canTakeCards(companyId).catch(() => false))) return fail(c, 400, 'Card payments are not connected — connect Stripe in Settings › Integrations and switch on Online Payments.', 'payments_unavailable')
    const stripe = await stripeClient(logger)
    const opts = await accountOpts(companyId)
    const price = await stripe.prices.create({ currency: 'usd', unit_amount: Math.round(amountDue * 100), product_data: { name: `Invoice #${invoice.seqNumber ?? invoice.invoiceNumber}` } }, opts)
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { invoice_id: invoiceId, client_name: `${firstName} ${lastName}` },
      after_completion: { type: 'redirect', redirect: { url: `${originOf(c)}/payment-success?invoice_id=${invoiceId}` } },
    }, opts)
    await db.update(invoices).set({ sentAt: invoice.sentAt ?? new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    return one(c, { paymentLink: paymentLink.url, linkId: paymentLink.id })
  })

  // GET /payments/:invoiceId — an invoice and its Stripe payment.
  app.get('/payments/:invoiceId', signedIn, requirePermission('care-billing:read'), requireStripe, async (c) => {
    const row = await invoiceWithClient(c.req.param('invoiceId'), who(c).companyId)
    if (!row) return fail(c, 404, 'Invoice not found')
    let stripePayment = null
    if (row.invoice.stripePaymentIntentId) {
      try { stripePayment = await (await stripeClient(logger)).paymentIntents.retrieve(row.invoice.stripePaymentIntentId, await accountOpts(row.invoice.companyId)) } catch { /* not found at Stripe */ }
    }
    return one(c, { invoice: row.invoice, stripePayment })
  })

  return app
}
