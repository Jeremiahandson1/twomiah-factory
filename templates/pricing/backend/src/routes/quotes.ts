import { Hono } from 'hono';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import crypto from 'crypto';
import { db } from '../../db/index';
import {
  quote,
  quoteLine,
  quoteLineAddon,
  quoteContract,
  quotePriceAdjustment,
  product,
  priceRange,
  addon,
  pricingGuardrail,
  promotion,
  repProfile,
  contractTemplate,
  company,
  commissionRecord,
} from '../../db/schema';
import { eq, and, asc, desc, gte, lte, like, or, sql } from 'drizzle-orm';
import { authenticate, requireManager, type AuthUser } from '../middleware/auth';
import { parseBody, cuidSchema, nameSchema, phoneSchema, emailSchema } from '../utils/validation';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { logAudit } from '../services/audit';
import { calculateCommission, createCommissionRecord } from '../services/commission';
import { generateQuotePdf } from '../services/pdf';
import { logger } from '../services/logger';

const app = new Hono();

// Helper: recalculate quote totals
async function recalculateQuoteTotals(quoteId: string) {
  const lines = await db
    .select()
    .from(quoteLine)
    .where(eq(quoteLine.quoteId, quoteId));

  let subtotal = 0;
  for (const line of lines) {
    subtotal += parseFloat((line as any).sellingPrice || '0');
  }

  // Get addons for all lines
  const lineIds = lines.map((l) => l.id);
  let addonsTotal = 0;
  if (lineIds.length > 0) {
    for (const lineId of lineIds) {
      const lineAddons = await db
        .select()
        .from(quoteLineAddon)
        .where(eq(quoteLineAddon.quoteLineId, lineId));
      for (const la of lineAddons) {
        addonsTotal += parseFloat((la as any).price || '0') * ((la as any).quantity || 1);
      }
    }
  }

  subtotal += addonsTotal;

  // Get current quote for tax rate
  const [currentQuote] = await db.select().from(quote).where(eq(quote.id, quoteId)).limit(1);
  const taxRate = parseFloat((currentQuote as any).taxRate || '0');
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const totalPrice = Math.round((subtotal + taxAmount) * 100) / 100;

  await db
    .update(quote)
    .set({
      subtotal: String(subtotal),
      taxAmount: String(taxAmount),
      totalPrice: String(totalPrice),
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));
}

// ===================== QUOTES CRUD =====================

