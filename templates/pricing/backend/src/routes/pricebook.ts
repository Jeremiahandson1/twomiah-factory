import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../../db/index';
import {
  productCategory,
  product,
  priceRange,
  addon,
  pricingGuardrail,
} from '../../db/schema';
import { eq, and, asc, desc, inArray } from 'drizzle-orm';
import { authenticate, requireManager } from '../middleware/auth';
import { parseBody, nameSchema, priceSchema, percentSchema, cuidSchema } from '../utils/validation';
import { AppError, NotFoundError } from '../utils/errors';
import { logger } from '../services/logger';

const app = new Hono();

// All routes require authentication
app.use('*', authenticate);

// ===================== CATEGORIES =====================

// GET /categories
app.get('/categories', async (c) => {
  const authUser = c.get('user');
  const categories = await db
    .select()
    .from(productCategory)
    .where(eq(productCategory.companyId, authUser.companyId))
    .orderBy(asc(productCategory.sortOrder), asc(productCategory.name));

  return c.json({ categories });
});

// POST /categories
const createCategorySchema = z.object({
  name: nameSchema,
  description: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().int().default(0),
  imageUrl: z.string().url().optional().nullable(),
});

app.post('/categories', requireManager, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createCategorySchema, await c.req.json());

  const id = createId();
  await db.insert(productCategory).values({
    id,
    companyId: authUser.companyId,
    name: body.name,
    description: body.description || null,
    sortOrder: body.sortOrder,
    imageUrl: body.imageUrl || null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ id, message: 'Category created' }, 201);
});

// PUT /categories/:id
const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(1000).optional().nullable(),
  sortOrder: z.number().int().optional(),
  imageUrl: z.string().url().optional().nullable(),
  isActive: z.boolean().optional(),
});

