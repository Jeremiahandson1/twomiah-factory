import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/permissions.js';
import wisetack from '../services/wisetack.js';
import audit from '../services/audit.js';

const router = Router();

// Webhook endpoint (no auth - uses signature verification)
router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['x-wisetack-signature'];
    const result = await wisetack.processWebhook(req.body, signature);
    
    res.json(result);
  } catch (error) {
    console.error('Wisetack webhook error:', error);
    res.status(400).json({ error: error.message });
  }
});

// All other routes require authentication
router.use(authenticate);

// Get connection status
router.get('/status', async (req, res, next) => {
  try {
    const status = await wisetack.getConnectionStatus(req.user.companyId);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// Connect to Wisetack (initiate OAuth)
router.post('/connect', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const { returnUrl } = req.body;
    
    if (!returnUrl) {
      return res.status(400).json({ error: 'returnUrl is required' });
    }

    const authUrl = await wisetack.initiateWisetackConnection(req.user.companyId, returnUrl);
    
    audit.log({
      action: 'WISETACK_CONNECT_INITIATED',
      entity: 'company',
      entityId: req.user.companyId,
      req,
    });

    res.json({ authUrl });
  } catch (error) {
    next(error);
  }
});

// Complete Wisetack connection (OAuth callback)
router.post('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      return res.status(400).json({ error: 'code and state are required' });
    }

    const result = await wisetack.completeWisetackConnection(code, state);
    
    audit.log({
      action: 'WISETACK_CONNECTED',
      entity: 'company',
      entityId: req.user.companyId,
      req,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Disconnect from Wisetack
router.post('/disconnect', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const result = await wisetack.disconnectWisetack(req.user.companyId);
    
    audit.log({
      action: 'WISETACK_DISCONNECTED',
      entity: 'company',
      entityId: req.user.companyId,
      req,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Create loan application
router.post('/applications', async (req, res, next) => {
  try {
    const { quoteId, invoiceId, contactId, amount, customerInfo } = req.body;

    if (!contactId || !amount) {
      return res.status(400).json({ error: 'contactId and amount are required' });
    }

    const application = await wisetack.createLoanApplication({
      companyId: req.user.companyId,
      quoteId,
      invoiceId,
      contactId,
      amount: parseFloat(amount),
      customerInfo,
    });

    audit.log({
      action: 'FINANCING_APPLICATION_CREATED',
      entity: 'financing',
      entityId: application.id,
      metadata: { amount, quoteId, invoiceId },
      req,
    });

    res.status(201).json(application);
  } catch (error) {
    next(error);
  }
});

// Get application status
router.get('/applications/:id', async (req, res, next) => {
  try {
    const status = await wisetack.getApplicationStatus(req.params.id);
    res.json(status);
  } catch (error) {
    if (error.message === 'Application not found') {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

// Get applications for quote/invoice/contact
router.get('/applications', async (req, res, next) => {
  try {
    const { quoteId, invoiceId, contactId } = req.query;

    const applications = await wisetack.getApplicationsFor(req.user.companyId, {
      quoteId,
      invoiceId,
      contactId,
    });

    res.json(applications);
  } catch (error) {
    next(error);
  }
});

// Get financing options preview (no actual application)
router.get('/options', async (req, res, next) => {
  try {
    const { amount } = req.query;

    if (!amount) {
      return res.status(400).json({ error: 'amount is required' });
    }

    const options = wisetack.getFinancingOptions(parseFloat(amount));
    res.json(options);
  } catch (error) {
    next(error);
  }
});

// Calculate monthly payment
router.get('/calculate', async (req, res, next) => {
  try {
    const { amount, apr = '9.99', term = '36' } = req.query;

    if (!amount) {
      return res.status(400).json({ error: 'amount is required' });
    }

    const monthlyPayment = wisetack.calculateMonthlyPayment(
      parseFloat(amount),
      parseFloat(apr),
      parseInt(term)
    );

    res.json({
      amount: parseFloat(amount),
      apr: parseFloat(apr),
      termMonths: parseInt(term),
      monthlyPayment,
      totalCost: monthlyPayment * parseInt(term),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
