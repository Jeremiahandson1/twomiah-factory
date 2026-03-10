import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import { promotion } from '../../db/schema';
import { eq, and, asc, gte, lte, sql } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody, nameSchema } from '../utils/validation';
import { NotFoundError } from '../utils/errors';

const app = new Hono();

app.use('*', authenticate);

// GET / — active promotions for current date
app.get('/', async (c) => {
  const authUser = c.get('user');
  const now = new Date();

  const promotions = await db
    .select()
    .from(promotion)
    .where(
      and(
        eq(promotion.companyId, authUser.companyId),
        eq((promotion as any).isActive, true),
        sql`(${(promotion as any).startDate} IS NULL OR ${(promotion as any).startDate} <= ${now.toISOString()})`,
        sql`(${(promotion as any).endDate} IS NULL OR ${(promotion as any).endDate} >= ${now.toISOString()})`
      )
    )
    .orderBy(asc(promotion.name));

  return c.json({ promotions });
});

// GET /all — all promotions (admin)
app.get('/all', requireManager, async (c) => {
  const authUser = c.get('user');

  const promotions = await db
    .select()
    .from(promotion)
    .where(eq(promotion.companyId, authUser.companyId))
    .orderBy(asc(promotion.name));

  return c.json({ promotions });
});

// POST / — create promotion
const createPromotionSchema = z.object({
  name: nameSchema,
  code: z.string().min(1).max(50).transform((v) => v.toUpperCase().trim()),
  description: z.string().max(1000).optional().nullable(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.string().or(z.number()).transform(String),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  maxUses: z.number().int().positive().optional().nullable(),
  productId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  minOrderAmount: z.string().or(z.number()).transform(String).optional().nullable(),
  stackable: z.boolean().default(false),
});

app.post('/', requireManager, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createPromotionSchema, await c.req.json());

  // Check for duplicate code
  const [existing] = await db
    .select()
    .from(promotion)
    .where(
      and(
        eq(promotion.companyId, authUser.companyId),
        eq((promotion as any).code, body.code)
      )
    )
    .limit(1);

  if (existing) {
    return c.json({ error: 'Promotion code already exists' }, 409);
  }

  const id = createId();
  await db.insert(promotion).values({
    id,
    companyId: authUser.companyId,
    name: body.name,
    code: body.code,
    description: body.description || null,
    discountType: body.discountType,
    discountValue: body.discountValue,
    startDate: body.startDate || null,
    endDate: body.endDate || null,
    maxUses: body.maxUses || null,
    usedCount: 0,
    productId: body.productId || null,
    categoryId: body.categoryId || null,
    minOrderAmount: body.minOrderAmount || null,
    stackable: body.stackable,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ id, message: 'Promotion created' }, 201);
});

// PUT /:id — update promotion
const updatePromotionSchema = z.object({
  name: nameSchema.optional(),
  code: z.string().min(1).max(50).transform((v) => v.toUpperCase().trim()).optional(),
  description: z.string().max(1000).optional().nullable(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.string().or(z.number()).transform(String).optional(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  maxUses: z.number().int().positive().optional().nullable(),
  productId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  minOrderAmount: z.string().or(z.number()).transform(String).optional().nullable(),
  stackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

app.put('/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const promoId = c.req.param('id');
  const body = parseBody(updatePromotionSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(promotion)
    .where(
      and(eq(promotion.id, promoId), eq(promotion.companyId, authUser.companyId))
    )
    .limit(1);

  if (!existing) throw new NotFoundError('Promotion');

  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) updates[key] = val;
  }

  await db.update(promotion).set(updates).where(eq(promotion.id, promoId));

  return c.json({ message: 'Promotion updated' });
});

// DELETE /:id — deactivate
app.delete('/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const promoId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(promotion)
    .where(
      and(eq(promotion.id, promoId), eq(promotion.companyId, authUser.companyId))
    )
    .limit(1);

  if (!existing) throw new NotFoundError('Promotion');

  await db
    .update(promotion)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(promotion.id, promoId));

  return c.json({ message: 'Promotion deactivated' });
});

export default app;
