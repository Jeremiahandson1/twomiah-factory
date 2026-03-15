import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { product } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, asc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  category: z.enum([
    'flower', 'pre_roll', 'edible', 'concentrate', 'vape',
    'tincture', 'topical', 'accessory', 'apparel', 'other',
  ]),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  strain: z.string().optional(),
  strainType: z.enum(['sativa', 'indica', 'hybrid', 'cbd', 'na']).optional(),
  thcPercent: z.number().min(0).max(100).optional(),
  cbdPercent: z.number().min(0).max(100).optional(),
  weight: z.number().optional(),
  weightUnit: z.enum(['g', 'oz', 'mg', 'ml', 'each']).default('g'),
  price: z.number().min(0),
  costPrice: z.number().min(0).optional(),
  taxCategory: z.enum(['cannabis', 'non_cannabis']).default('cannabis'),
  trackInventory: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  requiresIdCheck: z.boolean().default(true),
  requiresWeighing: z.boolean().default(false),
  visible: z.boolean().default(true),
  menuOrder: z.number().int().default(0),
  imageUrl: z.string().optional(),
  images: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  labResults: z.object({
    testedAt: z.string().optional(),
    lab: z.string().optional(),
    batchNumber: z.string().optional(),
    totalThc: z.number().optional(),
    totalCbd: z.number().optional(),
    terpenes: z.record(z.number()).optional(),
    contaminants: z.boolean().optional(),
    passed: z.boolean().optional(),
  }).optional(),
  metrcTag: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean().default(true),
})

// List products with filters
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const category = c.req.query('category')
  const search = c.req.query('search')
  const active = c.req.query('active')
  const lowStock = c.req.query('lowStock')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(product.companyId, currentUser.companyId)]
  if (category) conditions.push(eq(product.category, category))
  if (active !== undefined) conditions.push(eq(product.active, active === 'true'))
  if (search) {
    conditions.push(or(
      ilike(product.name, `%${search}%`),
      ilike(product.sku, `%${search}%`),
      ilike(product.brand, `%${search}%`),
      ilike(product.strain, `%${search}%`),
    )!)
  }
  if (lowStock === 'true') {
    conditions.push(sql`${product.stockQuantity} <= ${product.lowStockThreshold}`)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(product).where(where).orderBy(asc(product.category), asc(product.name)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(product).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Get single product
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [found] = await db.select().from(product)
    .where(and(eq(product.id, id), eq(product.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Product not found' }, 404)

  return c.json(found)
})

// Create product (manager+)
app.post('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const data = productSchema.parse(await c.req.json())

  const [created] = await db.insert(product).values({
    ...data,
    price: String(data.price),
    costPrice: data.costPrice != null ? String(data.costPrice) : undefined,
    companyId: currentUser.companyId,
  } as any).returning()

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'product',
    entityId: created.id,
    entityName: created.name,
    req: c.req,
  })

  return c.json(created, 201)
})

// Update product (manager+)
app.put('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = productSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(product)
    .where(and(eq(product.id, id), eq(product.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Product not found' }, 404)

  const updateData: any = { ...data, updatedAt: new Date() }
  if (data.price != null) updateData.price = String(data.price)
  if (data.costPrice != null) updateData.costPrice = String(data.costPrice)

  const [updated] = await db.update(product).set(updateData).where(eq(product.id, id)).returning()

  // Audit price changes specifically
  const changes = audit.diff(existing as any, updated as any)
  if (changes) {
    const isPriceChange = 'price' in changes || 'costPrice' in changes
    audit.log({
      action: audit.ACTIONS.UPDATE,
      entity: 'product',
      entityId: updated.id,
      entityName: updated.name,
      changes,
      metadata: isPriceChange ? { type: 'price_change' } : undefined,
      req: c.req,
    })
  }

  return c.json(updated)
})

// Delete product (manager+)
app.delete('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(product)
    .where(and(eq(product.id, id), eq(product.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Product not found' }, 404)

  await db.delete(product).where(eq(product.id, id))

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'product',
    entityId: existing.id,
    entityName: existing.name,
    req: c.req,
  })

  return c.body(null, 204)
})

// Adjust stock with reason
app.post('/:id/adjust-stock', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const adjustSchema = z.object({
    adjustment: z.number().int(),
    reason: z.enum(['received', 'sold', 'damaged', 'expired', 'audit', 'return', 'transfer', 'other']),
    notes: z.string().optional(),
    batchNumber: z.string().optional(),
  })
  const data = adjustSchema.parse(await c.req.json())

  const [existing] = await db.select().from(product)
    .where(and(eq(product.id, id), eq(product.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Product not found' }, 404)

  const oldQuantity = Number(existing.stockQuantity)
  const newQuantity = oldQuantity + data.adjustment
  if (newQuantity < 0) return c.json({ error: 'Stock cannot go below zero' }, 400)

  const [updated] = await db.update(product)
    .set({ stockQuantity: newQuantity, updatedAt: new Date() } as any)
    .where(eq(product.id, id))
    .returning()

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'product',
    entityId: id,
    entityName: existing.name,
    changes: { stockQuantity: { old: oldQuantity, new: newQuantity } },
    metadata: {
      type: 'inventory_adjustment',
      adjustment: data.adjustment,
      reason: data.reason,
      notes: data.notes,
      batchNumber: data.batchNumber,
    },
    req: c.req,
  })

  return c.json(updated)
})

// CSV import (manager+)
app.post('/import', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json()

  const importSchema = z.object({
    products: z.array(z.object({
      name: z.string().min(1),
      sku: z.string().optional(),
      category: z.string(),
      brand: z.string().optional(),
      strain: z.string().optional(),
      strainType: z.string().optional(),
      thcPercent: z.number().optional(),
      cbdPercent: z.number().optional(),
      price: z.number().min(0),
      costPrice: z.number().min(0).optional(),
      stockQuantity: z.number().int().min(0).default(0),
      weight: z.number().optional(),
      weightUnit: z.string().optional(),
      metrcTag: z.string().optional(),
    })),
  })
  const data = importSchema.parse(body)

  const results = { imported: 0, errors: [] as string[] }

  for (const item of data.products) {
    try {
      await db.insert(product).values({
        name: item.name,
        sku: item.sku,
        category: item.category,
        brand: item.brand,
        strain: item.strain,
        strainType: item.strainType,
        thcPercent: item.thcPercent != null ? String(item.thcPercent) : undefined,
        cbdPercent: item.cbdPercent != null ? String(item.cbdPercent) : undefined,
        price: String(item.price),
        costPrice: item.costPrice != null ? String(item.costPrice) : undefined,
        stockQuantity: item.stockQuantity,
        weight: item.weight != null ? String(item.weight) : undefined,
        weightUnit: item.weightUnit,
        metrcTag: item.metrcTag,
        companyId: currentUser.companyId,
      } as any)
      results.imported++
    } catch (err: any) {
      results.errors.push(`Failed to import "${item.name}": ${err.message}`)
    }
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'product',
    metadata: { type: 'csv_import', imported: results.imported, errors: results.errors.length },
    req: c.req,
  })

  return c.json(results)
})

export default app
