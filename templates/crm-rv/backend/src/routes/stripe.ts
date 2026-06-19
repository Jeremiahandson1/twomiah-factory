import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/permissions.ts';
import stripeService from '../services/stripe.ts';
import audit from '../services/audit.ts';
import { db } from '../../db/index.ts';
import { invoice, contact, payment, company } from '../../db/schema.ts';
import { eq, and } from 'drizzle-orm';

const app = new Hono();

// ============================================
// WEBHOOK (no auth - called by Stripe)
// ============================================

app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();

  const event = stripeService.constructWebhookEvent(rawBody, signature);
  const result = await stripeService.handleWebhook(event);

  console.log(`Stripe webhook ${event.type}:`, result);
  return c.json({ received: true, ...result });
});

// All other routes require authentication
app.use('*', authenticate);

// ============================================
// CONFIG
// ============================================

// Get publishable key for frontend
app.get('/config', async (c) => {
  return c.json({
    publishableKey: stripeService.getPublishableKey(),
  });
});

// ============================================
// PAYMENT INTENTS
// ============================================

// Create payment intent for invoice
app.post('/payment-intent', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any;
  const { invoiceId, amount } = await c.req.json();

  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId))).limit(1);

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  const [contactRow] = inv.contactId
    ? await db.select().from(contact).where(eq(contact.id, inv.contactId)).limit(1)
    : [null];

  if (!contactRow) {
    return c.json({ error: 'Invoice has no contact' }, 400);
  }

  let result;
  if (amount && amount < Number(inv.balance)) {
    result = await stripeService.createPartialPaymentIntent(inv, contactRow, amount);
  } else {
    result = await stripeService.createPaymentIntent(inv, contactRow);
  }

  return c.json(result);
});

// Get payment intent status
app.get('/payment-intent/:id', async (c) => {
  const paymentIntent = await stripeService.getPaymentIntent(c.req.param('id'));
  return c.json({
    status: paymentIntent.status,
    amount: paymentIntent.amount,
  });
});

// ============================================
// CHECKOUT SESSIONS
// ============================================

// Create checkout session
app.post('/checkout-session', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any;
  const { invoiceId } = await c.req.json();

  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId))).limit(1);

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  const [contactRow] = inv.contactId
    ? await db.select().from(contact).where(eq(contact.id, inv.contactId)).limit(1)
    : [null];

  const result = await stripeService.createCheckoutSession(inv, contactRow, {
    successUrl: `${process.env.FRONTEND_URL}/invoices/${inv.id}?payment=success`,
    cancelUrl: `${process.env.FRONTEND_URL}/invoices/${inv.id}?payment=cancelled`,
  });

  return c.json(result);
});

// ============================================
// PAYMENT LINKS
// ============================================

// Create payment link for invoice
app.post('/payment-link', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any;
  const { invoiceId } = await c.req.json();

  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId))).limit(1);

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  if (Number(inv.balance) <= 0) {
    return c.json({ error: 'Invoice has no balance due' }, 400);
  }

  const result = await stripeService.createPaymentLink(inv);

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'payment_link',
    entityId: inv.id,
    entityName: inv.number,
    req: c.req,
  });

  return c.json(result);
});

// ============================================
// REFUNDS
// ============================================

// Create refund
app.post('/refund', requirePermission('payments:delete'), async (c) => {
  const user = c.get('user') as any;
  const { paymentId, amount } = await c.req.json();

  const [pay] = await db.select().from(payment).where(eq(payment.id, paymentId)).limit(1);

  if (!pay) {
    return c.json({ error: 'Payment not found' }, 404);
  }

  // Verify company ownership
  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, pay.invoiceId), eq(invoice.companyId, user.companyId))).limit(1);

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  if (!pay.stripePaymentIntentId) {
    return c.json({ error: 'Payment was not made through Stripe' }, 400);
  }

  const refund = await stripeService.createRefund(pay, amount);

  audit.log({
    action: 'REFUND',
    entity: 'payment',
    entityId: pay.id,
    metadata: { amount: refund.amount / 100, invoiceId: inv.id },
    req: c.req,
  });

  return c.json({
    success: true,
    refundId: refund.id,
    amount: refund.amount / 100,
  });
});

// ============================================
// CONNECT (Platform Features)
// ============================================

// Get account status
app.get('/account-status', requirePermission('settings:read'), async (c) => {
  const user = c.get('user') as any;

  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1);

  if (!(comp as any).stripeAccountId) {
    return c.json({ connected: false });
  }

  const status = await stripeService.getAccountStatus((comp as any).stripeAccountId);
  return c.json({ connected: true, ...status });
});

// Create/get onboarding link
app.post('/onboarding', requirePermission('settings:update'), async (c) => {
  const user = c.get('user') as any;

  const [comp] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1);

  const accountLink = await stripeService.createAccountLink(comp);
  return c.json({ url: accountLink.url });
});

// ============================================
// PORTAL PAYMENTS (Public with token)
// ============================================

// Create payment intent for portal
app.post('/portal/payment-intent', async (c) => {
  const { invoiceId, portalToken, amount } = await c.req.json();

  // Verify portal access
  const [contactRow] = await db.select().from(contact).where(and(eq(contact.portalToken, portalToken), eq(contact.portalEnabled, true))).limit(1);

  if (!contactRow) {
    return c.json({ error: 'Invalid portal access' }, 401);
  }

  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.contactId, contactRow.id))).limit(1);

  if (!inv) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  let result;
  if (amount && amount < Number(inv.balance)) {
    result = await stripeService.createPartialPaymentIntent(inv, contactRow, amount);
  } else {
    result = await stripeService.createPaymentIntent(inv, contactRow);
  }

  return c.json(result);
});

export default app;