app.put('/categories/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const categoryId = c.req.param('id');
  const body = parseBody(updateCategorySchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(productCategory)
    .where(and(eq(productCategory.id, categoryId), eq(productCategory.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Category');

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db
    .update(productCategory)
    .set(updates)
    .where(eq(productCategory.id, categoryId));

  return c.json({ message: 'Category updated' });
});

// DELETE /categories/:id (soft delete)
app.delete('/categories/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const categoryId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(productCategory)
    .where(and(eq(productCategory.id, categoryId), eq(productCategory.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Category');

  await db
    .update(productCategory)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(productCategory.id, categoryId));

  return c.json({ message: 'Category deactivated' });
});

// ===================== PRODUCTS =====================

// GET /products
app.get('/products', async (c) => {
  const authUser = c.get('user');
  const categoryId = c.req.query('categoryId');

  let query = db
    .select({
      product: product,
      categoryName: productCategory.name,
    })
    .from(product)
    .leftJoin(productCategory, eq(product.categoryId, productCategory.id))
    .where(eq(product.companyId, authUser.companyId))
    .orderBy(asc(product.name));

  if (categoryId) {
    query = db
      .select({
        product: product,
        categoryName: productCategory.name,
      })
      .from(product)
      .leftJoin(productCategory, eq(product.categoryId, productCategory.id))
      .where(and(eq(product.companyId, authUser.companyId), eq(product.categoryId, categoryId)))
      .orderBy(asc(product.name));
  }

  const results = await query;

  const products = results.map((r) => ({
    ...(r.product as any),
    categoryName: r.categoryName,
  }));

  return c.json({ products });
});

// POST /products
const createProductSchema = z.object({
  categoryId: cuidSchema,
  name: nameSchema,
  description: z.string().max(2000).optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  measurementType: z.enum(['united_inches', 'sq_ft', 'linear_ft', 'count', 'fixed']),
  imageUrl: z.string().url().optional().nullable(),
  sortOrder: z.number().int().default(0),
});

app.post('/products', requireManager, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createProductSchema, await c.req.json());

  const id = createId();
  await db.insert(product).values({
    id,
    companyId: authUser.companyId,
    categoryId: body.categoryId,
    name: body.name,
    description: body.description || null,
    sku: body.sku || null,
    measurementType: body.measurementType,
    imageUrl: body.imageUrl || null,
    sortOrder: body.sortOrder,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ id, message: 'Product created' }, 201);
});

// PUT /products/:id
const updateProductSchema = z.object({
  categoryId: cuidSchema.optional(),
  name: nameSchema.optional(),
  description: z.string().max(2000).optional().nullable(),
  sku: z.string().max(100).optional().nullable(),
  measurementType: z.enum(['united_inches', 'sq_ft', 'linear_ft', 'count', 'fixed']).optional(),
  imageUrl: z.string().url().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

app.put('/products/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');
  const body = parseBody(updateProductSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, productId), eq(product.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Product');

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.sku !== undefined) updates.sku = body.sku;
  if (body.measurementType !== undefined) updates.measurementType = body.measurementType;
  if (body.imageUrl !== undefined) updates.imageUrl = body.imageUrl;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(product).set(updates).where(eq(product.id, productId));

  return c.json({ message: 'Product updated' });
});

// ===================== PRICE RANGES =====================

// GET /products/:id/ranges
app.get('/products/:id/ranges', async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');

  // Check if rep has territory-specific ranges
  let ranges;
  if (authUser.repProfileId) {
    // Try territory-specific ranges first via rep profile
    const repProfileResult = await db
      .select()
      .from(require('../../db/schema').repProfile)
      .where(eq(require('../../db/schema').repProfile.id, authUser.repProfileId))
      .limit(1);

    const rep = repProfileResult[0] as any;
    if (rep?.territoryId) {
      const territoryRanges = await db
        .select()
        .from(priceRange)
        .where(
          and(
            eq(priceRange.productId, productId),
            eq(priceRange.companyId, authUser.companyId),
            eq((priceRange as any).territoryId, rep.territoryId)
          )
        )
        .orderBy(asc(priceRange.minValue));

      if (territoryRanges.length > 0) {
        ranges = territoryRanges;
      }
    }
  }

  if (!ranges) {
    ranges = await db
      .select()
      .from(priceRange)
      .where(
        and(
          eq(priceRange.productId, productId),
          eq(priceRange.companyId, authUser.companyId)
        )
      )
      .orderBy(asc(priceRange.minValue));
  }

  // Calculate tier prices for each range
  const rangesWithTiers = ranges.map((r: any) => {
    const parPrice = parseFloat(r.parPrice || '0');
    const retailPrice = parseFloat(r.retailPrice || '0');
    const yr1MarkupPct = parseFloat(r.yr1MarkupPct || '0');
    const day30MarkupPct = parseFloat(r.day30MarkupPct || '0');
    const todayDiscountPct = parseFloat(r.todayDiscountPct || '0');

    return {
      ...r,
      parPrice,
      retailPrice,
      yr1Price: Math.round(retailPrice * (1 + yr1MarkupPct / 100) * 100) / 100,
      day30Price: Math.round(retailPrice * (1 + day30MarkupPct / 100) * 100) / 100,
      todayPrice: Math.round(retailPrice * (1 - todayDiscountPct / 100) * 100) / 100,
    };
  });

  return c.json({ ranges: rangesWithTiers });
});

// POST /products/:id/ranges (bulk replace)
const rangeItemSchema = z.object({
  minValue: z.number(),
  maxValue: z.number(),
  tier: z.enum(['good', 'better', 'best']),
  parPrice: z.string().or(z.number()).transform(String),
  retailPrice: z.string().or(z.number()).transform(String),
  yr1MarkupPct: z.string().or(z.number()).transform(String).default('0'),
  day30MarkupPct: z.string().or(z.number()).transform(String).default('0'),
  todayDiscountPct: z.string().or(z.number()).transform(String).default('0'),
  territoryId: z.string().optional().nullable(),
});

const bulkRangesSchema = z.object({
  ranges: z.array(rangeItemSchema).min(1),
});

app.post('/products/:id/ranges', requireManager, async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');
  const body = parseBody(bulkRangesSchema, await c.req.json());

  // Verify product belongs to tenant
  const [prod] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, productId), eq(product.companyId, authUser.companyId)))
    .limit(1);

  if (!prod) throw new NotFoundError('Product');

  // Delete existing ranges for this product
  await db
    .delete(priceRange)
    .where(
      and(eq(priceRange.productId, productId), eq(priceRange.companyId, authUser.companyId))
    );

  // Insert new ranges
  const values = body.ranges.map((r) => ({
    id: createId(),
    companyId: authUser.companyId,
    productId,
    minValue: String(r.minValue),
    maxValue: String(r.maxValue),
    tier: r.tier,
    parPrice: r.parPrice,
    retailPrice: r.retailPrice,
    yr1MarkupPct: r.yr1MarkupPct,
    day30MarkupPct: r.day30MarkupPct,
    todayDiscountPct: r.todayDiscountPct,
    territoryId: r.territoryId || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await db.insert(priceRange).values(values);

  return c.json({ message: 'Price ranges updated', count: values.length });
});

// ===================== ADDONS =====================

// GET /products/:id/addons
app.get('/products/:id/addons', async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');

  const addons = await db
    .select()
    .from(addon)
    .where(and(eq(addon.productId, productId), eq(addon.companyId, authUser.companyId)))
    .orderBy(asc((addon as any).groupName), asc(addon.name));

  // Group by groupName
  const grouped: Record<string, any[]> = {};
  for (const a of addons) {
    const group = (a as any).groupName || 'Uncategorized';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(a);
  }

  return c.json({ addons: grouped });
});

