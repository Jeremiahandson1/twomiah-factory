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
import { recordInvoicePayment, recordInvoiceRefund } from '../invoicing/invoices'
import { round2, invoiceBalance } from '../invoicing/money'

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
  // CONNECTED ACCOUNT
  // ============================================

  /**
   * A business that clicked "Connect Stripe" (Settings → Integrations) takes payments on its own
   * connected account — the id the shared integrations module stores in
   * company.integrations.stripeAccountId. Every Stripe call about that business's money carries it,
   * so the charge lands in their Stripe account, not the platform's. A business on its own keys has
   * no connected account and its calls carry nothing (byte-identical to before #154).
   */
  async function connectedAccountFor(companyId: string | null | undefined): Promise<string | null> {
    if (!companyId) return null
    const [row] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)
    const acct = (row?.integrations as any)?.stripeAccountId
    return typeof acct === 'string' && acct ? acct : null
  }
  const requestOpts = (stripeAccount: string | null | undefined) => (stripeAccount ? { stripeAccount } : undefined)

  /**
   * What the customer still owes on an invoice — the refund model every other path uses
   * (invoicing/money.ts invoiceBalance): a refunded deposit reopens the balance, a fully paid sale
   * owes nothing even after a partial refund, void owes nothing. The five charge paths once used
   * total − amountPaid, which charged a reopened balance short and a settled sale again. (#157)
   */
  const invoiceOwed = (invoiceRow: any) => invoiceBalance(invoiceRow)

  // ============================================
  // CUSTOMER MANAGEMENT
  // ============================================

  /**
   * Create or get Stripe customer for a contact.
   * The id lives in customFields (that is where it is saved below — the old check read a
   * contactRow.stripeCustomerId column that does not exist, so every payment created a new customer
   * and orphaned the cards saved on the last one). A customer belongs to the Stripe account it was
   * created on, so an id saved under a different account is treated as absent.
   */
  async function getOrCreateCustomer(contactRow: any, stripeAccount: string | null = null) {
    const saved = (contactRow.customFields as any) || {}
    const savedAccount = (saved.stripeCustomerAccount as string | null) || null
    if (saved.stripeCustomerId && savedAccount === (stripeAccount || null)) {
      try {
        const customer = await stripe!.customers.retrieve(saved.stripeCustomerId, requestOpts(stripeAccount))
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
    }, requestOpts(stripeAccount))

    // Save Stripe customer ID to contact custom fields (with the account it belongs to)
    const [existing] = await db.select({ customFields: contact.customFields }).from(contact).where(eq(contact.id, contactRow.id))
    const fields = (existing?.customFields as any) || {}
    fields.stripeCustomerId = customer.id
    fields.stripeCustomerAccount = stripeAccount || null

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
    const stripeAccount = await connectedAccountFor(contactRow.companyId)
    const fields = (contactRow.customFields as any) || {}
    if (!fields.stripeCustomerId || ((fields.stripeCustomerAccount as string | null) || null) !== (stripeAccount || null)) {
      return getOrCreateCustomer(contactRow, stripeAccount)
    }

    return stripe!.customers.update(fields.stripeCustomerId, {
      email: contactRow.email,
      name: contactRow.name,
      phone: contactRow.phone,
    }, requestOpts(stripeAccount))
  }

  // ============================================
  // PAYMENT INTENTS
  // ============================================

  /**
   * Create payment intent for an invoice
   */
  async function createPaymentIntent(invoiceRow: any, contactRow: any) {
    const stripeAccount = await connectedAccountFor(invoiceRow.companyId)
    const customer = await getOrCreateCustomer(contactRow, stripeAccount)

    const balance = invoiceOwed(invoiceRow)
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
    }, requestOpts(stripeAccount))

    // publishableKey: what the browser initialises Stripe.js with. The portal's payment form refused to
    // render without it ("Card payments are not set up yet") — the booking-deposit and setup-intent
    // responses already carried it; the invoice path never did. (#153) stripeAccount: the connected
    // account Stripe.js must be initialised with, null on a business's own keys. (#154)
    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      stripeAccount,
    }
  }

  /**
   * Create payment intent for partial payment
   */
  async function createPartialPaymentIntent(invoiceRow: any, contactRow: any, amount: number) {
    const stripeAccount = await connectedAccountFor(invoiceRow.companyId)
    const customer = await getOrCreateCustomer(contactRow, stripeAccount)

    const amountCents = Math.round(amount * 100)
    const balance = invoiceOwed(invoiceRow)
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
    }, requestOpts(stripeAccount))

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      stripeAccount,
    }
  }

  /**
   * Retrieve payment intent
   */
  async function getPaymentIntent(paymentIntentId: string, stripeAccount: string | null = null) {
    return stripe!.paymentIntents.retrieve(paymentIntentId, requestOpts(stripeAccount))
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
    const stripeAccount = await connectedAccountFor(invoiceRow.companyId)
    const customer = await getOrCreateCustomer(contactRow, stripeAccount)
    const balance = invoiceOwed(invoiceRow)
    if (Math.round(balance * 100) <= 0) throw new Error('Invoice has no balance due')

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
      // The customer's payment is a PaymentIntent Stripe creates for the session; it is what
      // payment_intent.succeeded delivers, and it only knows the invoice if told here. Session
      // metadata alone left every Checkout payment unrecorded. (#157)
      payment_intent_data: {
        metadata: {
          invoice_id: invoiceRow.id,
          invoice_number: invoiceRow.number,
          company_id: invoiceRow.companyId,
          kind: 'checkout',
        },
      },
    }, requestOpts(stripeAccount))

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
    const stripeAccount = await connectedAccountFor(params.companyId)
    const customer = await getOrCreateCustomer(params.contactRow, stripeAccount)

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
    }, requestOpts(stripeAccount))

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      stripeAccount,
    }
  }

  /**
   * Save a card for a customer without charging it (agreement autopay
   * enrolment). Nothing stored a payment method before, which is why automatic
   * billing could not exist.
   */
  async function createSetupIntent(contactRow: any) {
    if (!stripe) throw new Error('Stripe is not configured')
    const stripeAccount = await connectedAccountFor(contactRow.companyId)
    const customer = await getOrCreateCustomer(contactRow, stripeAccount)
    const intent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: 'off_session',
      metadata: { contact_id: contactRow.id, company_id: contactRow.companyId },
    }, requestOpts(stripeAccount))
    return {
      clientSecret: intent.client_secret,
      setupIntentId: intent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      stripeAccount,
    }
  }

  /** Cards this customer has already given us (on the account the customer was created on). */
  async function listSavedPaymentMethods(contactRow: any) {
    if (!stripe) return []
    const fields = (contactRow.customFields as any) || {}
    const customerId = fields.stripeCustomerId
    if (!customerId) return []
    const stripeAccount = await connectedAccountFor(contactRow.companyId)
    if (((fields.stripeCustomerAccount as string | null) || null) !== (stripeAccount || null)) return []
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' }, requestOpts(stripeAccount))
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
    const stripeAccount = await connectedAccountFor(invoiceRow.companyId)
    const customer = await getOrCreateCustomer(contactRow, stripeAccount)
    const balance = invoiceOwed(invoiceRow)
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
    }, requestOpts(stripeAccount))

    return { paymentIntentId: intent.id, status: intent.status }
  }

  async function handleWebhook(event: Stripe.Event) {
    // A connected-account event carries the account it happened on; anything we do back to Stripe for
    // it (the late-deposit refund) must be scoped to that account.
    const stripeAccount = ((event as any).account as string | undefined) || null
    switch (event.type) {
      case 'payment_intent.succeeded':
        return handlePaymentSuccess(event.data.object as Stripe.PaymentIntent, stripeAccount)
      case 'payment_intent.payment_failed':
        return handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
      case 'checkout.session.completed':
        return handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
      case 'charge.refunded':
        return handleChargeRefunded(event.data.object as Stripe.Charge, stripeAccount)
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
  async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent, stripeAccount: string | null = null) {
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
      let resurrected = false
      if (bk.status === 'cancelled' || bk.deposit_status === 'expired') {
        const slotFree = await lateDepositSlotFree(bk)
        if (!slotFree) {
          try {
            await stripe!.refunds.create({ payment_intent: paymentIntent.id }, requestOpts(stripeAccount))
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
        resurrected = true
        console.log('[Stripe] Late deposit but the slot is still free — booking resurrected:', booking_id)
      }

      await db.execute(sql`
        UPDATE online_booking
        SET deposit_status = 'paid', deposit_paid_at = NOW(), status = 'confirmed', updated_at = NOW()
        WHERE id = ${booking_id}
      `)
      // The trades hold a deposit-required booking's job as 'pending' (jobCalendar.create). A confirmed
      // booking is a scheduled job — the same mapping the owner's manual confirm uses
      // (jobCalendar.setStatus 'confirmed' → 'scheduled') — guarded so a job the owner already moved on
      // is never reset. A resurrected booking's job was just set above. Appointment calendars create
      // the appointment scheduled from the start and are left alone. (#158)
      if (options.bookingCalendarKind === 'job' && !resurrected && bk.job_id) {
        await db.execute(sql`UPDATE job SET status = 'scheduled', updated_at = NOW() WHERE id = ${bk.job_id} AND status = 'pending'`)
      }
      console.log('[Stripe] Booking deposit paid:', booking_id, paidAmount)
      return { handled: true, booking_id }
    }

    if (!invoice_id) {
      console.log('Payment without invoice metadata:', paymentIntent.id)
      return { handled: false }
    }

    const amount = round2(paymentIntent.amount / 100)

    // Recorded through the same locked, refund-aware write as POST /api/invoices/:id/payments — once per
    // PaymentIntent (Stripe retries deliveries), at Stripe's timestamp, and for what Stripe actually
    // collected even if that is above the balance (the model settles paid > total at $0). A void or
    // refunded invoice is refused like an interactive payment: the money was still taken, so it is
    // logged for a person to refund or re-invoice. (#155)
    const outcome = await recordInvoicePayment(db, { invoice, payment }, false, {
      invoiceId: invoice_id,
      amount,
      method: 'card',
      reference: paymentIntent.id,
      notes: `Stripe payment - ${paymentIntent.payment_method_types?.join(', ') || 'card'}`,
      paidAt: paymentIntent.created ? new Date(paymentIntent.created * 1000) : new Date(),
      allowOverpayment: true,
      idempotentByReference: true,
    })

    if (!outcome.ok) {
      console.error(`[Stripe] Payment ${paymentIntent.id} for invoice ${invoice_id} NOT recorded: ${outcome.error}`)
      return { handled: false, error: outcome.error, invoiceId: invoice_id, paymentIntentId: paymentIntent.id }
    }
    if (outcome.duplicate) {
      console.log(`[Stripe] Payment ${paymentIntent.id} already recorded on invoice ${invoice_id} — retry ignored`)
      return { handled: true, duplicate: true, paymentId: outcome.payment.id, invoiceId: invoice_id, amount, newStatus: outcome.newStatus }
    }

    if (afterInvoicePayment) await afterInvoicePayment(invoice_id).catch((err) => console.error('[events] invoice due-date sync failed', err))

    return {
      handled: true,
      paymentId: outcome.payment.id,
      invoiceId: invoice_id,
      amount,
      newStatus: outcome.newStatus,
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
  // Informational only: the money is recorded by payment_intent.succeeded for the PaymentIntent the
  // session created (it carries the invoice via payment_intent_data — #157). Recording here as well
  // would count the same payment twice.
  async function handleCheckoutComplete(session: Stripe.Checkout.Session) {
    console.log('Checkout completed:', session.id)
    return { handled: true }
  }

  /**
   * A refund issued anywhere — the Stripe dashboard, this CRM's own refund call — arrives here as
   * charge.refunded carrying the charge's cumulative refund total. The refunds themselves are listed
   * from Stripe (charge.refunds is not included by default on this API version) and each one is
   * recorded on the invoice once, by refund id, through the shared refund core — so a refund this CRM
   * issued itself is not counted twice and a retried delivery writes nothing. A charge with no invoice
   * payment behind it (a booking deposit auto-refunded on an expired hold) is not an error. (#156)
   */
  async function handleChargeRefunded(charge: Stripe.Charge, stripeAccount: string | null = null) {
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
    if (!paymentIntentId) {
      console.log('[Stripe] Refund on a charge without a PaymentIntent:', charge.id)
      return { handled: false }
    }
    const [paymentRow] = await db.select().from(payment).where(and(eq(payment.reference, paymentIntentId), sql`${payment.amount}::numeric > 0`)).limit(1)
    if (!paymentRow) {
      console.log('[Stripe] Refund on a charge with no invoice payment behind it:', charge.id, paymentIntentId)
      return { handled: false, paymentIntentId }
    }
    const listed = await stripe!.refunds.list({ payment_intent: paymentIntentId, limit: 100 }, requestOpts(stripeAccount))
    let recorded = 0
    let duplicates = 0
    const errors: string[] = []
    for (const refund of listed.data) {
      // Money that never went back is not a refund; pending card refunds settle on their own.
      if (refund.status === 'failed' || refund.status === 'canceled') continue
      const outcome = await recordStripeRefund(refund, paymentRow)
      if (!outcome.ok) {
        console.error(`[Stripe] Refund ${refund.id} on invoice ${paymentRow.invoiceId} NOT recorded: ${outcome.error}`)
        errors.push(`${refund.id}: ${outcome.error}`)
        continue
      }
      if (outcome.duplicate) duplicates++
      else recorded++
    }
    if (recorded > 0 && afterInvoicePayment) await afterInvoicePayment(paymentRow.invoiceId).catch((err) => console.error('[events] invoice due-date sync failed', err))
    return { handled: true, invoiceId: paymentRow.invoiceId, paymentIntentId, recorded, duplicates, ...(errors.length ? { errors } : {}) }
  }

  // ============================================
  // PAYMENT LINKS
  // ============================================

  /**
   * Create a payment link for an invoice
   */
  async function createPaymentLink(invoiceRow: any) {
    const stripeAccount = await connectedAccountFor(invoiceRow.companyId)
    const balance = invoiceOwed(invoiceRow)
    if (Math.round(balance * 100) <= 0) throw new Error('Invoice has no balance due')

    const product = await stripe!.products.create({
      name: `Invoice ${invoiceRow.number}`,
    }, requestOpts(stripeAccount))

    const price = await stripe!.prices.create({
      product: product.id,
      unit_amount: Math.round(balance * 100),
      currency: 'usd',
    }, requestOpts(stripeAccount))

    const paymentLink = await stripe!.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        invoice_id: invoiceRow.id,
        invoice_number: invoiceRow.number,
      },
      // Same as Checkout: the PaymentIntent behind a link payment must carry the invoice, or the
      // payment_intent.succeeded delivery has nothing to record it on. (#157)
      payment_intent_data: {
        metadata: {
          invoice_id: invoiceRow.id,
          invoice_number: invoiceRow.number,
          company_id: invoiceRow.companyId,
          kind: 'payment_link',
        },
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL}/portal/payment-success?invoice=${invoiceRow.number}`,
        },
      },
    }, requestOpts(stripeAccount))

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

  /** A payment row this CRM recorded from Stripe: a positive amount referencing the PaymentIntent. */
  const isStripePayment = (paymentRow: any) =>
    typeof paymentRow?.reference === 'string' && paymentRow.reference.startsWith('pi_') && Number(paymentRow.amount) > 0

  /**
   * Record one Stripe Refund on the invoice its payment belongs to — the same negative ledger row,
   * amountRefunded and recomputeStatus as a refund typed in by hand (so a refunded deposit reopens the
   * balance and only a fully returned sale reads 'refunded'), dated at Stripe's timestamp, refunded the
   * way the money came in, once per refund id.
   */
  async function recordStripeRefund(refund: Stripe.Refund, paymentRow: any) {
    return recordInvoiceRefund(db, { invoice, payment }, {
      invoiceId: paymentRow.invoiceId,
      amount: round2(refund.amount / 100),
      method: paymentRow.method || 'card',
      reference: refund.id,
      notes: refund.reason ? `Stripe refund (${String(refund.reason).replace(/_/g, ' ')})` : 'Stripe refund',
      paidAt: refund.created ? new Date(refund.created * 1000) : new Date(),
      idempotentByReference: true,
    })
  }

  /**
   * Refund (part of) a Stripe payment: issued on Stripe, scoped to the account the payment was taken
   * on, then recorded on the invoice through the shared refund core. The ledger is checked BEFORE
   * Stripe is asked, so a refund the invoice cannot take is never issued; a write refused after Stripe
   * already refunded (a payment landing in between) is logged and the charge.refunded delivery records
   * it — the refund id makes that idempotent. `amount` null = the whole payment. (#156)
   */
  async function createRefund(paymentRow: any, amount: number | null = null): Promise<
    | { ok: true; refund: Stripe.Refund; invoice: any; recorded: boolean; duplicate: boolean }
    | { ok: false; status: 400 | 404; error: string }
  > {
    if (!isStripePayment(paymentRow)) return { ok: false, status: 400, error: 'Payment was not made through Stripe' }

    // The invoice is read first so the refund can be scoped to the account the payment was taken on.
    const [invoiceRow] = await db.select().from(invoice).where(eq(invoice.id, paymentRow.invoiceId)).limit(1)
    if (!invoiceRow) return { ok: false, status: 404, error: 'Invoice not found' }
    const collected = round2(Number(paymentRow.amount))
    const requested = amount == null ? collected : round2(Number(amount))
    if (!(requested > 0)) return { ok: false, status: 400, error: 'Refund amount must be at least $0.01' }
    if (requested > collected + 0.005) return { ok: false, status: 400, error: `Refund exceeds this payment — $${collected.toFixed(2)} was collected on it.` }
    const net = round2(Number(invoiceRow.amountPaid || 0) - Number(invoiceRow.amountRefunded || 0))
    if (net <= 0.005) return { ok: false, status: 400, error: 'Everything collected on this invoice has already been refunded.' }
    if (requested > net + 0.005) return { ok: false, status: 400, error: `Refund exceeds what was collected — $${net.toFixed(2)} still refundable on this invoice.` }

    const stripeAccount = await connectedAccountFor(invoiceRow.companyId)
    const refund = await stripe!.refunds.create({
      payment_intent: paymentRow.reference,
      amount: Math.round(requested * 100),
    }, requestOpts(stripeAccount))

    const outcome = await recordStripeRefund(refund, paymentRow)
    if (!outcome.ok) {
      console.error(`[Stripe] Refund ${refund.id} on invoice ${paymentRow.invoiceId} issued but NOT recorded: ${outcome.error}`)
      return { ok: true, refund, invoice: null, recorded: false, duplicate: false }
    }
    if (!outcome.duplicate && afterInvoicePayment) await afterInvoicePayment(paymentRow.invoiceId).catch((err) => console.error('[events] invoice due-date sync failed', err))

    return { ok: true, refund, invoice: outcome.invoice, recorded: !outcome.duplicate, duplicate: outcome.duplicate }
  }

  // Connect onboarding (Standard account, company.integrations.stripeAccountId) lives in
  // ../integrations/integrations.ts — Settings → Integrations → Connect Stripe. The Express-account
  // functions that once sat here wrote a second id to company.settings that nothing read, and their
  // routes could never report "connected". Removed in #160; connectedAccountFor above is the one reader.

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
    connectedAccountFor,
    getOrCreateCustomer,
    updateCustomer,
    createPaymentIntent,
    createPartialPaymentIntent,
    getPaymentIntent,
    createCheckoutSession,
    handleWebhook,
    createPaymentLink,
    createRefund,
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

  // Connect tenants: Stripe delivers connected-account events to the Factory's Connect endpoint, which
  // forwards each one here over the signed Factory→tenant channel (same X-Factory-Key as
  // /api/internal/sync-subscription). A business on its own keys keeps its direct /webhook. (#154)
  app.post('/factory-event', async (c) => {
    const syncKey = process.env.FACTORY_SYNC_KEY
    if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
    if ((c.req.header('X-Factory-Key') || '') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
    const body = await c.req.json().catch(() => null)
    const event = body?.event
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || !event.data?.object) {
      return c.json({ error: 'event with type and data.object is required' }, 400)
    }
    const result = await stripeService.handleWebhook(event)

    console.log(`Stripe connect event ${event.type}:`, result)
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

    // inv.balance is not a column (it was always undefined, so the partial path never ran) — #157
    let result
    if (amount && amount < invoiceBalance(inv)) {
      result = await stripeService.createPartialPaymentIntent(inv, contactRow, amount)
    } else {
      result = await stripeService.createPaymentIntent(inv, contactRow)
    }

    return c.json(result)
  })

  // Get payment intent status
  app.get('/payment-intent/:id', async (c) => {
    const user = c.get('user') as any
    const paymentIntent = await stripeService.getPaymentIntent(c.req.param('id'), await stripeService.connectedAccountFor(user.companyId))
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

    if (!contactRow) {
      return c.json({ error: 'Invoice has no contact' }, 400)
    }

    if (invoiceBalance(inv) <= 0) {
      return c.json({ error: 'Invoice has no balance due' }, 400)
    }

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

    // inv.balance is not a column — this check never fired, so a paid invoice could get a $0 link. (#157)
    if (invoiceBalance(inv) <= 0) {
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

  // Refund a Stripe payment (whole payment when `amount` is omitted). Issued on Stripe and recorded on
  // the invoice through the shared refund core. (#156)
  app.post('/refund', requirePermission('payments:delete'), async (c) => {
    const user = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const { paymentId } = body
    if (!paymentId || typeof paymentId !== 'string') return c.json({ error: 'paymentId is required' }, 400)
    const amount = body.amount == null ? null : Number(body.amount)
    if (amount !== null && !(Number.isFinite(amount) && amount > 0)) return c.json({ error: 'Refund amount must be at least $0.01' }, 400)

    const [pay] = await db.select().from(payment).where(eq(payment.id, paymentId)).limit(1)

    if (!pay) {
      return c.json({ error: 'Payment not found' }, 404)
    }

    // Verify company ownership
    const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, pay.invoiceId), eq(invoice.companyId, user.companyId))).limit(1)

    if (!inv) {
      return c.json({ error: 'Invoice not found' }, 404)
    }

    const result = await stripeService.createRefund(pay, amount)
    if (!result.ok) return c.json({ error: result.error }, result.status)

    audit.log({
      action: 'REFUND',
      entity: 'payment',
      entityId: pay.id,
      metadata: { amount: result.refund.amount / 100, invoiceId: inv.id },
      req: c.req,
    })

    return c.json({
      success: true,
      refundId: result.refund.id,
      amount: result.refund.amount / 100,
      invoice: result.invoice,
    })
  })

  // Connect status / onboarding: /api/integrations/stripe/* (integrations.ts). The /account-status and
  // /onboarding routes that sat here read a column that does not exist and were removed in #160.

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

    // inv.balance is not a column (the partial path never ran) — #157
    let result
    if (amount && amount < invoiceBalance(inv)) {
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
