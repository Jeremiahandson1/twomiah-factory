import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { product, company, order, orderItem, contact } from '../../db/schema.ts'
import { eq, and, asc, sql } from 'drizzle-orm'

// Cannabis purchase limit: 2.5 oz = 70.87g
const PURCHASE_LIMIT_GRAMS = 70.87
const CANNABIS_TAX_RATE = 0.15 // 15% cannabis excise tax
const SALES_TAX_RATE = 0.0875 // state + local sales tax

const app = new Hono()

// In-memory cache for menu responses
const menuCache = new Map<string, { data: any; expiresAt: number }>()
const CACHE_TTL_MS = 60_000 // 60 seconds

function getCached(key: string) {
  const entry = menuCache.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.data
  menuCache.delete(key)
  return null
}

function setCache(key: string, data: any) {
  menuCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

// Public menu — NO auth required
// Requires company slug as query param or subdomain
app.get('/', async (c) => {
  const slug = c.req.query('slug') || c.req.header('x-company-slug')
  if (!slug) return c.json({ error: 'Company slug is required' }, 400)

  const cacheKey = `menu:${slug}`
  const cached = getCached(cacheKey)
  if (cached) return c.json(cached)

  // Resolve company
  const [foundCompany] = await db.select({ id: company.id, name: company.name, logo: company.logo, primaryColor: company.primaryColor })
    .from(company).where(eq(company.slug, slug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Fetch visible, active products
  const products = await db.select().from(product)
    .where(and(
      eq(product.companyId, foundCompany.id),
      eq(product.active, true),
      eq(product.visible, true),
    ))
    .orderBy(asc(product.menuOrder), asc(product.name))

  // Group by category
  const categories: Record<string, any[]> = {}
  for (const prod of products) {
    const cat = (prod as any).category || 'other'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push({
      id: prod.id,
      name: prod.name,
      slug: prod.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: prod.description,
      brand: (prod as any).brand,
      strain: (prod as any).strain,
      strainType: (prod as any).strainType,
      thcPercent: (prod as any).thcPercent,
      cbdPercent: (prod as any).cbdPercent,
      weight: (prod as any).weight,
      weightUnit: (prod as any).weightUnit,
      price: prod.price,
      imageUrl: (prod as any).imageUrl,
      images: (prod as any).images,
      inStock: (prod as any).trackInventory ? Number(prod.stockQuantity) > 0 : true,
      tags: (prod as any).tags,
    })
  }

  // Category display order
  const categoryOrder = ['flower', 'pre_roll', 'edible', 'concentrate', 'vape', 'tincture', 'topical', 'accessory', 'apparel', 'other']
  const categoryLabels: Record<string, string> = {
    flower: 'Flower',
    pre_roll: 'Pre-Rolls',
    edible: 'Edibles',
    concentrate: 'Concentrates',
    vape: 'Vape',
    tincture: 'Tinctures',
    topical: 'Topicals',
    accessory: 'Accessories',
    apparel: 'Apparel',
    other: 'Other',
  }

  const menu = categoryOrder
    .filter(cat => categories[cat]?.length > 0)
    .map(cat => ({
      key: cat,
      label: categoryLabels[cat] || cat,
      products: categories[cat],
    }))

  const response = {
    company: foundCompany,
    menu,
    totalProducts: products.length,
  }

  setCache(cacheKey, response)
  return c.json(response)
})

// Public single product detail — NO auth
app.get('/:slug', async (c) => {
  const companySlug = c.req.query('slug') || c.req.header('x-company-slug')
  if (!companySlug) return c.json({ error: 'Company slug is required' }, 400)

  const productSlug = c.req.param('slug')

  const [foundCompany] = await db.select({ id: company.id })
    .from(company).where(eq(company.slug, companySlug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Match by slug-ified name
  const products = await db.select().from(product)
    .where(and(
      eq(product.companyId, foundCompany.id),
      eq(product.active, true),
      eq(product.visible, true),
    ))

  const found = products.find(p =>
    p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === productSlug
  )

  if (!found) return c.json({ error: 'Product not found' }, 404)

  return c.json({
    id: found.id,
    name: found.name,
    description: found.description,
    sku: found.sku,
    category: found.category,
    brand: (found as any).brand,
    strain: (found as any).strain,
    strainType: (found as any).strainType,
    thcPercent: (found as any).thcPercent,
    cbdPercent: (found as any).cbdPercent,
    weight: (found as any).weight,
    weightUnit: (found as any).weightUnit,
    price: found.price,
    imageUrl: (found as any).imageUrl,
    images: (found as any).images,
    inStock: (found as any).trackInventory ? Number(found.stockQuantity) > 0 : true,
    tags: (found as any).tags,
    labResults: (found as any).labResults,
  })
})

// Public order submission — NO auth required
app.post('/order', async (c) => {
  const slug = c.req.query('slug') || c.req.header('x-company-slug')
  if (!slug) return c.json({ error: 'Company slug is required' }, 400)

  const orderSchema = z.object({
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().int().min(1),
    })).min(1),
    customerName: z.string().min(1),
    customerPhone: z.string().min(1),
    customerEmail: z.string().email().optional(),
    orderType: z.enum(['pickup', 'delivery']),
    pickupTime: z.string().optional(),
    deliveryAddress: z.string().optional(),
    deliveryNotes: z.string().optional(),
    notes: z.string().optional(),
  })

  let data: z.infer<typeof orderSchema>
  try {
    data = orderSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Delivery orders require an address
  if (data.orderType === 'delivery' && !data.deliveryAddress) {
    return c.json({ error: 'Delivery address is required for delivery orders' }, 400)
  }

  // Resolve company
  const [foundCompany] = await db.select({ id: company.id, name: company.name })
    .from(company).where(eq(company.slug, slug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Fetch all requested products
  const productIds = data.items.map(i => i.productId)
  const products = await db.select().from(product)
    .where(and(eq(product.companyId, foundCompany.id)))

  const productMap = new Map(products.filter(p => productIds.includes(p.id)).map(p => [p.id, p]))

  // Validate products and calculate totals
  let totalWeightGrams = 0
  let subtotal = 0
  const resolvedItems: any[] = []

  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)
    if (!prod.active) return c.json({ error: `Product is not available: ${prod.name}` }, 400)
    if (!prod.visible) return c.json({ error: `Product is not available: ${prod.name}` }, 400)

    // Check stock
    if (prod.trackInventory && Number(prod.stockQuantity) < item.quantity) {
      return c.json({ error: `Insufficient stock for ${prod.name}` }, 400)
    }

    // Track cannabis weight for purchase limit
    const isCannabis = ['flower', 'pre_roll', 'edible', 'concentrate', 'vape', 'tincture'].includes(prod.category as string)
    if (isCannabis && prod.weight) {
      const weightInGrams = prod.weightUnit === 'oz' ? Number(prod.weight) * 28.3495 : Number(prod.weight)
      totalWeightGrams += weightInGrams * item.quantity
    }

    const unitPrice = Number(prod.price)
    const lineTotal = unitPrice * item.quantity
    subtotal += lineTotal

    resolvedItems.push({
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      category: prod.category,
      quantity: item.quantity,
      unitPrice: String(unitPrice),
      lineTotal: String(lineTotal),
      weight: prod.weight,
      weightUnit: prod.weightUnit,
      taxCategory: prod.taxCategory,
    })
  }

  // Purchase limit validation (2.5 oz)
  if (totalWeightGrams > PURCHASE_LIMIT_GRAMS) {
    return c.json({
      error: `Purchase exceeds the 2.5oz cannabis limit (${(totalWeightGrams / 28.3495).toFixed(2)}oz requested)`,
      totalWeightOz: (totalWeightGrams / 28.3495).toFixed(2),
      limitOz: '2.5',
    }, 400)
  }

  // Calculate taxes
  const cannabisSubtotal = resolvedItems
    .filter(i => i.taxCategory === 'cannabis')
    .reduce((sum: number, i: any) => sum + Number(i.lineTotal), 0)

  const exciseTax = cannabisSubtotal * CANNABIS_TAX_RATE
  const salesTax = subtotal * SALES_TAX_RATE
  const totalTax = exciseTax + salesTax
  const grandTotal = subtotal + totalTax

  // Find or create contact by phone
  let contactId: string | null = null
  const [existingContact] = await db.select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.phone, data.customerPhone), eq(contact.companyId, foundCompany.id)))
    .limit(1)

  if (existingContact) {
    contactId = existingContact.id
  } else {
    const [newContact] = await db.insert(contact).values({
      name: data.customerName,
      phone: data.customerPhone,
      email: data.customerEmail || null,
      type: 'customer',
      source: 'online_order',
      companyId: foundCompany.id,
    } as any).returning()
    contactId = newContact.id
  }

  // Generate order number
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`

  // Create order in transaction
  const result = await db.transaction(async (tx) => {
    const [newOrder] = await tx.insert(order).values({
      number: orderNumber,
      type: data.orderType === 'pickup' ? 'pickup' : 'delivery',
      status: 'pending',
      contactId,
      customerName: data.customerName,
      subtotal: String(subtotal),
      exciseTax: String(exciseTax),
      salesTax: String(salesTax),
      totalTax: String(totalTax),
      total: String(grandTotal),
      totalWeightGrams: String(totalWeightGrams),
      notes: data.notes,
      pickupTime: data.pickupTime ? new Date(data.pickupTime) : null,
      deliveryAddress: data.deliveryAddress,
      deliveryNotes: data.deliveryNotes,
      companyId: foundCompany.id,
    } as any).returning()

    // Insert order items
    for (const item of resolvedItems) {
      await tx.insert(orderItem).values({
        orderId: newOrder.id,
        ...item,
        companyId: foundCompany.id,
      } as any)
    }

    return newOrder
  })

  return c.json({
    orderNumber,
    subtotal: subtotal.toFixed(2),
    exciseTax: exciseTax.toFixed(2),
    salesTax: salesTax.toFixed(2),
    totalTax: totalTax.toFixed(2),
    total: grandTotal.toFixed(2),
    status: 'pending',
    type: data.orderType,
    itemCount: data.items.length,
  }, 201)
})

export default app
