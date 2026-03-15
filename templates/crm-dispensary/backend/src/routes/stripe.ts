import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import { requirePermission } from '../middleware/permissions.ts';
import stripeService from '../services/stripe.ts';
import audit from '../services/audit.ts';
import { db } from '../../db/index.ts';
import { order, contact, company } from '../../db/schema.ts';
import { eq, and } from 'drizzle-orm';

const app = new Hono();

// ============================================
// WEBHOOK (no auth - called by Stripe)
// ============================================

app.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  const body = await c.req.json();

  const event = stripeService.constructWebhookEvent(body, signature);
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

export default app;
