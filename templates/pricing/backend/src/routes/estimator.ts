import { Hono } from 'hono'
import { db } from '../../db/index'
import {
  estimatorProduct,
  estimatorMaterialTier,
  estimatorAddon,
  pitchMultiplier,
  estimate,
  estimateContract,
} from '../../db/schema-estimator'
import { eq, and, desc, sql } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth'
import { calculateEstimate, type MeasurementInput, type EstimateLineItem } from '../services/estimatorEngine'
import { createHash } from 'crypto'
import { createId } from '@paralleldrive/cuid2'

const app = new Hono()

// ─── Rep Routes (authenticated) ──────────────────────────────────────

// GET /products — list active estimator products for tenant with tiers
app.get('/products', authenticate, async (c) => {
  const { tenantId } = c.get('auth')

  const products = await db.select().from(estimatorProduct)
    .where(and(eq(estimatorProduct.tenantId, tenantId), eq(estimatorProduct.active, true)))
    .orderBy(estimatorProduct.sortOrder)

  // Load tiers for each product
  const result = await Promise.all(products.map(async (p) => {
    const tiers = await db.select().from(estimatorMaterialTier)
      .where(eq(estimatorMaterialTier.productId, p.id))
    return { ...p, tiers }
  }))

  return c.json({ products: result })
})

// GET /products/:id — single product with tiers, addons, pitch multipliers
app.get('/products/:id', authenticate, async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')

  const [prod] = await db.select().from(estimatorProduct)
    .where(and(eq(estimatorProduct.id, id), eq(estimatorProduct.tenantId, tenantId)))
    .limit(1)

  if (!prod) return c.json({ error: 'Product not found' }, 404)

  const [tiers, addons, pitchMultipliers] = await Promise.all([
    db.select().from(estimatorMaterialTier).where(eq(estimatorMaterialTier.productId, id)),
    db.select().from(estimatorAddon).where(eq(estimatorAddon.productId, id)).orderBy(estimatorAddon.sortOrder),
    prod.pitchAdjustable
      ? db.select().from(pitchMultiplier).where(eq(pitchMultiplier.tenantId, tenantId))
      : Promise.resolve([]),
  ])

  return c.json({ product: { ...prod, tiers, addons, pitchMultipliers } })
})

// POST /calculate — run estimate calculation
app.post('/calculate', authenticate, async (c) => {
  const { tenantId, role } = c.get('auth')
  const body = await c.req.json<{ items: MeasurementInput[]; tier: 'good' | 'better' | 'best' }>()

  if (!body.items?.length || !body.tier) {
    return c.json({ error: 'items and tier are required' }, 400)
  }

  const result = await calculateEstimate(body.items, tenantId, body.tier)

  // Strip parPrice from rep role responses
  if (role === 'rep') {
    result.lines = result.lines.map((line) => {
      const { parPrice, ...rest } = line
      return rest as EstimateLineItem
    })
  }

  return c.json(result)
})

// POST /estimates — create estimate
app.post('/estimates', authenticate, async (c) => {
  const { tenantId, userId, repId } = c.get('auth')
  const body = await c.req.json()

  const customerToken = createId()

  const [est] = await db.insert(estimate).values({
    tenantId,
    repId: repId || body.repId,
    customerName: body.customerName,
    customerEmail: body.customerEmail,
    customerPhone: body.customerPhone,
    customerAddress: body.customerAddress,
    customerState: body.customerState,
    referralSource: body.referralSource,
    referralName: body.referralName,
    status: 'draft',
    lineItems: body.lineItems || [],
    subtotal: body.subtotal,
    totalMaterials: body.totalMaterials,
    totalLabor: body.totalLabor,
    totalAddons: body.totalAddons,
    selectedTier: body.selectedTier,
    notes: body.notes,
    customerToken,
    offlineCreated: body.offlineCreated || false,
  }).returning()

  return c.json({ estimate: est }, 201)
})