// GET / — list quotes
app.get('/', authenticate, async (c) => {
  const authUser = c.get('user');
  const status = c.req.query('status');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const search = c.req.query('search');
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '25');
  const offset = (page - 1) * limit;

  const conditions: any[] = [eq(quote.companyId, authUser.companyId)];

  // Reps only see their own quotes
  if (authUser.role === 'rep' || authUser.role === 'senior_rep') {
    if (authUser.repProfileId) {
      conditions.push(eq((quote as any).repId, authUser.repProfileId));
    }
  }

  if (status) {
    conditions.push(eq(quote.status, status));
  }
  if (startDate) {
    conditions.push(gte(quote.createdAt, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(quote.createdAt, new Date(endDate)));
  }
  if (search) {
    conditions.push(
      or(
        like(quote.customerFirstName, `%${search}%`),
        like(quote.customerLastName, `%${search}%`)
      )
    );
  }

  const quotes = await db
    .select()
    .from(quote)
    .where(and(...conditions))
    .orderBy(desc(quote.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quote)
    .where(and(...conditions));

  return c.json({
    quotes,
    pagination: {
      page,
      limit,
      total: Number((countResult as any).count),
      totalPages: Math.ceil(Number((countResult as any).count) / limit),
    },
  });
});

// POST / — create quote
const createQuoteSchema = z.object({
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
  expirationDays: z.number().int().positive().default(30),
});

app.post('/', authenticate, async (c) => {
  const authUser = c.get('user');
  const body = parseBody(createQuoteSchema, await c.req.json());

  const id = createId();
  const customerToken = createId();
  const quoteNumber = `Q-${Date.now().toString(36).toUpperCase()}`;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + body.expirationDays);

  await db.insert(quote).values({
    id,
    companyId: authUser.companyId,
    repId: authUser.repProfileId || authUser.userId,
    quoteNumber,
    customerFirstName: body.customerFirstName,
    customerLastName: body.customerLastName,
    customerEmail: body.customerEmail || null,
    customerPhone: body.customerPhone || null,
    customerAddress: body.customerAddress || null,
    customerCity: body.customerCity || null,
    customerState: body.customerState || null,
    customerZip: body.customerZip || null,
    status: 'draft',
    subtotal: '0',
    taxRate: body.taxRate,
    taxAmount: '0',
    totalPrice: '0',
    notes: body.notes || null,
    customerToken,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await logAudit(db, authUser.companyId, authUser.userId, 'quote.created', 'quote', id, null, {
    quoteNumber,
    customerName: `${body.customerFirstName} ${body.customerLastName}`,
  });

  return c.json({ id, quoteNumber, customerToken }, 201);
});

// PUT /:id — update quote details
const updateQuoteSchema = z.object({
  customerFirstName: nameSchema.optional(),
  customerLastName: nameSchema.optional(),
  customerEmail: emailSchema.optional().nullable(),
  customerPhone: phoneSchema.optional().nullable(),
  customerAddress: z.string().max(500).optional().nullable(),
  customerCity: z.string().max(100).optional().nullable(),
  customerState: z.string().max(50).optional().nullable(),
  customerZip: z.string().max(20).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  taxRate: z.string().or(z.number()).transform(String).optional(),
});

app.put('/:id', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(updateQuoteSchema, await c.req.json());

  const [existing] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!existing) throw new NotFoundError('Quote');

  const q = existing as any;
  if (q.status !== 'draft' && q.status !== 'presented') {
    throw new ValidationError('Can only edit quotes in draft or presented status');
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) updates[key] = val;
  }

  await db.update(quote).set(updates).where(eq(quote.id, quoteId));

  if (body.taxRate !== undefined) {
    await recalculateQuoteTotals(quoteId);
  }

  return c.json({ message: 'Quote updated' });
});

// POST /:id/add-line
const addLineSchema = z.object({
  productId: cuidSchema,
  tier: z.enum(['good', 'better', 'best']),
  quantity: z.number().int().positive().default(1),
  measurementValue: z.number().optional().nullable(),
});

app.post('/:id/add-line', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(addLineSchema, await c.req.json());

  // Verify quote
  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  if ((q as any).status !== 'draft' && (q as any).status !== 'presented') {
    throw new ValidationError('Can only add lines to draft or presented quotes');
  }

  // Get product
  const [prod] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, body.productId), eq(product.companyId, authUser.companyId)))
    .limit(1);

  if (!prod) throw new NotFoundError('Product');

  // Find matching price range
  const ranges = await db
    .select()
    .from(priceRange)
    .where(
      and(
        eq(priceRange.productId, body.productId),
        eq(priceRange.companyId, authUser.companyId),
        eq((priceRange as any).tier, body.tier)
      )
    )
    .orderBy(asc(priceRange.minValue));

  let matchedRange = null;
  const measurementVal = body.measurementValue || 1;

  for (const range of ranges) {
    const minVal = parseFloat((range as any).minValue || '0');
    const maxVal = parseFloat((range as any).maxValue || '999999');
    if (measurementVal >= minVal && measurementVal <= maxVal) {
      matchedRange = range;
      break;
    }
  }

  if (!matchedRange && ranges.length > 0) {
    // Use closest range
    matchedRange = ranges[ranges.length - 1];
  }

  const parPrice = matchedRange ? parseFloat((matchedRange as any).parPrice || '0') : 0;
  const retailPrice = matchedRange ? parseFloat((matchedRange as any).retailPrice || '0') : 0;
  const yr1MarkupPct = matchedRange ? parseFloat((matchedRange as any).yr1MarkupPct || '0') : 0;
  const day30MarkupPct = matchedRange ? parseFloat((matchedRange as any).day30MarkupPct || '0') : 0;
  const todayDiscountPct = matchedRange ? parseFloat((matchedRange as any).todayDiscountPct || '0') : 0;

  const yr1Price = Math.round(retailPrice * (1 + yr1MarkupPct / 100) * 100) / 100;
  const day30Price = Math.round(retailPrice * (1 + day30MarkupPct / 100) * 100) / 100;
  const todayPrice = Math.round(retailPrice * (1 - todayDiscountPct / 100) * 100) / 100;

  // Default selling price is todayPrice * quantity
  const unitPrice = todayPrice;
  const sellingPrice = Math.round(unitPrice * body.quantity * 100) / 100;

  const lineId = createId();
  await db.insert(quoteLine).values({
    id: lineId,
    quoteId,
    companyId: authUser.companyId,
    productId: body.productId,
    productName: (prod as any).name,
    categoryName: null,
    tier: body.tier,
    quantity: body.quantity,
    measurementValue: body.measurementValue ? String(body.measurementValue) : null,
    measurementType: (prod as any).measurementType || null,
    parPrice: String(parPrice),
    retailPrice: String(retailPrice),
    yr1Price: String(yr1Price),
    day30Price: String(day30Price),
    todayPrice: String(todayPrice),
    unitPrice: String(unitPrice),
    sellingPrice: String(sellingPrice),
    priceRangeId: matchedRange ? (matchedRange as any).id : null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await recalculateQuoteTotals(quoteId);

  return c.json({
    lineId,
    unitPrice,
    sellingPrice,
    parPrice,
    retailPrice,
    yr1Price,
    day30Price,
    todayPrice,
  }, 201);
});