// POST /products/:id/addons
const createAddonSchema = z.object({
  name: nameSchema,
  description: z.string().max(1000).optional().nullable(),
  price: z.string().or(z.number()).transform(String),
  groupName: z.string().max(100).optional().nullable(),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

app.post('/products/:id/addons', requireManager, async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');
  const body = parseBody(createAddonSchema, await c.req.json());

  const id = createId();
  await db.insert(addon).values({
    id,
    companyId: authUser.companyId,
    productId,
    name: body.name,
    description: body.description || null,
    price: body.price,
    groupName: body.groupName || null,
    isRequired: body.isRequired,
    sortOrder: body.sortOrder,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ id, message: 'Addon created' }, 201);
});

// PUT /addons/:id
const updateAddonSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(1000).optional().nullable(),
  price: z.string().or(z.number()).transform(String).optional(),
  groupName: z.string().max(100).optional().nullable(),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

app.put('/addons/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const addonId = c.req.param('id');
  const body = parseBody(updateAddonSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(addon)
    .where(and(eq(addon.id, addonId), eq(addon.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Addon');

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.price !== undefined) updates.price = body.price;
  if (body.groupName !== undefined) updates.groupName = body.groupName;
  if (body.isRequired !== undefined) updates.isRequired = body.isRequired;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  await db.update(addon).set(updates).where(eq(addon.id, addonId));

  return c.json({ message: 'Addon updated' });
});

// DELETE /addons/:id
app.delete('/addons/:id', requireManager, async (c) => {
  const authUser = c.get('user');
  const addonId = c.req.param('id');

  const [existing] = await db
    .select()
    .from(addon)
    .where(and(eq(addon.id, addonId), eq(addon.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Addon');

  await db.delete(addon).where(eq(addon.id, addonId));

  return c.json({ message: 'Addon deleted' });
});

// ===================== GUARDRAILS =====================

// GET /products/:id/guardrails
app.get('/products/:id/guardrails', async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');

  const [guardrail] = await db
    .select()
    .from(pricingGuardrail)
    .where(
      and(
        eq(pricingGuardrail.productId, productId),
        eq(pricingGuardrail.companyId, authUser.companyId)
      )
    )
    .limit(1);

  return c.json({ guardrail: guardrail || null });
});

// PUT /products/:id/guardrails (upsert)
const upsertGuardrailSchema = z.object({
  floorPricePct: z.string().or(z.number()).transform(String),
  managerApprovalPct: z.string().or(z.number()).transform(String),
  maxDiscountPct: z.string().or(z.number()).transform(String),
});

app.put('/products/:id/guardrails', requireManager, async (c) => {
  const authUser = c.get('user');
  const productId = c.req.param('id');
  const body = parseBody(upsertGuardrailSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(pricingGuardrail)
    .where(
      and(
        eq(pricingGuardrail.productId, productId),
        eq(pricingGuardrail.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(pricingGuardrail)
      .set({
        floorPricePct: body.floorPricePct,
        managerApprovalPct: body.managerApprovalPct,
        maxDiscountPct: body.maxDiscountPct,
        updatedAt: new Date(),
      })
      .where(eq(pricingGuardrail.id, (existing as any).id));
  } else {
    await db.insert(pricingGuardrail).values({
      id: createId(),
      companyId: authUser.companyId,
      productId,
      floorPricePct: body.floorPricePct,
      managerApprovalPct: body.managerApprovalPct,
      maxDiscountPct: body.maxDiscountPct,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return c.json({ message: 'Guardrail saved' });
});

export default app;
