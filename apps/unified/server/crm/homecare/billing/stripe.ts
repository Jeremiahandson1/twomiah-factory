// Card payment of a visit invoice through Stripe: the office's checkout session and shareable pay link, the family's
// public pay page, Stripe's webhook, the success page's check and an invoice's payment history. Moved from
// templates/crm-homecare/backend/src/routes/stripe.ts.
//
// Home care's own, not the CRM's shared /api/stripe (packages/tenant-backend payments/stripe.ts): that one pays the
// CRM's `invoice` (a contact's), this one a visit `invoices` row, onto the visit-invoice ledger (invoice_payments)
// through the invoice engine. The webhook's signature check is the shared service's (constructWebhookEvent — the same
// call home care made). For the home-care vertical this router answers /api/stripe in the shared one's place
// (modules/crm.ts, CrmSettings.homecare).
//
// Who: a public mount. The pay page, the webhook and the success check answer without a session, as the template's did
// (the pay page only for a released invoice; the webhook by Stripe's signature). Everything else signs the person in
// first: the status needs no permission (it was any signed-in person's); a checkout session or a pay link is
// care-billing:update (the template's requireAdmin; a pay link releases the draft); an invoice's payment history is
// care-billing:read — the template let ANY signed-in person, a caregiver included, read any invoice and its Stripe
// payment there.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { invoices, clients } from '../../../db/schema/index.ts'
import { isClientVisibleInvoice } from '../core/invoiceEngine.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import { body, who } from './shared.ts'

const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000'

let client: any = undefined
/** The Stripe client for STRIPE_SECRET_KEY, made once; null when the key (or the SDK) is missing. */
async function stripeClient(logger: CrmDeps['logger']): Promise<any | null> {
  if (client !== undefined) return client
  client = null
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = (await import('stripe')).default
      client = new Stripe(process.env.STRIPE_SECRET_KEY)
    } catch {
      logger.warn('Stripe SDK not installed — payment endpoints disabled')
    }
  }
  return client
}