// PUT /:id/lines/:lineId
const updateLineSchema = z.object({
  tier: z.enum(['good', 'better', 'best']).optional(),
  quantity: z.number().int().positive().optional(),
  measurementValue: z.number().optional().nullable(),
  sellingPrice: z.string().or(z.number()).transform(String).optional(),
});

app.put('/:id/lines/:lineId', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const lineId = c.req.param('lineId');
  const body = parseBody(updateLineSchema, await c.req.json());

  const [line] = await db
    .select()
    .from(quoteLine)
    .where(and(eq(quoteLine.id, lineId), eq(quoteLine.quoteId, quoteId)))
    .limit(1);

  if (!line) throw new NotFoundError('Quote line');

  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.tier !== undefined || body.measurementValue !== undefined || body.quantity !== undefined) {
    const newTier = body.tier || (line as any).tier;
    const newQty = body.quantity || (line as any).quantity;
    const newMeasurement = body.measurementValue !== undefined
      ? body.measurementValue
      : parseFloat((line as any).measurementValue || '1');

    // Re-lookup price range
    const ranges = await db
      .select()
      .from(priceRange)
      .where(
        and(
          eq(priceRange.productId, (line as any).productId),
          eq(priceRange.companyId, authUser.companyId),
          eq((priceRange as any).tier, newTier)
        )
      )
      .orderBy(asc(priceRange.minValue));

    let matchedRange = null;
    for (const range of ranges) {
      const minVal = parseFloat((range as any).minValue || '0');
      const maxVal = parseFloat((range as any).maxValue || '999999');
      if (newMeasurement >= minVal && newMeasurement <= maxVal) {
        matchedRange = range;
        break;
      }
    }
    if (!matchedRange && ranges.length > 0) {
      matchedRange = ranges[ranges.length - 1];
    }

    if (matchedRange) {
      const retailPrice = parseFloat((matchedRange as any).retailPrice || '0');
      const todayDiscountPct = parseFloat((matchedRange as any).todayDiscountPct || '0');
      const unitPrice = Math.round(retailPrice * (1 - todayDiscountPct / 100) * 100) / 100;

      updates.tier = newTier;
      updates.quantity = newQty;
      updates.measurementValue = newMeasurement ? String(newMeasurement) : null;
      updates.parPrice = (matchedRange as any).parPrice;
      updates.retailPrice = (matchedRange as any).retailPrice;
      updates.unitPrice = String(unitPrice);
      updates.sellingPrice = String(Math.round(unitPrice * newQty * 100) / 100);
      updates.priceRangeId = (matchedRange as any).id;
    } else {
      if (body.quantity) updates.quantity = body.quantity;
      if (body.tier) updates.tier = body.tier;
    }
  }

  if (body.sellingPrice !== undefined) {
    updates.sellingPrice = body.sellingPrice;
  }

  await db.update(quoteLine).set(updates).where(eq(quoteLine.id, lineId));
  await recalculateQuoteTotals(quoteId);

  return c.json({ message: 'Line updated' });
});