// GET /estimates — list estimates
app.get('/estimates', authenticate, async (c) => {
  const { tenantId, role, repId } = c.get('auth')
  const status = c.req.query('status')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = (page - 1) * limit

  const conditions = [eq(estimate.tenantId, tenantId)]

  // Reps only see their own estimates
  if (role === 'rep' && repId) {
    conditions.push(eq(estimate.repId, repId))
  }

  if (status) {
    conditions.push(eq(estimate.status, status))
  }

  const [estimates, [{ count }]] = await Promise.all([
    db.select().from(estimate)
      .where(and(...conditions))
      .orderBy(desc(estimate.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(estimate)
      .where(and(...conditions)),
  ])

  return c.json({ estimates, total: Number(count), page, limit })
})

// GET /estimates/:id — single estimate
app.get('/estimates/:id', authenticate, async (c) => {
  const { tenantId, role, repId } = c.get('auth')
  const id = c.req.param('id')

  const conditions = [eq(estimate.id, id), eq(estimate.tenantId, tenantId)]
  if (role === 'rep' && repId) {
    conditions.push(eq(estimate.repId, repId))
  }

  const [est] = await db.select().from(estimate)
    .where(and(...conditions))
    .limit(1)

  if (!est) return c.json({ error: 'Estimate not found' }, 404)

  const contracts = await db.select().from(estimateContract)
    .where(eq(estimateContract.estimateId, id))

  return c.json({ estimate: { ...est, contracts } })
})

// PATCH /estimates/:id — update estimate
app.patch('/estimates/:id', authenticate, async (c) => {
  const { tenantId, role, repId } = c.get('auth')
  const id = c.req.param('id')
  const body = await c.req.json()

  const conditions = [eq(estimate.id, id), eq(estimate.tenantId, tenantId)]
  if (role === 'rep' && repId) {
    conditions.push(eq(estimate.repId, repId))
  }

  const [existing] = await db.select().from(estimate)
    .where(and(...conditions))
    .limit(1)

  if (!existing) return c.json({ error: 'Estimate not found' }, 404)

  const [updated] = await db.update(estimate)
    .set({
      customerName: body.customerName ?? existing.customerName,
      customerEmail: body.customerEmail ?? existing.customerEmail,
      customerPhone: body.customerPhone ?? existing.customerPhone,
      customerAddress: body.customerAddress ?? existing.customerAddress,
      customerState: body.customerState ?? existing.customerState,
      referralSource: body.referralSource ?? existing.referralSource,
      referralName: body.referralName ?? existing.referralName,
      lineItems: body.lineItems ?? existing.lineItems,
      subtotal: body.subtotal ?? existing.subtotal,
      totalMaterials: body.totalMaterials ?? existing.totalMaterials,
      totalLabor: body.totalLabor ?? existing.totalLabor,
      totalAddons: body.totalAddons ?? existing.totalAddons,
      selectedTier: body.selectedTier ?? existing.selectedTier,
      notes: body.notes ?? existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(estimate.id, id))
    .returning()

  return c.json({ estimate: updated })
})

// DELETE /estimates/:id — soft delete (set status to cancelled)
app.delete('/estimates/:id', authenticate, async (c) => {
  const { tenantId, role, repId } = c.get('auth')
  const id = c.req.param('id')

  const conditions = [eq(estimate.id, id), eq(estimate.tenantId, tenantId)]
  if (role === 'rep' && repId) {
    conditions.push(eq(estimate.repId, repId))
  }

  const [existing] = await db.select().from(estimate)
    .where(and(...conditions))
    .limit(1)

  if (!existing) return c.json({ error: 'Estimate not found' }, 404)

  const [updated] = await db.update(estimate)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(estimate.id, id))
    .returning()

  return c.json({ estimate: updated })
})

// POST /estimates/:id/present — mark as presented
app.post('/estimates/:id/present', authenticate, async (c) => {
  const { tenantId, role, repId } = c.get('auth')
  const id = c.req.param('id')

  const conditions = [eq(estimate.id, id), eq(estimate.tenantId, tenantId)]
  if (role === 'rep' && repId) {
    conditions.push(eq(estimate.repId, repId))
  }

  const [existing] = await db.select().from(estimate)
    .where(and(...conditions))
    .limit(1)

  if (!existing) return c.json({ error: 'Estimate not found' }, 404)

  const [updated] = await db.update(estimate)
    .set({ status: 'presented', presentedAt: new Date(), updatedAt: new Date() })
    .where(eq(estimate.id, id))
    .returning()

  return c.json({ estimate: updated })
})

// POST /estimates/:id/sign — capture signature
app.post('/estimates/:id/sign', authenticate, async (c) => {
  const { tenantId, role, repId } = c.get('auth')
  const id = c.req.param('id')
  const body = await c.req.json<{
    populatedHtml: string
    customerSignatureSvg: string
    customerIp: string
    customerDeviceFingerprint: string
    repSignatureSvg: string
    repIp: string
    contractTemplateId?: string
    rescissionDays?: number
  }>()

  const conditions = [eq(estimate.id, id), eq(estimate.tenantId, tenantId)]
  if (role === 'rep' && repId) {
    conditions.push(eq(estimate.repId, repId))
  }

  const [existing] = await db.select().from(estimate)
    .where(and(...conditions))
    .limit(1)

  if (!existing) return c.json({ error: 'Estimate not found' }, 404)

  // Generate document hash
  const hash = createHash('sha256').update(body.populatedHtml).digest('hex')

  // Calculate rescission window (default 3 business days)
  const rescissionDays = body.rescissionDays ?? 3
  const rescissionDate = new Date()
  rescissionDate.setDate(rescissionDate.getDate() + rescissionDays)

  const now = new Date()

  // Create contract record
  const [contract] = await db.insert(estimateContract).values({
    estimateId: id,
    contractTemplateId: body.contractTemplateId,
    populatedHtml: body.populatedHtml,
    documentHash: hash,
    customerSignatureSvg: body.customerSignatureSvg,
    customerSignedAt: now,
    customerIp: body.customerIp,
    customerDeviceFingerprint: body.customerDeviceFingerprint,
    repSignatureSvg: body.repSignatureSvg,
    repSignedAt: now,
    repIp: body.repIp,
    rescissionExpiresAt: rescissionDate,
  }).returning()

  // Update estimate status
  const [updated] = await db.update(estimate)
    .set({ status: 'signed', signedAt: now, updatedAt: now })
    .where(eq(estimate.id, id))
    .returning()

  // Create commission record if rep exists
  if (existing.repId && existing.subtotal) {
    try {
      const { createCommission } = await import('../services/commission')
      await createCommission({
        tenantId,
        repId: existing.repId,
        sourceType: 'estimate',
        sourceId: id,
        saleAmount: Number(existing.subtotal),
      })
    } catch (err) {
      console.error('Failed to create commission for estimate:', err)
    }
  }

  return c.json({ estimate: updated, contract })
})

// ─── Admin Routes ────────────────────────────────────────────────────

// GET /admin/products — list all estimator products
app.get('/admin/products', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')

  const products = await db.select().from(estimatorProduct)
    .where(eq(estimatorProduct.tenantId, tenantId))
    .orderBy(estimatorProduct.sortOrder)

  const result = await Promise.all(products.map(async (p) => {
    const [tiers, addons] = await Promise.all([
      db.select().from(estimatorMaterialTier).where(eq(estimatorMaterialTier.productId, p.id)),
      db.select().from(estimatorAddon).where(eq(estimatorAddon.productId, p.id)).orderBy(estimatorAddon.sortOrder),
    ])
    return { ...p, tiers, addons }
  }))

  return c.json({ products: result })
})

// POST /admin/products — create estimator product
app.post('/admin/products', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')
  const body = await c.req.json()

  const [prod] = await db.insert(estimatorProduct).values({
    tenantId,
    categoryId: body.categoryId,
    name: body.name,
    description: body.description,
    measurementUnit: body.measurementUnit,
    pitchAdjustable: body.pitchAdjustable ?? false,
    defaultWasteFactor: body.defaultWasteFactor ?? '1.10',
    laborRate: body.laborRate,
    laborUnit: body.laborUnit,
    setupFee: body.setupFee ?? '0',
    minimumCharge: body.minimumCharge ?? '0',
    retailMarkupPct: body.retailMarkupPct ?? '100',
    yr1MarkupPct: body.yr1MarkupPct ?? '20',
    day30MarkupPct: body.day30MarkupPct ?? '10',
    todayDiscountPct: body.todayDiscountPct ?? '10',
    sortOrder: body.sortOrder ?? 0,
    active: body.active ?? true,
  }).returning()

  return c.json({ product: prod }, 201)
})