export function createVisitInvoiceStripeRoutes(core: HomecareCore, d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const signedIn = d.authenticate
  const app = new Hono<AppEnv>()

  const requireStripe = async (c: any, next: any) => {
    if (!(await stripeClient(logger))) return fail(c, 503, 'Card payments are not available on your account yet — contact Twomiah to switch them on.', 'payments_unavailable')
    await next()
  }

  /** One invoice with its client's name and email (any company: the public pay page and the webhook know only the id). */
  async function invoiceWithClient(invoiceId: string, companyId?: string) {
    const [row] = await db.select({ invoice: invoices, firstName: clients.firstName, lastName: clients.lastName, clientEmail: clients.email })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(companyId ? and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)) : eq(invoices.id, invoiceId))
      .limit(1)
    return row ?? null
  }

  // ── Public ─────────────────────────────────────────────────────────────────────────────────────

  // GET /invoice/:invoiceId/pay — the public pay page's invoice. A draft — never sent, or rescinded — is not payable: an
  // old emailed link must stop working.
  app.get('/invoice/:invoiceId/pay', requireStripe, async (c) => {
    const row = await invoiceWithClient(c.req.param('invoiceId'))
    if (!row) return fail(c, 404, 'Invoice not found')
    const inv = row.invoice
    if (!isClientVisibleInvoice(inv)) return fail(c, 404, 'This invoice is no longer available. Please contact the office.')
    return one(c, {
      invoiceNumber: inv.invoiceNumber,
      clientName: `${row.firstName} ${row.lastName}`,
      total: inv.total,
      amountDue: (parseFloat(inv.total) - parseFloat(inv.amountPaid || '0')).toFixed(2),
      status: inv.paymentStatus,
      billingPeriod: { start: inv.billingPeriodStart, end: inv.billingPeriodEnd },
    })
  })

  // POST /invoice/:invoiceId/pay — a checkout session from the public pay page. Same draft gate as the GET.
  app.post('/invoice/:invoiceId/pay', requireStripe, async (c) => {
    const invoiceId = c.req.param('invoiceId')
    const row = await invoiceWithClient(invoiceId)
    if (!row) return fail(c, 404, 'Invoice not found')
    const { invoice, firstName, lastName, clientEmail } = row
    if (!isClientVisibleInvoice(invoice)) return fail(c, 404, 'This invoice is no longer available. Please contact the office.')
    if (invoice.paymentStatus === 'paid') return fail(c, 400, 'Invoice already paid')
    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || '0')
    if (amountDue <= 0) return fail(c, 400, 'No amount due')
    const stripe = await stripeClient(logger)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice #${invoice.invoiceNumber}`, description: `Home Care Services - ${firstName} ${lastName}` },
          unit_amount: Math.round(amountDue * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${FRONTEND_URL()}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
      cancel_url: `${FRONTEND_URL()}/pay/${invoiceId}?cancelled=true`,
      customer_email: clientEmail || undefined,
      metadata: { invoice_id: invoiceId },
    })
    await db.update(invoices).set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, invoice.companyId)))
    return one(c, { url: session.url })
  })

  // POST /webhook — Stripe's events, verified by signature.
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
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const invoiceId = session.metadata?.invoice_id
        const row = invoiceId ? await invoiceWithClient(invoiceId) : null
        if (row) {
          const companyId = row.invoice.companyId
          const amountPaid = session.amount_total / 100
          // The payment goes on the ledger (invoice_payments) like every other payment; amountPaid and the status are
          // recomputed from it. The payment intent is the reference, so a re-delivered webhook records nothing twice.
          // Money that arrived is recorded even past the balance.
          await core.invoices.recordInvoicePayment({
            companyId, invoiceId, amount: amountPaid, paymentDate: await core.time.today(companyId), method: 'stripe',
            reference: session.payment_intent || session.id || null, notes: 'Stripe checkout', allowOverpayment: true,
          })
          await db.update(invoices).set({ stripePaymentIntentId: session.payment_intent, updatedAt: new Date() })
            .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
          logger.info(`Payment received for invoice ${invoiceId}: $${amountPaid}`)
        }
        break
      }
      case 'payment_intent.payment_failed': {
        logger.error(`Payment failed: ${event.data.object.last_payment_error?.message}`)
        break
      }
    }
    return one(c, { received: true })
  })

  // GET /verify-payment/:sessionId — the success page's check that the session was paid.
  app.get('/verify-payment/:sessionId', requireStripe, async (c) => {
    const stripe = await stripeClient(logger)
    const session = await stripe.checkout.sessions.retrieve(c.req.param('sessionId'))
    if (session.payment_status === 'paid') {
      return one(c, { success: true, amount: session.amount_total / 100, invoiceId: session.metadata?.invoice_id, customerEmail: session.customer_email })
    }
    return one(c, { success: false, status: session.payment_status })
  })

  // ── Signed in ──────────────────────────────────────────────────────────────────────────────────

  // GET /status — whether Stripe is configured.
  app.get('/status', signedIn, async (c) => one(c, { configured: !!(await stripeClient(logger)) }))

  // POST /create-checkout-session — the office's checkout for an invoice.
  app.post('/create-checkout-session', signedIn, requirePermission('care-billing:update'), requireStripe, async (c) => {
    const { companyId } = who(c)
    const { invoiceId } = await body(c)
    if (!invoiceId) return fail(c, 400, 'Invoice ID required')
    const row = await invoiceWithClient(invoiceId, companyId)
    if (!row) return fail(c, 404, 'Invoice not found')
    const { invoice, firstName, lastName, clientEmail } = row
    if (invoice.paymentStatus === 'paid') return fail(c, 400, 'Invoice already paid')
    // What is still due (the template charged the whole total even after a partial payment).
    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || '0')
    if (amountDue <= 0) return fail(c, 400, 'No amount due')
    const stripe = await stripeClient(logger)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice #${invoice.invoiceNumber}`, description: `Home Care Services - ${firstName} ${lastName}` },
          unit_amount: Math.round(amountDue * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${FRONTEND_URL()}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
      cancel_url: `${FRONTEND_URL()}/payment-cancelled?invoice_id=${invoiceId}`,
      customer_email: clientEmail || undefined,
      metadata: { invoice_id: invoiceId, client_name: `${firstName} ${lastName}` },
    })
    await db.update(invoices).set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)))
    return one(c, { sessionId: session.id, url: session.url })
  })

  // POST /create-payment-link — a shareable pay link. It is an explicit "send it out", so it also releases the draft to
  // the family portal (billing port, CVHC v55).
  app.post('/create-payment-link', signedIn, requirePermission('care-billing:update'), requireStripe, async (c) => {
    const { companyId } = who(c)
    const { invoiceId } = await body(c)
    const row = invoiceId ? await invoiceWithClient(invoiceId, companyId) : null
    if (!row) return fail(c, 404, 'Invoice not found')
    const { invoice, firstName, lastName } = row
    const amountDue = parseFloat(invoice.total) - parseFloat(invoice.amountPaid || '0')
    if (amountDue <= 0) return fail(c, 400, 'No amount due')
    const stripe = await stripeClient(logger)
    const price = await stripe.prices.create({ currency: 'usd', unit_amount: Math.round(amountDue * 100), product_data: { name: `Invoice #${invoice.invoiceNumber}` } })
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { invoice_id: invoiceId, client_name: `${firstName} ${lastName}` },
      after_completion: { type: 'redirect', redirect: { url: `${FRONTEND_URL()}/payment-success?invoice_id=${invoiceId}` } },
    })
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
      try { stripePayment = await (await stripeClient(logger)).paymentIntents.retrieve(row.invoice.stripePaymentIntentId) } catch { /* not found at Stripe */ }
    }
    return one(c, { invoice: row.invoice, stripePayment })
  })

  return app
}
