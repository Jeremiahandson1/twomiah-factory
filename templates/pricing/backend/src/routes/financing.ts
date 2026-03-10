import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { quote, financingLender } from '../../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { authenticate } from '../middleware/auth';
import { parseBody, cuidSchema } from '../utils/validation';
import { NotFoundError } from '../utils/errors';
import { logger } from '../services/logger';

const app = new Hono();

const WISETACK_API_URL = process.env.WISETACK_API_URL || 'https://api.wisetack.com';
const WISETACK_API_KEY = process.env.WISETACK_API_KEY || '';

// POST /apply
const applySchema = z.object({
  quoteId: cuidSchema,
  amount: z.number().positive(),
  term: z.number().int().positive(), // months
  customerFirstName: z.string().optional(),
  customerLastName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
});

app.post('/apply', authenticate, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(applySchema, await c.req.json());

  // Verify quote
  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, body.quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  const quoteData = q as any;

  // Get lenders in priority order
  const lenders = await db
    .select()
    .from(financingLender)
    .where(
      and(
        eq(financingLender.companyId, authUser.companyId),
        eq((financingLender as any).isActive, true)
      )
    )
    .orderBy(asc((financingLender as any).priority));

  // Try Wisetack first (mock structure)
  const applicationId = createId();

  try {
    if (WISETACK_API_KEY) {
      const wisetackResponse = await fetch(`${WISETACK_API_URL}/v1/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${WISETACK_API_KEY}`,
        },
        body: JSON.stringify({
          transactionAmount: body.amount,
          purpose: `Quote ${quoteData.quoteNumber}`,
          consumer: {
            firstName: body.customerFirstName || quoteData.customerFirstName,
            lastName: body.customerLastName || quoteData.customerLastName,
            email: body.customerEmail || quoteData.customerEmail,
            phone: body.customerPhone || quoteData.customerPhone,
          },
        }),
      });

      if (wisetackResponse.ok) {
        const result = await wisetackResponse.json();
        logger.info('Wisetack application submitted', {
          applicationId,
          quoteId: body.quoteId,
          wisetackId: (result as any).id,
        });

        // Update quote with financing info
        await db
          .update(quote)
          .set({
            financingApplicationId: (result as any).id || applicationId,
            financingStatus: 'pending',
            financingAmount: String(body.amount),
            updatedAt: new Date(),
          })
          .where(eq(quote.id, body.quoteId));

        return c.json({
          applicationId: (result as any).id || applicationId,
          status: 'pending',
          lender: 'wisetack',
          customerUrl: (result as any).consumerUrl || null,
        });
      }
    }

    // Fallback: mock response for development
    logger.info('Financing application created (mock)', { applicationId, quoteId: body.quoteId });

    await db
      .update(quote)
      .set({
        financingApplicationId: applicationId,
        financingStatus: 'pending',
        financingAmount: String(body.amount),
        updatedAt: new Date(),
      })
      .where(eq(quote.id, body.quoteId));

    return c.json({
      applicationId,
      status: 'pending',
      lender: lenders.length > 0 ? (lenders[0] as any).name : 'default',
      message: 'Application submitted. Customer will receive a link to complete.',
    });
  } catch (err) {
    logger.error('Financing application failed', { error: (err as Error).message });
    return c.json({ error: 'Financing application failed' }, 500);
  }
});

// GET /status/:applicationId
app.get('/status/:applicationId', authenticate, async (c) => {
  const authUser = c.get('user');
  const applicationId = c.req.param('applicationId');

  // Look up by financing application ID
  const [q] = await db
    .select()
    .from(quote)
    .where(
      and(
        eq((quote as any).financingApplicationId, applicationId),
        eq(quote.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (!q) throw new NotFoundError('Financing application');

  const quoteData = q as any;

  // If Wisetack is configured, try fetching real status
  if (WISETACK_API_KEY) {
    try {
      const response = await fetch(`${WISETACK_API_URL}/v1/transactions/${applicationId}`, {
        headers: { Authorization: `Bearer ${WISETACK_API_KEY}` },
      });

      if (response.ok) {
        const result = await response.json();
        return c.json({
          applicationId,
          status: (result as any).status || quoteData.financingStatus,
          amount: parseFloat(quoteData.financingAmount || '0'),
          quoteId: quoteData.id,
          details: result,
        });
      }
    } catch (err) {
      logger.warn('Wisetack status check failed', { error: (err as Error).message });
    }
  }

  return c.json({
    applicationId,
    status: quoteData.financingStatus || 'pending',
    amount: parseFloat(quoteData.financingAmount || '0'),
    quoteId: quoteData.id,
  });
});

// POST /wisetack/webhook
app.post('/wisetack/webhook', async (c) => {
  // In production, verify webhook signature
  const body = await c.req.json();

  const transactionId = (body as any).transactionId || (body as any).id;
  const status = (body as any).status;

  if (!transactionId || !status) {
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

  logger.info('Wisetack webhook received', { transactionId, status });

  // Update quote financing status
  const [q] = await db
    .select()
    .from(quote)
    .where(eq((quote as any).financingApplicationId, transactionId))
    .limit(1);

  if (q) {
    await db
      .update(quote)
      .set({
        financingStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(quote.id, (q as any).id));
  }

  return c.json({ received: true });
});

// GET /calculator
app.get('/calculator', async (c) => {
  const amount = parseFloat(c.req.query('amount') || '0');
  const term = parseInt(c.req.query('term') || '60');

  if (amount <= 0 || term <= 0) {
    return c.json({ error: 'Amount and term must be positive' }, 400);
  }

  // Simple monthly payment calculation (no interest for now)
  const monthlyPayment = Math.round((amount / term) * 100) / 100;

  return c.json({
    amount,
    term,
    monthlyPayment,
    totalPayment: amount,
    note: 'This is an estimate. Actual terms will be determined by the financing provider.',
  });
});

export default app;