// DELETE /:id/lines/:lineId
app.delete('/:id/lines/:lineId', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const lineId = c.req.param('lineId');

  const [line] = await db
    .select()
    .from(quoteLine)
    .where(and(eq(quoteLine.id, lineId), eq(quoteLine.quoteId, quoteId)))
    .limit(1);

  if (!line) throw new NotFoundError('Quote line');

  // Delete associated addons
  await db.delete(quoteLineAddon).where(eq(quoteLineAddon.quoteLineId, lineId));
  await db.delete(quoteLine).where(eq(quoteLine.id, lineId));
  await recalculateQuoteTotals(quoteId);

  return c.json({ message: 'Line removed' });
});

// POST /:id/present
app.post('/:id/present', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  if ((q as any).status !== 'draft') {
    throw new ValidationError('Can only present quotes in draft status');
  }

  await db
    .update(quote)
    .set({ status: 'presented', presentedAt: new Date(), updatedAt: new Date() })
    .where(eq(quote.id, quoteId));

  await logAudit(db, authUser.companyId, authUser.userId, 'quote.presented', 'quote', quoteId, null, null);

  return c.json({ message: 'Quote presented' });
});

// POST /:id/adjust-price
const adjustPriceSchema = z.object({
  lineId: cuidSchema,
  adjustedPrice: z.number().positive(),
  reason: z.string().min(1).max(1000),
  managerPin: z.string().optional(),
});

app.post('/:id/adjust-price', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(adjustPriceSchema, await c.req.json());
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

  // Get the line
  const [line] = await db
    .select()
    .from(quoteLine)
    .where(and(eq(quoteLine.id, body.lineId), eq(quoteLine.quoteId, quoteId)))
    .limit(1);

  if (!line) throw new NotFoundError('Quote line');

  const lineData = line as any;
  const retailPrice = parseFloat(lineData.retailPrice || '0');
  const parPrice = parseFloat(lineData.parPrice || '0');

  // Check guardrails
  const [guardrail] = await db
    .select()
    .from(pricingGuardrail)
    .where(
      and(
        eq(pricingGuardrail.productId, lineData.productId),
        eq(pricingGuardrail.companyId, authUser.companyId)
      )
    )
    .limit(1);

  if (guardrail) {
    const floorPricePct = parseFloat((guardrail as any).floorPricePct || '0');
    const floorPrice = retailPrice * (floorPricePct / 100);
    if (body.adjustedPrice < floorPrice) {
      return c.json(
        { error: `Price cannot be below floor price of $${floorPrice.toFixed(2)}` },
        400
      );
    }

    const managerApprovalPct = parseFloat((guardrail as any).managerApprovalPct || '0');
    const managerThreshold = retailPrice * (managerApprovalPct / 100);

    // Check rep discount authority
    const discountPct = ((retailPrice - body.adjustedPrice) / retailPrice) * 100;
    if (discountPct > authUser.maxDiscountPct) {
      // Requires manager approval
      if (!body.managerPin) {
        return c.json(
          {
            error: 'Discount exceeds your authority. Manager PIN required.',
            requiresManagerPin: true,
            discountPct: Math.round(discountPct * 100) / 100,
            maxDiscountPct: authUser.maxDiscountPct,
          },
          403
        );
      }

      // Verify manager pin against manager/admin repProfiles
      const managers = await db
        .select()
        .from(repProfile)
        .where(
          and(
            eq(repProfile.companyId, authUser.companyId),
            or(
              eq((repProfile as any).role, 'manager'),
              eq((repProfile as any).role, 'admin')
            )
          )
        );

      let pinValid = false;
      for (const mgr of managers) {
        const mgrData = mgr as any;
        if (mgrData.managerPin) {
          const pinMatch = await Bun.password.verify(body.managerPin, mgrData.managerPin);
          if (pinMatch) {
            pinValid = true;
            break;
          }
        }
      }

      if (!pinValid) {
        return c.json({ error: 'Invalid manager PIN' }, 403);
      }
    }
  }

  // Record adjustment
  const adjustmentId = createId();
  const oldPrice = parseFloat(lineData.sellingPrice || '0');
  await db.insert(quotePriceAdjustment).values({
    id: adjustmentId,
    quoteId,
    quoteLineId: body.lineId,
    companyId: authUser.companyId,
    adjustedBy: authUser.userId,
    oldPrice: String(oldPrice),
    newPrice: String(body.adjustedPrice),
    reason: body.reason,
    managerApproved: !!body.managerPin,
    createdAt: new Date(),
  });

  // Update line selling price
  await db
    .update(quoteLine)
    .set({ sellingPrice: String(body.adjustedPrice), updatedAt: new Date() })
    .where(eq(quoteLine.id, body.lineId));

  await recalculateQuoteTotals(quoteId);

  await logAudit(
    db,
    authUser.companyId,
    authUser.userId,
    'quote.price_adjusted',
    'quoteLine',
    body.lineId,
    { sellingPrice: oldPrice },
    { sellingPrice: body.adjustedPrice, reason: body.reason },
    ipAddress
  );

  return c.json({ message: 'Price adjusted', adjustmentId });
});

