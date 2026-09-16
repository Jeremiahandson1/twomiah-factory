/**
 * Stripe Payment Service + routes — ONE implementation for every CRM template, vendored into each
 * tenant at generation (../shared). The template's services/stripe.ts passes its Drizzle db + tables
 * and two options; routes/stripe.ts passes the service, auth middleware and audit. Behaviour is the
 * per-template code as it stood before consolidation (#151), moved verbatim — nothing here changes
 * what a request does. Fixes land on this one copy, each as its own commit and guard.
 *
 * Handles:
 * - Payment intents for invoices
 * - Customer creation/management
 * - Webhook processing
 * - Payment methods
 */

import { Hono } from 'hono'
import Stripe from 'stripe'
import { eq, and, sql } from 'drizzle-orm'

export interface StripeTables {
  contact: any
  invoice: any
  payment: any
  company: any
}

export interface StripeServiceOptions {
  /**
   * Which calendar an online booking lands on, for the late-deposit guard in the webhook: the trades
   * (contractor, field service, landscaping, events, RV) hold a `job`; salon and vet hold an
   * `appointment`. Selects which of the two (verbatim) SQL blocks runs.
   */
  bookingCalendarKind: 'job' | 'appointment'
  /**
   * Called after a webhook payment and after a Stripe refund is recorded on an invoice. Events
   * (crm-restaurant) moves the event invoice's due date here; other verticals pass nothing.
   */
  afterInvoicePayment?: (invoiceId: string) => Promise<void>
}

export interface StripeServiceDeps {
  db: any
  tables: StripeTables
  options: StripeServiceOptions
}

