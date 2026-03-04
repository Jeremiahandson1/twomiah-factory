import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import stripeService from '../services/stripe.js';
import audit from '../services/audit.js';
import { prisma } from '../index.js';

const router = Router();

// ============================================
// WEBHOOK (no auth - called by Stripe)
// ============================================

router.post('/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];

  try {
    const event = stripeService.constructWebhookEvent(req.body, signature);
    const result = await stripeService.handleWebhook(event);
    
    console.log(`Stripe webhook ${event.type}:`, result);
    res.json({ received: true, ...result });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// All other routes require authentication
router.use(authenticate);

// ============================================
// CONFIG
// ============================================

// Get publishable key for frontend
router.get('/config', (req, res) => {
  res.json({
    publishableKey: stripeService.getPublishableKey(),
  });
});

// ============================================
// PAYMENT INTENTS
// ============================================

// Create payment intent for invoice
router.post('/payment-intent', requirePermission('invoices:read'), async (req, res, next) => {
  try {
    const { invoiceId, amount } = req.body;

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: req.user.companyId },
      include: { contact: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!invoice.contact) {
      return res.status(400).json({ error: 'Invoice has no contact' });
    }

    let result;
    if (amount && amount < Number(invoice.balance)) {
      result = await stripeService.createPartialPaymentIntent(invoice, invoice.contact, amount);
    } else {
      result = await stripeService.createPaymentIntent(invoice, invoice.contact);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get payment intent status
router.get('/payment-intent/:id', async (req, res, next) => {
  try {
    const paymentIntent = await stripeService.getPaymentIntent(req.params.id);
    res.json({
      status: paymentIntent.status,
      amount: paymentIntent.amount,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CHECKOUT SESSIONS
// ============================================

// Create checkout session
router.post('/checkout-session', requirePermission('invoices:read'), async (req, res, next) => {
  try {
    const { invoiceId } = req.body;

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: req.user.companyId },
      include: { contact: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const result = await stripeService.createCheckoutSession(invoice, invoice.contact, {
      successUrl: `${process.env.FRONTEND_URL}/invoices/${invoice.id}?payment=success`,
      cancelUrl: `${process.env.FRONTEND_URL}/invoices/${invoice.id}?payment=cancelled`,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// PAYMENT LINKS
// ============================================

// Create payment link for invoice
router.post('/payment-link', requirePermission('invoices:update'), async (req, res, next) => {
  try {
    const { invoiceId } = req.body;

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId: req.user.companyId },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (Number(invoice.balance) <= 0) {
      return res.status(400).json({ error: 'Invoice has no balance due' });
    }

    const result = await stripeService.createPaymentLink(invoice);

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'payment_link',
      entityId: invoice.id,
      entityName: invoice.number,
      req,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// REFUNDS
// ============================================

// Create refund
router.post('/refund', requirePermission('payments:delete'), async (req, res, next) => {
  try {
    const { paymentId, amount } = req.body;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: true },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Verify company ownership
    const invoice = await prisma.invoice.findFirst({
      where: { id: payment.invoiceId, companyId: req.user.companyId },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!payment.stripePaymentIntentId) {
      return res.status(400).json({ error: 'Payment was not made through Stripe' });
    }

    const refund = await stripeService.createRefund(payment, amount);

    audit.log({
      action: 'REFUND',
      entity: 'payment',
      entityId: payment.id,
      metadata: { amount: refund.amount / 100, invoiceId: invoice.id },
      req,
    });

    res.json({
      success: true,
      refundId: refund.id,
      amount: refund.amount / 100,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CONNECT (Platform Features)
// ============================================

// Get account status
router.get('/account-status', requirePermission('settings:read'), async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    if (!company.stripeAccountId) {
      return res.json({ connected: false });
    }

    const status = await stripeService.getAccountStatus(company.stripeAccountId);
    res.json({ connected: true, ...status });
  } catch (error) {
    next(error);
  }
});

// Create/get onboarding link
router.post('/onboarding', requirePermission('settings:update'), async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
    });

    const accountLink = await stripeService.createAccountLink(company);
    res.json({ url: accountLink.url });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PORTAL PAYMENTS (Public with token)
// ============================================

// These routes are accessed from the customer portal

// Create payment intent for portal
router.post('/portal/payment-intent', async (req, res, next) => {
  try {
    const { invoiceId, portalToken, amount } = req.body;

    // Verify portal access
    const contact = await prisma.contact.findFirst({
      where: { portalToken, portalEnabled: true },
    });

    if (!contact) {
      return res.status(401).json({ error: 'Invalid portal access' });
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, contactId: contact.id },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    let result;
    if (amount && amount < Number(invoice.balance)) {
      result = await stripeService.createPartialPaymentIntent(invoice, contact, amount);
    } else {
      result = await stripeService.createPaymentIntent(invoice, contact);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