// POST /:id/apply-promotion
const applyPromotionSchema = z.object({
  promoCode: z.string().min(1),
});

app.post('/:id/apply-promotion', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(applyPromotionSchema, await c.req.json());

  const [promo] = await db
    .select()
    .from(promotion)
    .where(
      and(
        eq(promotion.companyId, authUser.companyId),
        eq((promotion as any).code, body.promoCode),
        eq((promotion as any).isActive, true)
      )
    )
    .limit(1);

  if (!promo) {
    return c.json({ error: 'Invalid or expired promotion code' }, 400);
  }

  const promoData = promo as any;
  const now = new Date();
  if (promoData.startDate && new Date(promoData.startDate) > now) {
    return c.json({ error: 'Promotion has not started yet' }, 400);
  }
  if (promoData.endDate && new Date(promoData.endDate) < now) {
    return c.json({ error: 'Promotion has expired' }, 400);
  }

  // Apply discount to quote
  const [q] = await db.select().from(quote).where(eq(quote.id, quoteId)).limit(1);
  if (!q) throw new NotFoundError('Quote');

  const currentTotal = parseFloat((q as any).subtotal || '0');
  let discount = 0;

  if (promoData.discountType === 'percentage') {
    discount = currentTotal * (parseFloat(promoData.discountValue || '0') / 100);
  } else if (promoData.discountType === 'fixed') {
    discount = parseFloat(promoData.discountValue || '0');
  }

  discount = Math.min(discount, currentTotal);

  await db
    .update(quote)
    .set({
      promotionId: promoData.id,
      discountAmount: String(Math.round(discount * 100) / 100),
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));

  await recalculateQuoteTotals(quoteId);

  return c.json({
    message: 'Promotion applied',
    discount: Math.round(discount * 100) / 100,
    promotionName: promoData.name,
  });
});

// POST /:id/sign
const signQuoteSchema = z.object({
  customerSignatureSvg: z.string().min(1),
  repSignatureSvg: z.string().min(1),
  contractTemplateId: cuidSchema,
  customerIp: z.string().optional(),
  deviceFingerprint: z.string().optional(),
});