// PATCH /admin/products/:id — update estimator product
app.patch('/admin/products/:id', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(estimatorProduct)
    .where(and(eq(estimatorProduct.id, id), eq(estimatorProduct.tenantId, tenantId)))
    .limit(1)

  if (!existing) return c.json({ error: 'Product not found' }, 404)

  const [updated] = await db.update(estimatorProduct)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(estimatorProduct.id, id))
    .returning()

  return c.json({ product: updated })
})

// DELETE /admin/products/:id — deactivate
app.delete('/admin/products/:id', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')

  const [existing] = await db.select().from(estimatorProduct)
    .where(and(eq(estimatorProduct.id, id), eq(estimatorProduct.tenantId, tenantId)))
    .limit(1)

  if (!existing) return c.json({ error: 'Product not found' }, 404)

  const [updated] = await db.update(estimatorProduct)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(estimatorProduct.id, id))
    .returning()

  return c.json({ product: updated })
})

// POST /admin/products/:id/tiers — set all 3 tiers
app.post('/admin/products/:id/tiers', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')
  const id = c.req.param('id')
  const body = await c.req.json<{ tiers: Array<{
    tier: string
    materialName: string
    materialCostPerUnit: string
    manufacturer?: string
    productLine?: string
    warrantyYears?: number
    features?: unknown[]
  }> }>()

  // Verify product belongs to tenant
  const [existing] = await db.select().from(estimatorProduct)
    .where(and(eq(estimatorProduct.id, id), eq(estimatorProduct.tenantId, tenantId)))
    .limit(1)

  if (!existing) return c.json({ error: 'Product not found' }, 404)

  // Delete existing tiers
  await db.delete(estimatorMaterialTier).where(eq(estimatorMaterialTier.productId, id))

  // Insert new tiers
  const tiers = await db.insert(estimatorMaterialTier).values(
    body.tiers.map((t) => ({
      productId: id,
      tier: t.tier,
      materialName: t.materialName,
      materialCostPerUnit: t.materialCostPerUnit,
      manufacturer: t.manufacturer,
      productLine: t.productLine,
      warrantyYears: t.warrantyYears,
      features: t.features ?? [],
    }))
  ).returning()

  return c.json({ tiers })
})

