import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { requireRole } from '../middleware/permissions.ts';
import wisetack from '../services/wisetack.ts';
import audit from '../services/audit.ts';

const app = new Hono();

// Webhook endpoint (no auth - uses signature verification)
app.post('/webhook', async (c) => {
  const signature = c.req.header('x-wisetack-signature');
  const body = await c.req.json();
  const result = await wisetack.processWebhook(body, signature);

  return c.json(result);
});

// All other routes require authentication
app.use('*', authenticate);

// Get connection status
app.get('/status', async (c) => {
  const user = c.get('user') as any;
  const status = await wisetack.getConnectionStatus(user.companyId);
  return c.json(status);
});

// Connect to Wisetack (initiate OAuth)
app.post('/connect', requireRole('admin', 'owner'), async (c) => {
  const user = c.get('user') as any;
  const { returnUrl } = await c.req.json();

  if (!returnUrl) {
    return c.json({ error: 'returnUrl is required' }, 400);
  }

  const authUrl = await wisetack.initiateWisetackConnection(user.companyId, returnUrl);

  audit.log({
    action: 'WISETACK_CONNECT_INITIATED',
    entity: 'company',
    entityId: user.companyId,
    req: c.req,
  });

  return c.json({ authUrl });
});

// Complete Wisetack connection (OAuth callback)
app.post('/callback', async (c) => {
  const user = c.get('user') as any;
  const { code, state } = await c.req.json();

  if (!code || !state) {
    return c.json({ error: 'code and state are required' }, 400);
  }

  const result = await wisetack.completeWisetackConnection(code, state);

  audit.log({
    action: 'WISETACK_CONNECTED',
    entity: 'company',
    entityId: user.companyId,
    req: c.req,
  });

  return c.json(result);
});

// Disconnect from Wisetack
app.post('/disconnect', requireRole('admin', 'owner'), async (c) => {
  const user = c.get('user') as any;
  const result = await wisetack.disconnectWisetack(user.companyId);

  audit.log({
    action: 'WISETACK_DISCONNECTED',
    entity: 'company',
    entityId: user.companyId,
    req: c.req,
  });

  return c.json(result);
});

// Create loan application
app.post('/applications', async (c) => {
  const user = c.get('user') as any;
  const { quoteId, invoiceId, contactId, amount, customerInfo } = await c.req.json();

  if (!contactId || !amount) {
    return c.json({ error: 'contactId and amount are required' }, 400);
  }

  const application = await wisetack.createLoanApplication({
    companyId: user.companyId,
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
    req: c.req,
  });

  return c.json(application, 201);
});

// Get application status
app.get('/applications/:id', async (c) => {
  const status = await wisetack.getApplicationStatus(c.req.param('id'));
  return c.json(status);
});

// Get applications for quote/invoice/contact
app.get('/applications', async (c) => {
  const user = c.get('user') as any;
  const quoteId = c.req.query('quoteId');
  const invoiceId = c.req.query('invoiceId');
  const contactId = c.req.query('contactId');

  const applications = await wisetack.getApplicationsFor(user.companyId, {
    quoteId,
    invoiceId,
    contactId,
  });

  return c.json(applications);
});

// Get financing options preview (no actual application)
app.get('/options', async (c) => {
  const amount = c.req.query('amount');

  if (!amount) {
    return c.json({ error: 'amount is required' }, 400);
  }

  const options = wisetack.getFinancingOptions(parseFloat(amount));
  return c.json(options);
});

// Calculate monthly payment
app.get('/calculate', async (c) => {
  const amount = c.req.query('amount');
  const apr = c.req.query('apr') || '9.99';
  const term = c.req.query('term') || '36';

  if (!amount) {
    return c.json({ error: 'amount is required' }, 400);
  }

  const monthlyPayment = wisetack.calculateMonthlyPayment(
    parseFloat(amount),
    parseFloat(apr),
    parseInt(term)
  );

  return c.json({
    amount: parseFloat(amount),
    apr: parseFloat(apr),
    termMonths: parseInt(term),
    monthlyPayment,
    totalCost: monthlyPayment * parseInt(term),
  });
});

export default app;