app.post('/:id/sign', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(signQuoteSchema, await c.req.json());
  const ipAddress = body.customerIp || c.req.header('x-forwarded-for') || 'unknown';

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  const quoteData = q as any;

  if (quoteData.status !== 'presented' && quoteData.status !== 'draft') {
    throw new ValidationError('Quote must be in presented or draft status to sign');
  }

  // Get contract template
  const [template] = await db
    .select()
    .from(contractTemplate)
    .where(eq(contractTemplate.id, body.contractTemplateId))
    .limit(1);

  if (!template) throw new NotFoundError('Contract template');

  // Populate template with quote data
  let contractText = (template as any).content || '';
  contractText = contractText
    .replace(/\{\{customerName\}\}/g, `${quoteData.customerFirstName} ${quoteData.customerLastName}`)
    .replace(/\{\{customerAddress\}\}/g, quoteData.customerAddress || '')
    .replace(/\{\{customerCity\}\}/g, quoteData.customerCity || '')
    .replace(/\{\{customerState\}\}/g, quoteData.customerState || '')
    .replace(/\{\{customerZip\}\}/g, quoteData.customerZip || '')
    .replace(/\{\{quoteNumber\}\}/g, quoteData.quoteNumber || '')
    .replace(/\{\{totalPrice\}\}/g, `$${parseFloat(quoteData.totalPrice || '0').toFixed(2)}`)
    .replace(/\{\{date\}\}/g, new Date().toLocaleDateString('en-US'))
    .replace(/\{\{companyName\}\}/g, authUser.companyId);

  // Hash the document
  const documentHash = crypto
    .createHash('sha256')
    .update(contractText + body.customerSignatureSvg + body.repSignatureSvg)
    .digest('hex');

  // Create contract record
  const contractId = createId();
  const signedAt = new Date();

  await db.insert(quoteContract).values({
    id: contractId,
    quoteId,
    companyId: authUser.companyId,
    contractTemplateId: body.contractTemplateId,
    contractText,
    customerSignatureSvg: body.customerSignatureSvg,
    repSignatureSvg: body.repSignatureSvg,
    documentHash,
    customerIp: ipAddress,
    deviceFingerprint: body.deviceFingerprint || null,
    signedAt,
    createdAt: new Date(),
  });

  // Calculate rescission window (3 business days)
  const rescissionEndDate = new Date(signedAt);
  let businessDays = 0;
  while (businessDays < 3) {
    rescissionEndDate.setDate(rescissionEndDate.getDate() + 1);
    const dayOfWeek = rescissionEndDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }

  // Update quote status
  await db
    .update(quote)
    .set({
      status: 'signed',
      signedAt,
      rescissionEndDate,
      contractId,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));

  // Create commission record
  if (authUser.repProfileId) {
    const [rep] = await db
      .select()
      .from(repProfile)
      .where(eq(repProfile.id, authUser.repProfileId))
      .limit(1);

    if (rep) {
      const repData = rep as any;
      const commResult = calculateCommission(
        {
          id: quoteId,
          companyId: authUser.companyId,
          repId: authUser.repProfileId,
          totalPrice: parseFloat(quoteData.totalPrice || '0'),
          subtotal: parseFloat(quoteData.subtotal || '0'),
        },
        {
          id: repData.id,
          userId: repData.userId,
          commissionBasePct: parseFloat(repData.commissionBasePct || '0'),
          commissionBonusPct: parseFloat(repData.commissionBonusPct || '0'),
        }
      );

      await createCommissionRecord(db, {
        companyId: authUser.companyId,
        repProfileId: authUser.repProfileId,
        quoteId,
        baseAmount: commResult.baseCommission,
        bonusAmount: commResult.bonusCommission,
        totalAmount: commResult.totalCommission,
        parPriceSnapshot: parseFloat(quoteData.subtotal || '0'),
        sellingPriceSnapshot: parseFloat(quoteData.subtotal || '0'),
      });
    }
  }

  await logAudit(
    db,
    authUser.companyId,
    authUser.userId,
    'quote.signed',
    'quote',
    quoteId,
    null,
    { documentHash, contractId },
    ipAddress
  );

  return c.json({
    message: 'Quote signed',
    contractId,
    documentHash,
    rescissionEndDate,
  });
});

// POST /:id/collect-deposit
const collectDepositSchema = z.object({
  amount: z.number().positive(),
  method: z.string().min(1).max(100),
});

app.post('/:id/collect-deposit', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(collectDepositSchema, await c.req.json());

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');

  await db
    .update(quote)
    .set({
      depositAmount: String(body.amount),
      depositPaidAt: new Date(),
      depositMethod: body.method,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId));

  await logAudit(db, authUser.companyId, authUser.userId, 'quote.deposit_collected', 'quote', quoteId, null, {
    amount: body.amount,
    method: body.method,
  });

  return c.json({ message: 'Deposit collected' });
});

// POST /:id/complete
app.post('/:id/complete', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  if ((q as any).status !== 'signed') {
    throw new ValidationError('Can only complete signed quotes');
  }

  await db
    .update(quote)
    .set({ status: 'closed', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(quote.id, quoteId));

  await logAudit(db, authUser.companyId, authUser.userId, 'quote.completed', 'quote', quoteId, null, null);

  return c.json({ message: 'Quote completed' });
});