// PATCH /admin/tiers/:id — update single tier
app.patch('/admin/tiers/:id', authenticate, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(estimatorMaterialTier)
    .where(eq(estimatorMaterialTier.id, id))
    .limit(1)

  if (!existing) return c.json({ error: 'Tier not found' }, 404)

  const [updated] = await db.update(estimatorMaterialTier)
    .set(body)
    .where(eq(estimatorMaterialTier.id, id))
    .returning()

  return c.json({ tier: updated })
})

// GET /admin/pitch-multipliers — list for tenant
app.get('/admin/pitch-multipliers', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')

  const multipliers = await db.select().from(pitchMultiplier)
    .where(eq(pitchMultiplier.tenantId, tenantId))

  return c.json({ pitchMultipliers: multipliers })
})

// PUT /admin/pitch-multipliers — upsert full set
app.put('/admin/pitch-multipliers', authenticate, requireAdmin, async (c) => {
  const { tenantId } = c.get('auth')
  const body = await c.req.json<{ multipliers: Array<{ pitch: string; multiplier: string }> }>()

  // Delete all existing for tenant
  await db.delete(pitchMultiplier).where(eq(pitchMultiplier.tenantId, tenantId))

  // Insert new set
  const multipliers = body.multipliers.length > 0
    ? await db.insert(pitchMultiplier).values(
        body.multipliers.map((m) => ({
          tenantId,
          pitch: m.pitch,
          multiplier: m.multiplier,
        }))
      ).returning()
    : []

  return c.json({ pitchMultipliers: multipliers })
})

// POST /admin/addons — create addon
app.post('/admin/addons', authenticate, requireAdmin, async (c) => {
  const body = await c.req.json()

  const [addon] = await db.insert(estimatorAddon).values({
    productId: body.productId,
    name: body.name,
    description: body.description,
    pricingType: body.pricingType,
    price: body.price,
    unit: body.unit,
    defaultSelected: body.defaultSelected ?? false,
    sortOrder: body.sortOrder ?? 0,
  }).returning()

  return c.json({ addon }, 201)
})

// PATCH /admin/addons/:id — update addon
app.patch('/admin/addons/:id', authenticate, requireAdmin, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const [existing] = await db.select().from(estimatorAddon)
    .where(eq(estimatorAddon.id, id))
    .limit(1)

  if (!existing) return c.json({ error: 'Addon not found' }, 404)

  const [updated] = await db.update(estimatorAddon)
    .set(body)
    .where(eq(estimatorAddon.id, id))
    .returning()

  return c.json({ addon: updated })
})

// DELETE /admin/addons/:id — delete addon
app.delete('/admin/addons/:id', authenticate, requireAdmin, async (c) => {
  const id = c.req.param('id')

  const [existing] = await db.select().from(estimatorAddon)
    .where(eq(estimatorAddon.id, id))
    .limit(1)

  if (!existing) return c.json({ error: 'Addon not found' }, 404)

  await db.delete(estimatorAddon).where(eq(estimatorAddon.id, id))

  return c.json({ success: true })
})

export default app