export function createStripeService(deps: StripeServiceDeps) {
  const { db, tables: { contact, invoice, payment, company }, options } = deps
  const afterInvoicePayment = options.afterInvoicePayment

  const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' as any })
    : null

  // ============================================
  // CUSTOMER MANAGEMENT
  // ============================================

  /**
   * Create or get Stripe customer for a contact
   */
  async function getOrCreateCustomer(contactRow: any) {
    if (contactRow.stripeCustomerId) {
      try {
        const customer = await stripe!.customers.retrieve(contactRow.stripeCustomerId)
        if (!(customer as any).deleted) {
          return customer
        }
      } catch {
        // Customer doesn't exist, create new one
      }
    }

    const customer = await stripe!.customers.create({
      email: contactRow.email,
      name: contactRow.name,
      phone: contactRow.phone,
      address: contactRow.address
        ? {
            line1: contactRow.address,
            city: contactRow.city,
            state: contactRow.state,
            postal_code: contactRow.zip,
            country: 'US',
          }
        : undefined,
      metadata: {
        contact_id: contactRow.id,
        company_id: contactRow.companyId,
      },
    })

    // Save Stripe customer ID to contact custom fields
    const [existing] = await db.select({ customFields: contact.customFields }).from(contact).where(eq(contact.id, contactRow.id))
    const fields = (existing?.customFields as any) || {}
    fields.stripeCustomerId = customer.id

    await db
      .update(contact)
      .set({ customFields: fields })
      .where(eq(contact.id, contactRow.id))

    return customer
  }

  /**
   * Update Stripe customer
   */
  async function updateCustomer(contactRow: any) {
    const fields = (contactRow.customFields as any) || {}
    if (!fields.stripeCustomerId) {
      return getOrCreateCustomer(contactRow)
    }

    return stripe!.customers.update(fields.stripeCustomerId, {
      email: contactRow.email,
      name: contactRow.name,
      phone: contactRow.phone,
    })
  }

  // ============================================
  // PAYMENT INTENTS
  // ============================================

  /**
   * Create payment intent for an invoice
   */
  async function createPaymentIntent(invoiceRow: any, contactRow: any) {
    const customer = await getOrCreateCustomer(contactRow)

    const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)
    const amount = Math.round(balance * 100)

    if (amount <= 0) {
      throw new Error('Invoice has no balance due')
    }

    const paymentIntent = await stripe!.paymentIntents.create({
      amount,
      currency: 'usd',
      customer: customer.id,
      description: `Invoice ${invoiceRow.number}`,
      metadata: {
        invoice_id: invoiceRow.id,
        invoice_number: invoiceRow.number,
        company_id: invoiceRow.companyId,
        contact_id: contactRow.id,
      },
      // Keep the card on file so recurring agreements can be charged later.
      setup_future_usage: 'off_session',
      automatic_payment_methods: { enabled: true },
    })

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
    }
  }

  /**
   * Create payment intent for partial payment
   */
  async function createPartialPaymentIntent(invoiceRow: any, contactRow: any, amount: number) {
    const customer = await getOrCreateCustomer(contactRow)

    const amountCents = Math.round(amount * 100)
    const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)
    const maxAmount = Math.round(balance * 100)

    if (amountCents <= 0) throw new Error('Amount must be greater than 0')
    if (amountCents > maxAmount) throw new Error('Amount exceeds invoice balance')

    const paymentIntent = await stripe!.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      customer: customer.id,
      description: `Partial payment - Invoice ${invoiceRow.number}`,
      metadata: {
        invoice_id: invoiceRow.id,
        invoice_number: invoiceRow.number,
        company_id: invoiceRow.companyId,
        contact_id: contactRow.id,
        partial_payment: 'true',
      },
      automatic_payment_methods: { enabled: true },
    })

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
    }
  }

  /**
   * Retrieve payment intent
   */
  async function getPaymentIntent(paymentIntentId: string) {
    return stripe!.paymentIntents.retrieve(paymentIntentId)
  }

  // ============================================
  // CHECKOUT SESSIONS
  // ============================================

  /**
   * Create checkout session for invoice payment
   */
  async function createCheckoutSession(
    invoiceRow: any,
    contactRow: any,
    { successUrl, cancelUrl }: { successUrl: string; cancelUrl: string }
  ) {
    const customer = await getOrCreateCustomer(contactRow)
    const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)

    const session = await stripe!.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice ${invoiceRow.number}`,
              description: invoiceRow.notes || `Payment for Invoice ${invoiceRow.number}`,
            },
            unit_amount: Math.round(balance * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        invoice_id: invoiceRow.id,
        invoice_number: invoiceRow.number,
        company_id: invoiceRow.companyId,
      },
    })

    return { sessionId: session.id, url: session.url }
  }

  // ============================================
  // WEBHOOK HANDLING
  // ============================================

  /**
   * Deposit for an online booking. Keyed by booking_id in metadata so the
   * webhook can confirm the booking when the card clears.
   */
  async function createBookingDepositIntent(params: {
    bookingId: string
    companyId: string
    amount: number
    contactRow: any
    description?: string
  }) {
    if (!stripe) throw new Error('Stripe is not configured')
    const customer = await getOrCreateCustomer(params.contactRow)

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(params.amount * 100),
      currency: 'usd',
      customer: customer.id,
      description: params.description || 'Booking deposit',
      automatic_payment_methods: { enabled: true },
      metadata: {
        booking_id: params.bookingId,
        company_id: params.companyId,
        contact_id: params.contactRow.id,
        kind: 'booking_deposit',
      },
    })

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    }
  }

  /**
   * Save a card for a customer without charging it (agreement autopay
   * enrolment). Nothing stored a payment method before, which is why automatic
   * billing could not exist.
   */
  async function createSetupIntent(contactRow: any) {
    if (!stripe) throw new Error('Stripe is not configured')
    const customer = await getOrCreateCustomer(contactRow)
    const intent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: 'off_session',
      metadata: { contact_id: contactRow.id, company_id: contactRow.companyId },
    })
    return {
      clientSecret: intent.client_secret,
      setupIntentId: intent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    }
  }

  /** Cards this customer has already given us. */
  async function listSavedPaymentMethods(contactRow: any) {
    if (!stripe) return []
    const fields = (contactRow.customFields as any) || {}
    const customerId = fields.stripeCustomerId
    if (!customerId) return []
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
    return methods.data.map((m) => ({
      id: m.id,
      brand: m.card?.brand,
      last4: m.card?.last4,
      expMonth: m.card?.exp_month,
      expYear: m.card?.exp_year,
    }))
  }

  /**
   * Charge an invoice against a stored card, with the customer not present.
   * The existing payment_intent.succeeded webhook records the payment — this
   * deliberately does not write a payment row itself, so a configured webhook
   * cannot double-count it.
   */
  async function chargeInvoiceOffSession(invoiceRow: any, contactRow: any, paymentMethodId: string) {
    if (!stripe) throw new Error('Stripe is not configured')
    const customer = await getOrCreateCustomer(contactRow)
    const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid || 0)
    const amount = Math.round(balance * 100)
    if (amount <= 0) throw new Error('Invoice has no balance due')

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      customer: customer.id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: `Invoice ${invoiceRow.number} (autopay)`,
      metadata: {
        invoice_id: invoiceRow.id,
        invoice_number: invoiceRow.number,
        company_id: invoiceRow.companyId,
        contact_id: contactRow.id,
        kind: 'agreement_autopay',
      },
    })

    return { paymentIntentId: intent.id, status: intent.status }
  }

  async function handleWebhook(event: Stripe.Event) {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return handlePaymentSuccess(event.data.object as Stripe.PaymentIntent)
      case 'payment_intent.payment_failed':
        return handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
      case 'checkout.session.completed':
        return handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
      default:
        console.log(`Unhandled Stripe event: ${event.type}`)
        return { handled: false }
    }
  }

  // The late-deposit guard, per calendar. Each block is the per-template SQL as it was; only the
  // calendar the booking lands on differs (job vs appointment).
  async function lateDepositSlotFree(bk: any): Promise<boolean> {
    let slotFree = false
    if (options.bookingCalendarKind === 'appointment') {
      if (bk.appointment_id) {
        const clash = await db.execute(sql`
          SELECT (a.start_time > NOW()) AS in_future,
            EXISTS (
              SELECT 1 FROM appointment x
              WHERE x.company_id = a.company_id AND x.id != a.id
                AND x.status NOT IN ('cancelled', 'no_show')
                AND x.start_time < a.end_time AND x.end_time > a.start_time
            ) AS taken
          FROM appointment a WHERE a.id = ${bk.appointment_id} LIMIT 1
        `)
        const c = (clash.rows?.[0] as any) || null
        slotFree = !!c && c.in_future === true && c.taken === false
      }
    } else {
      if (bk.job_id) {
        const clash = await db.execute(sql`
          SELECT (j.scheduled_date > NOW()) AS in_future,
            EXISTS (
              SELECT 1 FROM job x
              WHERE x.company_id = j.company_id AND x.id != j.id
                AND x.status != 'cancelled'
                AND x.scheduled_date IS NOT NULL
                AND x.scheduled_date < j.scheduled_date + (COALESCE(j.estimated_hours, 1) * interval '1 hour')
                AND x.scheduled_date + (COALESCE(x.estimated_hours, 1) * interval '1 hour') > j.scheduled_date
            ) AS taken
          FROM job j WHERE j.id = ${bk.job_id} LIMIT 1
        `)
        const c = (clash.rows?.[0] as any) || null
        slotFree = !!c && c.in_future === true && c.taken === false
      }
    }
    return slotFree
  }

  /**
   * Handle successful payment
   */
  async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
    const { invoice_id, booking_id } = paymentIntent.metadata

    // Booking deposit: confirm the booking — with the late-payment guard.
    if (booking_id) {
      const paidAmount = paymentIntent.amount / 100
      const found = options.bookingCalendarKind === 'appointment'
        ? await db.execute(sql`
          SELECT status, deposit_status, appointment_id FROM online_booking WHERE id = ${booking_id} LIMIT 1
        `)
        : await db.execute(sql`
          SELECT status, deposit_status, job_id FROM online_booking WHERE id = ${booking_id} LIMIT 1
        `)
      const bk = (found.rows?.[0] as any) || null
      if (!bk) {
        console.warn('[Stripe] Deposit paid for an unknown booking:', booking_id)
        return { handled: false }
      }

      // A payment can land AFTER the hold expired and the slot was released.
      // Resurrect only when the exact window is still clear and in the future —
      // otherwise refund, so nobody pays for a slot that no longer exists.
      if (bk.status === 'cancelled' || bk.deposit_status === 'expired') {
        const slotFree = await lateDepositSlotFree(bk)
        if (!slotFree) {
          try {
            await stripe!.refunds.create({ payment_intent: paymentIntent.id })
          } catch (err: any) {
            // A Stripe retry of this webhook hits an already-refunded intent —
            // that is success, not failure. Anything else must surface so the
            // delivery fails and Stripe retries.
            if (!/already.*refund/i.test(err?.message || '')) throw err
          }
          await db.execute(sql`UPDATE online_booking SET deposit_status = 'refunded', updated_at = NOW() WHERE id = ${booking_id}`)
          console.log('[Stripe] Late deposit on an expired hold — auto-refunded:', booking_id, paidAmount)
          return { handled: true, booking_id, refunded: true }
        }
        if (options.bookingCalendarKind === 'appointment') {
          await db.execute(sql`UPDATE appointment SET status = 'scheduled', updated_at = NOW() WHERE id = ${bk.appointment_id}`)
        } else {
          await db.execute(sql`UPDATE job SET status = 'scheduled', updated_at = NOW() WHERE id = ${bk.job_id}`)
        }
        console.log('[Stripe] Late deposit but the slot is still free — booking resurrected:', booking_id)
      }

      await db.execute(sql`
        UPDATE online_booking
        SET deposit_status = 'paid', deposit_paid_at = NOW(), status = 'confirmed', updated_at = NOW()
        WHERE id = ${booking_id}
      `)
      console.log('[Stripe] Booking deposit paid:', booking_id, paidAmount)
      return { handled: true, booking_id }
    }

    if (!invoice_id) {
      console.log('Payment without invoice metadata:', paymentIntent.id)
      return { handled: false }
    }

    const [invoiceRow] = await db.select().from(invoice).where(eq(invoice.id, invoice_id))

    if (!invoiceRow) {
      console.error(`Invoice not found: ${invoice_id}`)
      return { handled: false, error: 'Invoice not found' }
    }

    const amount = paymentIntent.amount / 100

    // Create payment record
    const [paymentRow] = await db
      .insert(payment)
      .values({
        invoiceId: invoiceRow.id,
        amount: String(amount),
        method: 'card',
        reference: paymentIntent.id,
        paidAt: new Date(),
        notes: `Stripe payment - ${paymentIntent.payment_method_types?.join(', ') || 'card'}`,
      })
      .returning()

    // Update invoice
    const newAmountPaid = Number(invoiceRow.amountPaid) + amount
    const newBalance = Number(invoiceRow.total) - newAmountPaid
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'

    await db
      .update(invoice)
      .set({
        amountPaid: String(newAmountPaid),
        status: newStatus,
        ...(newStatus === 'paid' ? { paidAt: new Date() } : {}),
      })
      .where(eq(invoice.id, invoiceRow.id))

    if (afterInvoicePayment) await afterInvoicePayment(invoiceRow.id).catch((err) => console.error('[events] invoice due-date sync failed', err))

    return {
      handled: true,
      paymentId: paymentRow.id,
      invoiceId: invoiceRow.id,
      amount,
      newStatus,
    }
  }

  /**
   * Handle failed payment
   */
  async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const { invoice_id } = paymentIntent.metadata
    if (invoice_id) {
      console.log(`Payment failed for invoice ${invoice_id}:`, paymentIntent.last_payment_error?.message)
    }
    return { handled: true, failed: true }
  }

  /**
   * Handle checkout session complete
   */
  async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
    console.log('Checkout completed:', session.id)
    return { handled: true }
  }

  // ============================================
  // PAYMENT LINKS
  // ============================================

  /**
   * Create a payment link for an invoice
   */
  async function createPaymentLink(invoiceRow: any) {
    const balance = Number(invoiceRow.total) - Number(invoiceRow.amountPaid)

    const product = await stripe!.products.create({
      name: `Invoice ${invoiceRow.number}`,
    })

    const price = await stripe!.prices.create({
      product: product.id,
      unit_amount: Math.round(balance * 100),
      currency: 'usd',
    })

    const paymentLink = await stripe!.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoice_id: invoiceRow.id,
        invoice_number: invoiceRow.number,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL}/portal/payment-success?invoice=${invoiceRow.number}`,
        },
      },
    })

    // Save payment link (store in notes or a custom field since schema has no stripePaymentLink column)
    await db
      .update(invoice)
      .set({ notes: sql`coalesce(${invoice.notes}, '') || E'\nPayment link: ' || ${paymentLink.url}` })
      .where(eq(invoice.id, invoiceRow.id))

    return { url: paymentLink.url, id: paymentLink.id }
  }

  // ============================================
  // REFUNDS
  // ============================================

  /**
   * Create refund for a payment
   */
  async function createRefund(paymentRow: any, amount: number | null = null) {
    if (!paymentRow.reference) {
      throw new Error('Payment was not made through Stripe')
    }

    const refund = await stripe!.refunds.create({
      payment_intent: paymentRow.reference,
      amount: amount ? Math.round(amount * 100) : undefined,
    })

    // Update invoice balance
    const [invoiceRow] = await db.select().from(invoice).where(eq(invoice.id, paymentRow.invoiceId))
    const refundAmount = refund.amount / 100

    // Same model as a manual refund: a negative ledger row, amountRefunded goes up, amountPaid stays
    // gross, and only a full refund changes the status. The sale is never reopened as a balance due.
    const paid = Number(invoiceRow.amountPaid || 0)
    const newRefunded = Math.round((Number((invoiceRow as any).amountRefunded || 0) + refundAmount) * 100) / 100
    await db.insert(payment).values({ invoiceId: paymentRow.invoiceId, amount: (-refundAmount).toString(), method: 'stripe', reference: refund.id, notes: 'Stripe refund' } as any)
    await db
      .update(invoice)
      .set({ amountRefunded: String(newRefunded), status: newRefunded >= paid - 0.005 ? 'refunded' : invoiceRow.status, updatedAt: new Date() } as any)
      .where(eq(invoice.id, paymentRow.invoiceId))

    if (afterInvoicePayment) await afterInvoicePayment(paymentRow.invoiceId).catch((err) => console.error('[events] invoice due-date sync failed', err))

    return refund
  }

  // ============================================
  // CONNECT (for marketplace/platform)
  // ============================================

  /**
   * Create Stripe Connect account for a company
   */
  async function createConnectAccount(companyRow: any) {
    const account = await stripe!.accounts.create({
      type: 'express',
      country: 'US',
      email: companyRow.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'company',
      company: { name: companyRow.name },
      metadata: { company_id: companyRow.id },
    })

    // Save in company settings
    const [existing] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyRow.id))
    const settings = (existing?.settings as any) || {}
    settings.stripeAccountId = account.id

    await db.update(company).set({ settings }).where(eq(company.id, companyRow.id))

    return account
  }

  /**
   * Create account link for onboarding
   */
  async function createAccountLink(companyRow: any) {
    const settings = (companyRow.settings as any) || {}
    if (!settings.stripeAccountId) {
      await createConnectAccount(companyRow)
    }

    const accountLink = await stripe!.accountLinks.create({
      account: settings.stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL}/settings/payments?refresh=true`,
      return_url: `${process.env.FRONTEND_URL}/settings/payments?success=true`,
      type: 'account_onboarding',
    })

    return accountLink
  }

  /**
   * Get Connect account status
   */
  async function getAccountStatus(stripeAccountId: string) {
    const account = await stripe!.accounts.retrieve(stripeAccountId)

    return {
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      requirements: account.requirements,
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Verify webhook signature
   */
  // Bun serves requests on WebCrypto, whose signature check is async-only —
  // Stripe's sync constructEvent() throws SubtleCryptoProvider errors here.
  async function constructWebhookEvent(payload: string | Buffer, signature: string) {
    return await stripe!.webhooks.constructEventAsync(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!)
  }

  /**
   * Get Stripe publishable key (for frontend)
   */
  function getPublishableKey(): string | undefined {
    return process.env.STRIPE_PUBLISHABLE_KEY
  }

  return {
    getOrCreateCustomer,
    updateCustomer,
    createPaymentIntent,
    createPartialPaymentIntent,
    getPaymentIntent,
    createCheckoutSession,
    handleWebhook,
    createPaymentLink,
    createRefund,
    createConnectAccount,
    createAccountLink,
    getAccountStatus,
    constructWebhookEvent,
    getPublishableKey,
    // every named export is also reachable from the default import — routes call stripeService.<fn>()
    createBookingDepositIntent,
    createSetupIntent,
    listSavedPaymentMethods,
    chargeInvoiceOffSession,
  }
}

export type StripeService = ReturnType<typeof createStripeService>

// ============================================
// ROUTES
// ============================================

export interface StripeRoutesDeps {
  db: any
  tables: StripeTables
  stripeService: StripeService
  authenticate: any
  requirePermission: (permission: string) => any
  /** The template's audit service (log + ACTIONS). */
  audit: any
}

export function createStripeRoutes(deps: StripeRoutesDeps) {
  const { db, tables: { invoice, contact, payment, company }, stripeService, authenticate, requirePermission, audit } = deps
  const app = new Hono()

  // ============================================
  // WEBHOOK (no auth - called by Stripe)
  // ============================================

  app.post('/webhook', async (c) => {
    // Stripe signs the RAW body; parsing it first (as this file once did) can never verify. No secret → 503, not a 500.
    if (!process.env.STRIPE_WEBHOOK_SECRET) return c.json({ error: 'Stripe webhook secret not configured' }, 503)
    const signature = c.req.header('stripe-signature')
    if (!signature) return c.json({ error: 'Missing stripe-signature header' }, 400)
    const rawBody = await c.req.text()

    let event
    try {
      event = await stripeService.constructWebhookEvent(rawBody, signature)
    } catch (err: any) {
      return c.json({ error: 'Invalid Stripe signature' }, 400)
    }
    const result = await stripeService.handleWebhook(event)

    console.log(`Stripe webhook ${event.type}:`, result)
    return c.json({ received: true, ...result })
  })

  // All other routes require authentication — except the customer-portal ones, which carry the portal token in
  // the body and are called by customers who have no login.
  app.use('*', async (c, next) => (c.req.path.includes('/portal/') ? next() : authenticate(c, next)))

  // ============================================
  // CONFIG
  // ============================================

  // Get publishable key for frontend
  app.get('/config', async (c) => {
    return c.json({
      publishableKey: stripeService.getPublishableKey(),
    })
  })

  // ============================================
  // PAYMENT INTENTS
  // ============================================

  // Create payment intent for invoice
  app.post('/payment-intent', requirePermission('invoices:read'), async (c) => {
    const user = c.get('user') as any
    const { invoiceId, amount } = await c.req.json()

    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId))).limit(1)

    if (!inv) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    const [contactRow] = inv.contactId
      ? await db.select().from(contact).where(eq(contact.id, inv.contactId)).limit(1)
      : [null]

    if (!contactRow) {
      return c.json({ error: 'Invoice has no contact' }, 400)
    }

    let result
    if (amount && amount < Number(inv.balance)) {
      result = await stripeService.createPartialPaymentIntent(inv, contactRow, amount)
    } else {
      result = await stripeService.createPaymentIntent(inv, contactRow)
    }

    return c.json(result)
  })

  // Get payment intent status
  app.get('/payment-intent/:id', async (c) => {
    const paymentIntent = await stripeService.getPaymentIntent(c.req.param('id'))
    return c.json({
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    })
  })

  // ============================================
  // CHECKOUT SESSIONS
  // ============================================

  // Create checkout session
  app.post('/checkout-session', requirePermission('invoices:read'), async (c) => {
    const user = c.get('user') as any
    const { invoiceId } = await c.req.json()

    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId))).limit(1)

    if (!inv) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    const [contactRow] = inv.contactId
      ? await db.select().from(contact).where(eq(contact.id, inv.contactId)).limit(1)
      : [null]

    const result = await stripeService.createCheckoutSession(inv, contactRow, {
      successUrl: `${process.env.FRONTEND_URL}/invoices/${inv.id}?payment=success`,
      cancelUrl: `${process.env.FRONTEND_URL}/invoices/${inv.id}?payment=cancelled`,
    })

    return c.json(result)
  })

  // ============================================
  // PAYMENT LINKS
  // ============================================

  // Create payment link for invoice
  app.post('/payment-link', requirePermission('invoices:update'), async (c) => {
    const user = c.get('user') as any
    const { invoiceId } = await c.req.json()

    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId))).limit(1)

    if (!inv) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    if (Number(inv.balance) <= 0) {
      return c.json({ error: 'Invoice has no balance due' }, 400)
    }

    const result = await stripeService.createPaymentLink(inv)

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'payment_link',
      entityId: inv.id,
      entityName: inv.number,
      req: c.req,
    })

    return c.json(result)
  })

  // ============================================
  // REFUNDS
  // ============================================

  // Create refund
  app.post('/refund', requirePermission('payments:delete'), async (c) => {
    const user = c.get('user') as any
    const { paymentId, amount } = await c.req.json()

    const [pay] = await db.select().from(payment).where(eq(payment.id, paymentId)).limit(1)

    if (!pay) {
      return c.json({ error: 'Payment not found' }, 404)
    }

    // Verify company ownership
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, pay.invoiceId), eq(invoice.companyId, user.companyId))).limit(1)

    if (!inv) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    if (!pay.stripePaymentIntentId) {
      return c.json({ error: 'Payment was not made through Stripe' }, 400)
    }

    const refund = await stripeService.createRefund(pay, amount)

    audit.log({
      action: 'REFUND',
      entity: 'payment',
      entityId: pay.id,
      metadata: { amount: refund.amount / 100, invoiceId: inv.id },
      req: c.req,
    })

    return c.json({
      success: true,
      refundId: refund.id,
      amount: refund.amount / 100,
    })
  })

  // ============================================
  // CONNECT (Platform Features)
  // ============================================

  // Get account status
  app.get('/account-status', requirePermission('settings:read'), async (c) => {
    const user = c.get('user') as any

    const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)

    if (!(comp as any).stripeAccountId) {
      return c.json({ connected: false })
    }

    const status = await stripeService.getAccountStatus((comp as any).stripeAccountId)
    return c.json({ connected: true, ...status })
  })

  // Create/get onboarding link
  app.post('/onboarding', requirePermission('settings:update'), async (c) => {
    const user = c.get('user') as any

    const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)

    const accountLink = await stripeService.createAccountLink(comp)
    return c.json({ url: accountLink.url })
  })

  // ============================================
  // PORTAL PAYMENTS (Public with token)
  // ============================================

  // Create payment intent for portal
  app.post('/portal/payment-intent', async (c) => {
    const { invoiceId, portalToken, amount } = await c.req.json()

    // Verify portal access
    const [contactRow] = await db.select().from(contact).where(and(eq(contact.portalToken, portalToken), eq(contact.portalEnabled, true))).limit(1)

    if (!contactRow) {
      return c.json({ error: 'Invalid portal access' }, 401)
    }

    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.contactId, contactRow.id))).limit(1)

    if (!inv) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    let result
    if (amount && amount < Number(inv.balance)) {
      result = await stripeService.createPartialPaymentIntent(inv, contactRow, amount)
    } else {
      result = await stripeService.createPaymentIntent(inv, contactRow)
    }

    return c.json(result)
  })

  // ── Saved cards ────────────────────────────────────────────────────────────
  // Same portal-token check as /portal/payment-intent above.
  async function contactForPortalToken(portalToken: string) {
    if (!portalToken) return null
    const [contactRow] = await db.select().from(contact)
      .where(and(eq(contact.portalToken, portalToken), eq(contact.portalEnabled, true)))
      .limit(1)
    return contactRow || null
  }

  // Start saving a card without charging it.
  app.post('/portal/setup-intent', async (c) => {
    const { portalToken } = await c.req.json()
    const contactRow = await contactForPortalToken(portalToken)
    if (!contactRow) return c.json({ error: 'Invalid portal access' }, 401)
    try {
      return c.json(await stripeService.createSetupIntent(contactRow))
    } catch (err: any) {
      return c.json({ error: err?.message || 'Card setup is unavailable' }, 400)
    }
  })

  // Cards this customer already has on file.
  app.post('/portal/payment-methods', async (c) => {
    const { portalToken } = await c.req.json()
    const contactRow = await contactForPortalToken(portalToken)
    if (!contactRow) return c.json({ error: 'Invalid portal access' }, 401)
    return c.json({ data: await stripeService.listSavedPaymentMethods(contactRow) })
  })

  // Owner-side: which cards does this contact have? Drives the autopay toggle.
  app.get('/payment-methods/:contactId', requirePermission('invoices:read'), async (c) => {
    const user = c.get('user') as any
    const [contactRow] = await db.select().from(contact)
      .where(and(eq(contact.id, c.req.param('contactId')), eq(contact.companyId, user.companyId)))
      .limit(1)
    if (!contactRow) return c.json({ error: 'Contact not found' }, 404)
    return c.json({ data: await stripeService.listSavedPaymentMethods(contactRow) })
  })

  return app
}