// POST /:id/cancel
app.post('/:id/cancel', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  const quoteData = q as any;

  // Check rescission window if signed
  if (quoteData.status === 'signed') {
    const now = new Date();
    if (quoteData.rescissionEndDate && now > new Date(quoteData.rescissionEndDate)) {
      throw new ValidationError('Rescission window has expired. Cannot cancel.');
    }
  } else if (quoteData.status !== 'draft' && quoteData.status !== 'presented') {
    throw new ValidationError('Can only cancel draft, presented, or signed (within rescission) quotes');
  }

  await db
    .update(quote)
    .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(quote.id, quoteId));

  // Cancel commission if exists
  const commissions = await db
    .select()
    .from(commissionRecord)
    .where(eq(commissionRecord.quoteId, quoteId));

  for (const comm of commissions) {
    await db
      .update(commissionRecord)
      .set({ cancelledAt: new Date() })
      .where(eq(commissionRecord.id, comm.id));
  }

  await logAudit(db, authUser.companyId, authUser.userId, 'quote.cancelled', 'quote', quoteId, null, null);

  return c.json({ message: 'Quote cancelled' });
});

// POST /:id/sync-to-crm
app.post('/:id/sync-to-crm', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const CRM_API_URL = process.env.CRM_API_URL;

  if (!CRM_API_URL) {
    return c.json({ error: 'CRM integration not configured' }, 400);
  }

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');

  const lines = await db
    .select()
    .from(quoteLine)
    .where(eq(quoteLine.quoteId, quoteId));

  try {
    const response = await fetch(`${CRM_API_URL}/api/quotes/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRM_API_KEY || ''}`,
      },
      body: JSON.stringify({ quote: q, lines }),
    });

    if (!response.ok) {
      throw new Error(`CRM sync failed: ${response.status}`);
    }

    await logAudit(db, authUser.companyId, authUser.userId, 'quote.synced_to_crm', 'quote', quoteId, null, null);

    return c.json({ message: 'Quote synced to CRM' });
  } catch (err) {
    logger.error('CRM sync failed', { error: (err as Error).message, quoteId });
    return c.json({ error: 'CRM sync failed', details: (err as Error).message }, 500);
  }
});

// POST /:id/send-customer-link
const sendLinkSchema = z.object({
  method: z.enum(['email', 'sms']),
});

app.post('/:id/send-customer-link', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');
  const body = parseBody(sendLinkSchema, await c.req.json());

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');
  const quoteData = q as any;

  const customerUrl = `${process.env.PUBLIC_URL || 'https://app.example.com'}/quote/${quoteData.customerToken}`;

  // In production, integrate with email/SMS service
  logger.info('Customer link generated', {
    quoteId,
    method: body.method,
    url: customerUrl,
  });

  return c.json({
    message: `Customer link ${body.method === 'email' ? 'emailed' : 'texted'}`,
    customerUrl,
  });
});

// GET /:id/pdf
app.get('/:id/pdf', authenticate, async (c) => {
  const authUser = c.get('user');
  const quoteId = c.req.param('id');

  const [q] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.companyId, authUser.companyId)))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');

  const lines = await db
    .select()
    .from(quoteLine)
    .where(eq(quoteLine.quoteId, quoteId))
    .orderBy(asc((quoteLine as any).sortOrder));

  // Get addons
  const allAddons: any[] = [];
  for (const line of lines) {
    const lineAddons = await db
      .select()
      .from(quoteLineAddon)
      .where(eq(quoteLineAddon.quoteLineId, line.id));
    allAddons.push(...lineAddons);
  }

  // Get contract
  let contractData = null;
  const [contract] = await db
    .select()
    .from(quoteContract)
    .where(eq(quoteContract.quoteId, quoteId))
    .limit(1);
  if (contract) contractData = contract as any;

  // Get company
  const [comp] = await db
    .select()
    .from(company)
    .where(eq(company.id, authUser.companyId))
    .limit(1);

  const compData = (comp as any) || { name: 'Company' };

  const quoteData = q as any;
  const pdf = await generateQuotePdf(
    {
      id: quoteData.id,
      quoteNumber: quoteData.quoteNumber,
      customerFirstName: quoteData.customerFirstName,
      customerLastName: quoteData.customerLastName,
      customerEmail: quoteData.customerEmail,
      customerPhone: quoteData.customerPhone,
      customerAddress: quoteData.customerAddress,
      customerCity: quoteData.customerCity,
      customerState: quoteData.customerState,
      customerZip: quoteData.customerZip,
      subtotal: parseFloat(quoteData.subtotal || '0'),
      taxAmount: parseFloat(quoteData.taxAmount || '0'),
      totalPrice: parseFloat(quoteData.totalPrice || '0'),
      depositAmount: quoteData.depositAmount ? parseFloat(quoteData.depositAmount) : null,
      notes: quoteData.notes,
      presentedAt: quoteData.presentedAt,
      signedAt: quoteData.signedAt,
      expiresAt: quoteData.expiresAt,
    },
    lines.map((l: any) => ({
      productName: l.productName || 'Product',
      tier: l.tier || 'good',
      quantity: l.quantity || 1,
      measurementValue: l.measurementValue ? parseFloat(l.measurementValue) : null,
      measurementType: l.measurementType,
      unitPrice: parseFloat(l.unitPrice || '0'),
      sellingPrice: parseFloat(l.sellingPrice || '0'),
    })),
    allAddons.map((a: any) => ({
      name: a.name || 'Addon',
      price: parseFloat(a.price || '0'),
      quantity: a.quantity || 1,
    })),
    contractData
      ? {
          contractText: contractData.contractText || '',
          customerSignatureSvg: contractData.customerSignatureSvg,
          repSignatureSvg: contractData.repSignatureSvg,
          signedAt: contractData.signedAt,
        }
      : null,
    {
      name: compData.name || 'Company',
      address: compData.address,
      phone: compData.phone,
      email: compData.email,
      licenseNumber: compData.licenseNumber,
    }
  );

  c.header('Content-Type', 'application/pdf');
  c.header('Content-Disposition', `inline; filename="quote-${quoteData.quoteNumber || quoteId}.pdf"`);
  return c.body(pdf);
});

