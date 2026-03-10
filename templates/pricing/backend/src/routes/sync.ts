import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { quote, quoteLine, quoteLineAddon } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { authenticate } from '../middleware/auth';
import { parseBody, nameSchema, emailSchema, phoneSchema } from '../utils/validation';
import { logger } from '../services/logger';

const app = new Hono();

app.use('*', authenticate);

// Offline quote schema
const offlineQuoteSchema = z.object({
  offlineId: z.string().min(1),
  customerFirstName: nameSchema,
  customerLastName: nameSchema,
  customerEmail: emailSchema.optional().nullable(),
  customerPhone: phoneSchema.optional().nullable(),
  customerAddress: z.string().max(500).optional().nullable(),
  customerCity: z.string().max(100).optional().nullable(),
  customerState: z.string().max(50).optional().nullable(),
  customerZip: z.string().max(20).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  taxRate: z.string().or(z.number()).transform(String).default('0'),
  lines: z
    .array(
      z.object({
        productId: z.string(),
        productName: z.string(),
        tier: z.enum(['good', 'better', 'best']),
        quantity: z.number().int().positive(),
        measurementValue: z.number().optional().nullable(),
        measurementType: z.string().optional().nullable(),
        unitPrice: z.string().or(z.number()).transform(String),
        sellingPrice: z.string().or(z.number()).transform(String),
        parPrice: z.string().or(z.number()).transform(String).optional(),
        retailPrice: z.string().or(z.number()).transform(String).optional(),
        addons: z
          .array(
            z.object({
              addonId: z.string(),
              name: z.string(),
              price: z.string().or(z.number()).transform(String),
              quantity: z.number().int().positive().default(1),
            })
          )
          .optional()
          .default([]),
      })
    )
    .default([]),
  createdAt: z.coerce.date().optional(),
});

const syncSchema = z.object({
  quotes: z.array(offlineQuoteSchema),
});

// POST /offline-queue
app.post('/offline-queue', async (c) => {
  const authUser = c.get('user');
  const body = parseBody(syncSchema, await c.req.json());

  const results: {
    offlineId: string;
    serverId: string | null;
    status: 'created' | 'error';
    error?: string;
  }[] = [];

  for (const offlineQuote of body.quotes) {
    try {
      const quoteId = createId();
      const customerToken = createId();
      const quoteNumber = `Q-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

      // Calculate totals from lines
      let subtotal = 0;
      for (const line of offlineQuote.lines) {
        subtotal += parseFloat(line.sellingPrice);
        for (const addonItem of line.addons) {
          subtotal += parseFloat(addonItem.price) * addonItem.quantity;
        }
      }

      const taxRate = parseFloat(offlineQuote.taxRate);
      const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
      const totalPrice = Math.round((subtotal + taxAmount) * 100) / 100;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await db.insert(quote).values({
        id: quoteId,
        companyId: authUser.companyId,
        repId: authUser.repProfileId || authUser.userId,
        quoteNumber,
        customerFirstName: offlineQuote.customerFirstName,
        customerLastName: offlineQuote.customerLastName,
        customerEmail: offlineQuote.customerEmail || null,
        customerPhone: offlineQuote.customerPhone || null,
        customerAddress: offlineQuote.customerAddress || null,
        customerCity: offlineQuote.customerCity || null,
        customerState: offlineQuote.customerState || null,
        customerZip: offlineQuote.customerZip || null,
        status: 'draft',
        subtotal: String(subtotal),
        taxRate: offlineQuote.taxRate,
        taxAmount: String(taxAmount),
        totalPrice: String(totalPrice),
        notes: offlineQuote.notes || null,
        customerToken,
        expiresAt,
        createdAt: offlineQuote.createdAt || new Date(),
        updatedAt: new Date(),
      });

      // Insert lines
      for (let i = 0; i < offlineQuote.lines.length; i++) {
        const line = offlineQuote.lines[i];
        const lineId = createId();

        await db.insert(quoteLine).values({
          id: lineId,
          quoteId,
          companyId: authUser.companyId,
          productId: line.productId,
          productName: line.productName,
          tier: line.tier,
          quantity: line.quantity,
          measurementValue: line.measurementValue ? String(line.measurementValue) : null,
          measurementType: line.measurementType || null,
          unitPrice: line.unitPrice,
          sellingPrice: line.sellingPrice,
          parPrice: line.parPrice || '0',
          retailPrice: line.retailPrice || '0',
          sortOrder: i,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Insert addons for this line
        for (const addonItem of line.addons) {
          await db.insert(quoteLineAddon).values({
            id: createId(),
            quoteLineId: lineId,
            addonId: addonItem.addonId,
            name: addonItem.name,
            price: addonItem.price,
            quantity: addonItem.quantity,
            createdAt: new Date(),
          });
        }
      }

      results.push({
        offlineId: offlineQuote.offlineId,
        serverId: quoteId,
        status: 'created',
      });

      logger.info('Offline quote synced', {
        offlineId: offlineQuote.offlineId,
        serverId: quoteId,
      });
    } catch (err) {
      results.push({
        offlineId: offlineQuote.offlineId,
        serverId: null,
        status: 'error',
        error: (err as Error).message,
      });

      logger.error('Offline quote sync failed', {
        offlineId: offlineQuote.offlineId,
        error: (err as Error).message,
      });
    }
  }

  const successCount = results.filter((r) => r.status === 'created').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  return c.json({
    results,
    summary: {
      total: body.quotes.length,
      created: successCount,
      errors: errorCount,
    },
  });
});

export default app;
