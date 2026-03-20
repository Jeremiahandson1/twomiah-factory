import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { invoices, clients } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import logger from '../services/logger.ts'

let stripe: any = null
if (process.env.STRIPE_SECRET_KEY) {
  try {
    const Stripe = (await import('stripe')).default
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  } catch {
    logger.warn('Stripe SDK not installed — payment endpoints disabled')
  }
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

const app = new Hono()

const requireStripe = async (c: any, next: any) => {
  if (!stripe) return c.json({ error: 'Stripe payments not configured. Set STRIPE_SECRET_KEY.' }, 503)
  await next()
}

// GET /status — check if Stripe is configured
app.get('/status', authenticate, (c) => {
  return c.json({ configured: !!stripe })
})

// POST /create-checkout-session — create Stripe checkout for an invoice
app.post('/create-checkout-session', authenticate, requireAdmin, requireStripe, async (c) => {
  const { invoiceId } = await c.req.json()
  if (!invoiceId) return c.json({ error: 'Invoice ID required' }, 400)

  const rows = await db
    .select({
      invoice: invoices,
      firstName: clients.firstName,
      lastName: clients.lastName,
      clientEmail: clients.email,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, invoiceId))

  if (!rows.length) return c.json({ error: 'Invoice not found' }, 404)

  const { invoice, firstName, lastName, clientEmail } = rows[0]

  if (invoice.paymentStatus === 'paid') {
    return c.json({ error: 'Invoice already paid' }, 400)
  }

  const amountDue = parseFloat(invoice.total) - parseFloat(invoice.paymentDate ? '0' : '0')
  if (amountDue <= 0) return c.json({ error: 'No amount due' }, 400)

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Invoice #${invoice.invoiceNumber}`,
          description: `Home Care Services - ${firstName} ${lastName}`,
        },
        unit_amount: Math.round(amountDue * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
    cancel_url: `${FRONTEND_URL}/payment-cancelled?invoice_id=${invoiceId}`,
    customer_email: clientEmail || undefined,
    metadata: { invoice_id: invoiceId, client_name: `${firstName} ${lastName}` },
  })

  await db.update(invoices)
    .set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))

  return c.json({ sessionId: session.id, url: session.url })
})

// POST /create-payment-link — shareable payment link
app.post('/create-payment-link', authenticate, requireAdmin, requireStripe, async (c) => {
  const { invoiceId } = await c.req.json()

  const rows = await db
    .select({ invoice: invoices, firstName: clients.firstName, lastName: clients.lastName })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, invoiceId))

  if (!rows.length) return c.json({ error: 'Invoice not found' }, 404)

  const { invoice, firstName, lastName } = rows[0]
  const amountDue = parseFloat(invoice.total)
  if (amountDue <= 0) return c.json({ error: 'No amount due' }, 400)

  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: Math.round(amountDue * 100),
    product_data: { name: `Invoice #${invoice.invoiceNumber}` },
  })

  const paymentLink = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { invoice_id: invoiceId, client_name: `${firstName} ${lastName}` },
    after_completion: {
      type: 'redirect',
      redirect: { url: `${FRONTEND_URL}/payment-success?invoice_id=${invoiceId}` },
    },
  })

  return c.json({ paymentLink: paymentLink.url, linkId: paymentLink.id })
})

// GET /invoice/:invoiceId/pay — public invoice info for payment page
app.get('/invoice/:invoiceId/pay', requireStripe, async (c) => {
  const invoiceId = c.req.param('invoiceId')

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      total: invoices.total,
      paymentStatus: invoices.paymentStatus,
      billingPeriodStart: invoices.billingPeriodStart,
      billingPeriodEnd: invoices.billingPeriodEnd,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, invoiceId))

  if (!rows.length) return c.json({ error: 'Invoice not found' }, 404)

  const inv = rows[0]
  return c.json({
    invoiceNumber: inv.invoiceNumber,
    clientName: `${inv.firstName} ${inv.lastName}`,
    total: inv.total,
    amountDue: inv.total,
    status: inv.paymentStatus,
    billingPeriod: { start: inv.billingPeriodStart, end: inv.billingPeriodEnd },
  })
})

// POST /invoice/:invoiceId/pay — create checkout session (public)
app.post('/invoice/:invoiceId/pay', requireStripe, async (c) => {
  const invoiceId = c.req.param('invoiceId')

  const rows = await db
    .select({
      invoice: invoices,
      firstName: clients.firstName,
      lastName: clients.lastName,
      clientEmail: clients.email,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, invoiceId))

  if (!rows.length) return c.json({ error: 'Invoice not found' }, 404)

  const { invoice, firstName, lastName, clientEmail } = rows[0]
  if (invoice.paymentStatus === 'paid') return c.json({ error: 'Invoice already paid' }, 400)

  const amountDue = parseFloat(invoice.total)

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Invoice #${invoice.invoiceNumber}`,
          description: `Home Care Services - ${firstName} ${lastName}`,
        },
        unit_amount: Math.round(amountDue * 100),
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
    cancel_url: `${FRONTEND_URL}/pay/${invoiceId}?cancelled=true`,
    customer_email: clientEmail || undefined,
    metadata: { invoice_id: invoiceId },
  })

  await db.update(invoices)
    .set({ stripePaymentIntentId: session.id, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId))

  return c.json({ url: session.url })
})

// POST /webhook — Stripe webhook handler
app.post('/webhook', requireStripe, async (c) => {
  const sig = c.req.header('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 500)
  }

  let event: any
  try {
    const body = await c.req.text()
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: any) {
    logger.error('Webhook signature verification failed', { error: err.message })
    return c.json({ error: `Webhook Error: ${err.message}` }, 400)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const invoiceId = session.metadata?.invoice_id

      if (invoiceId) {
        const amountPaid = session.amount_total / 100
        await db.update(invoices).set({
          paymentStatus: 'paid',
          paymentMethod: 'stripe',
          paymentDate: new Date().toISOString().split('T')[0],
          stripePaymentIntentId: session.payment_intent,
          updatedAt: new Date(),
        }).where(eq(invoices.id, invoiceId))

        logger.info(`Payment received for invoice ${invoiceId}: $${amountPaid}`)
      }
      break
    }
    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object
      logger.error(`Payment failed: ${paymentIntent.last_payment_error?.message}`)
      break
    }
  }

  return c.json({ received: true })
})

// GET /verify-payment/:sessionId — verify payment was successful
app.get('/verify-payment/:sessionId', requireStripe, async (c) => {
  const sessionId = c.req.param('sessionId')
  const session = await stripe.checkout.sessions.retrieve(sessionId)

  if (session.payment_status === 'paid') {
    return c.json({
      success: true,
      amount: session.amount_total / 100,
      invoiceId: session.metadata?.invoice_id,
      customerEmail: session.customer_email,
    })
  }

  return c.json({ success: false, status: session.payment_status })
})

// GET /payments/:invoiceId — payment history for invoice
app.get('/payments/:invoiceId', authenticate, requireStripe, async (c) => {
  const invoiceId = c.req.param('invoiceId')

  const rows = await db
    .select({ invoice: invoices, firstName: clients.firstName, lastName: clients.lastName })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, invoiceId))

  if (!rows.length) return c.json({ error: 'Invoice not found' }, 404)

  let stripePayment = null
  if (rows[0].invoice.stripePaymentIntentId) {
    try {
      stripePayment = await stripe.paymentIntents.retrieve(rows[0].invoice.stripePaymentIntentId)
    } catch {}
  }

  return c.json({ invoice: rows[0].invoice, stripePayment })
})

export default app
