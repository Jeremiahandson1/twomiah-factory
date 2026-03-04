import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import quickbooks from '../services/quickbooks.js';
import audit from '../services/audit.js';

const router = Router();

// OAuth callback doesn't need auth (comes from QuickBooks)
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state, realmId, error } = req.query;

    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=${error}`);
    }

    // Decode state to get companyId
    const { companyId } = JSON.parse(Buffer.from(state, 'base64').toString());

    // Exchange code for tokens
    const tokens = await quickbooks.exchangeCodeForTokens(code);

    // Save connection
    await quickbooks.saveConnection(companyId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      realmId,
      expiresIn: tokens.expires_in,
    });

    res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?qbo=connected`);
  } catch (error) {
    console.error('QuickBooks callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=connection_failed`);
  }
});

// All other routes require authentication
router.use(authenticate);

// Get connection status
router.get('/status', async (req, res, next) => {
  try {
    const status = await quickbooks.getConnectionStatus(req.user.companyId);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// Get auth URL to start OAuth flow
router.get('/auth-url', requireRole('admin'), async (req, res, next) => {
  try {
    const url = quickbooks.getAuthUrl(req.user.companyId);
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

// Disconnect QuickBooks
router.post('/disconnect', requireRole('admin'), async (req, res, next) => {
  try {
    await quickbooks.disconnect(req.user.companyId);

    audit.log({
      action: 'INTEGRATION_DISCONNECT',
      entity: 'quickbooks',
      req,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get QuickBooks company info
router.get('/company-info', async (req, res, next) => {
  try {
    const info = await quickbooks.getCompanyInfo(req.user.companyId);
    res.json(info);
  } catch (error) {
    next(error);
  }
});

// ============================================
// SYNC OPERATIONS
// ============================================

// Sync single customer
router.post('/sync/customer/:contactId', async (req, res, next) => {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.contactId, companyId: req.user.companyId },
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    let result;
    if (contact.qboCustomerId) {
      result = await quickbooks.updateCustomer(req.user.companyId, contact);
    } else {
      result = await quickbooks.createCustomer(req.user.companyId, contact);
    }

    res.json({ success: true, qboCustomerId: result.Id });
  } catch (error) {
    next(error);
  }
});

// Sync all customers
router.post('/sync/customers', requireRole('admin'), async (req, res, next) => {
  try {
    const results = await quickbooks.syncAllCustomers(req.user.companyId);

    audit.log({
      action: 'SYNC',
      entity: 'quickbooks_customers',
      metadata: { 
        total: results.length, 
        successful: results.filter(r => r.success).length 
      },
      req,
    });

    res.json({
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Sync single invoice
router.post('/sync/invoice/:invoiceId', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.invoiceId, companyId: req.user.companyId },
      include: { 
        lineItems: { orderBy: { sortOrder: 'asc' } },
        contact: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    let result;
    if (invoice.qboInvoiceId) {
      result = await quickbooks.updateInvoice(req.user.companyId, invoice);
    } else {
      result = await quickbooks.createInvoice(req.user.companyId, invoice);
    }

    res.json({ success: true, qboInvoiceId: result.Id });
  } catch (error) {
    next(error);
  }
});

// Sync all invoices
router.post('/sync/invoices', requireRole('admin'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.body;
    const results = await quickbooks.syncAllInvoices(req.user.companyId, { startDate, endDate });

    audit.log({
      action: 'SYNC',
      entity: 'quickbooks_invoices',
      metadata: { 
        total: results.length, 
        successful: results.filter(r => r.success).length 
      },
      req,
    });

    res.json({
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Sync payment
router.post('/sync/payment/:paymentId', async (req, res, next) => {
  try {
    const payment = await prisma.payment.findFirst({
      where: { id: req.params.paymentId },
      include: { invoice: true },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Verify invoice belongs to user's company
    const invoice = await prisma.invoice.findFirst({
      where: { id: payment.invoiceId, companyId: req.user.companyId },
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const result = await quickbooks.createPayment(req.user.companyId, payment, invoice);
    res.json({ success: true, qboPaymentId: result.Id });
  } catch (error) {
    next(error);
  }
});

// ============================================
// IMPORT OPERATIONS
// ============================================

// Import customers from QuickBooks
router.post('/import/customers', requireRole('admin'), async (req, res, next) => {
  try {
    const results = await quickbooks.importCustomers(req.user.companyId);

    audit.log({
      action: 'IMPORT',
      entity: 'quickbooks_customers',
      metadata: { count: results.length },
      req,
    });

    res.json({
      total: results.length,
      created: results.filter(r => r.action === 'created').length,
      updated: results.filter(r => r.action === 'updated').length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Prisma client for route handlers
import { prisma } from '../index.js';

export default router;