// GET /customer/:token — PUBLIC (no auth)
app.get('/customer/:token', async (c) => {
  const token = c.req.param('token');

  const [q] = await db
    .select()
    .from(quote)
    .where(eq((quote as any).customerToken, token))
    .limit(1);

  if (!q) throw new NotFoundError('Quote');

  const quoteData = q as any;

  // Check expiration
  if (quoteData.expiresAt && new Date(quoteData.expiresAt) < new Date()) {
    return c.json({ error: 'This quote has expired' }, 410);
  }

  const lines = await db
    .select()
    .from(quoteLine)
    .where(eq(quoteLine.quoteId, quoteData.id))
    .orderBy(asc((quoteLine as any).sortOrder));

  // Get addons for each line
  const linesWithAddons = [];
  for (const line of lines) {
    const lineAddons = await db
      .select()
      .from(quoteLineAddon)
      .where(eq(quoteLineAddon.quoteLineId, line.id));

    const l = line as any;
    linesWithAddons.push({
      id: l.id,
      productName: l.productName,
      tier: l.tier,
      quantity: l.quantity,
      measurementValue: l.measurementValue,
      measurementType: l.measurementType,
      // Never expose par prices to customer
      unitPrice: parseFloat(l.unitPrice || '0'),
      sellingPrice: parseFloat(l.sellingPrice || '0'),
      addons: lineAddons.map((a: any) => ({
        name: a.name,
        price: parseFloat(a.price || '0'),
        quantity: a.quantity || 1,
      })),
    });
  }

  // Get company info
  const [comp] = await db
    .select()
    .from(company)
    .where(eq(company.id, quoteData.companyId))
    .limit(1);

  return c.json({
    quote: {
      id: quoteData.id,
      quoteNumber: quoteData.quoteNumber,
      customerFirstName: quoteData.customerFirstName,
      customerLastName: quoteData.customerLastName,
      status: quoteData.status,
      subtotal: parseFloat(quoteData.subtotal || '0'),
      taxAmount: parseFloat(quoteData.taxAmount || '0'),
      totalPrice: parseFloat(quoteData.totalPrice || '0'),
      depositAmount: quoteData.depositAmount ? parseFloat(quoteData.depositAmount) : null,
      notes: quoteData.notes,
      expiresAt: quoteData.expiresAt,
      presentedAt: quoteData.presentedAt,
    },
    lines: linesWithAddons,
    company: comp
      ? {
          name: (comp as any).name,
          phone: (comp as any).phone,
          email: (comp as any).email,
          logoUrl: (comp as any).logoUrl,
        }
      : null,
  });
});

export default app;
