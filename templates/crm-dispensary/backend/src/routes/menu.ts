import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { product, company, order, orderItem, contact } from '../../db/schema.ts'
import { eq, and, asc, sql } from 'drizzle-orm'
import { isCannabisLine, resolvePurchaseLimitOz, GRAMS_PER_OZ, gramsText, cartCannabisGrams, overPurchaseLimit, uncountableCannabisLines, unweighedCannabisRefusal } from '../utils/cannabis.ts'
import { loadEquivalencyFactors } from '../services/equivalency.ts'

// Cannabis purchase limit: the company's configured/state limit (utils/cannabis.ts) — was a hardcoded 2.5 oz.
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

// Which shop this is.
//
// The slug exists because this router was written for a menu served across several shops. A
// tenant CRM has exactly one company in its own database, and its own order-ahead page has no
// slug to send — so every call from it was refused with "Company slug is required" and there was
// no customer-facing ordering path at all. When no slug is given and there is exactly one company
// here, that is the one. Where there is more than one, the slug is still required rather than
// guessed. (T45 H24)
async function resolveSlug(c: any): Promise<string | null> {
  const given = c.req.query('slug') || c.req.header('x-company-slug')
  if (given) return given
  // The shop this database was created for: the first company row in it. A tenant database is
  // one dispensary; a second row is QA debris or an enterprise import, and either way the seeded
  // shop is the oldest. "Exactly one row" was the first version of this and it was too strict —
  // the live test tenant carries two, so its own page was still told "Company slug is required".
  const rows = await db.select({ slug: company.slug })
    .from(company)
    .orderBy(asc(company.createdAt))
    .limit(1)
  return rows[0]?.slug || null
}

// These routes are public — a customer with no session — so requireEnabledFeature, which reads
// the signed-in user, cannot guard them. The switch is read off the resolved company instead.
// Public Menu is a core feature and browsing stays open where it is unset; taking an ORDER needs
// Order Ahead switched on, because a shop that has not turned online ordering on should not find
// orders arriving from it. (T45 H24)
const featureOn = (co: any, id: string) => {
  const list = (co?.enabledFeatures ?? co?.enabled_features) as unknown
  if (!Array.isArray(list)) return true // unset means nothing has been configured yet
  return list.includes(id)
}

// Public menu — NO auth required
// Requires company slug as query param or subdomain
app.get('/', async (c) => {
  const slug = await resolveSlug(c)
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

  // Category display order.
  //
  // This list was the WHOLE menu, not just its order — a category that was not on it did not sort
  // late, it disappeared. `merch`, `preroll`, `beverage`, `capsule`, `seed` and `clone` are all
  // real product categories in this product (schema.ts, and the CSV importer accepts every one of
  // them), and none of them was listed, so those products were on sale in the shop and absent from
  // the shop's own public menu. Known categories keep their order; anything else follows it under
  // its own name rather than vanishing. (T45 H24)
  const categoryOrder = [
    'flower', 'pre_roll', 'preroll', 'edible', 'beverage', 'capsule', 'concentrate', 'vape',
    'cartridge', 'tincture', 'topical', 'seed', 'clone', 'accessory', 'merch', 'apparel', 'other',
  ]
  const categoryLabels: Record<string, string> = {
    flower: 'Flower',
    pre_roll: 'Pre-Rolls',
    preroll: 'Pre-Rolls',
    edible: 'Edibles',
    beverage: 'Drinks',
    capsule: 'Capsules',
    concentrate: 'Concentrates',
    vape: 'Vape',
    cartridge: 'Cartridges',
    tincture: 'Tinctures',
    topical: 'Topicals',
    seed: 'Seeds',
    clone: 'Clones',
    accessory: 'Accessories',
    merch: 'Merch',
    apparel: 'Apparel',
    other: 'Other',
  }

  const titleCase = (key: string) =>
    key.split(/[_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const orderedKeys = [
    ...categoryOrder.filter(cat => categories[cat]?.length > 0),
    ...Object.keys(categories).filter(cat => !categoryOrder.includes(cat)).sort(),
  ]

  const menu = orderedKeys.map(cat => ({
    key: cat,
    label: categoryLabels[cat] || titleCase(cat),
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
  const companySlug = await resolveSlug(c)
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
  const slug = await resolveSlug(c)
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
  const [foundCompany] = await db.select({ id: company.id, name: company.name, taxRate: company.taxRate, exciseTaxRate: company.exciseTaxRate, purchaseLimitOz: company.purchaseLimitOz, state: company.state, enabledFeatures: company.enabledFeatures })
    .from(company).where(eq(company.slug, slug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  if (!featureOn(foundCompany, 'order_ahead')) {
    return c.json({ error: 'Online ordering is not switched on for this shop', code: 'FEATURE_NOT_ENABLED', feature: 'order_ahead' }, 403)
  }

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

    // Classification only. The WEIGHING is done once, below, by the same function the register and
    // the kiosk use — this loop used to add prod.weight by hand, which missed weight_grams entirely
    // (every seeded product counted as zero) and never applied the equivalency factors. (T34)
    const isCannabis = isCannabisLine(prod)

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
      // Persist the RESOLVED tax category (seeded products have tax_category NULL).
      taxCategory: isCannabis ? 'cannabis' : 'non_cannabis',
    })
  }

  // The SAME purchase limit as the register and the kiosk, through the same three helpers, so a
  // customer ordering online cannot buy what a budtender would have refused. (T34)
  const menuFactors = await loadEquivalencyFactors(foundCompany.id)
  const menuLines = data.items.map((i: any) => ({ product: productMap.get(i.productId), quantity: i.quantity }))
  const uncountable = uncountableCannabisLines(menuLines, menuFactors)
  if (uncountable.length) {
    const sample = menuLines.map((l: any) => l.product).find((pr: any) => pr && uncountable.includes(pr.name))
    return c.json(unweighedCannabisRefusal(uncountable, menuFactors, sample), 400)
  }
  totalWeightGrams = cartCannabisGrams(menuLines, menuFactors)
  const limitOz = resolvePurchaseLimitOz(foundCompany)
  const menuOver = overPurchaseLimit(totalWeightGrams, limitOz)
  if (menuOver) return c.json(menuOver, 400)

  // Calculate taxes
  const cannabisSubtotal = resolvedItems
    .filter(i => i.taxCategory === 'cannabis')
    .reduce((sum: number, i: any) => sum + Number(i.lineTotal), 0)

  // Use the rates configured in Settings so the public menu's totals match what the
  // in-store register charges (orders.ts). Fall back to the defaults only when unset.
  const exciseRate = foundCompany.exciseTaxRate != null && foundCompany.exciseTaxRate !== '' ? Number(foundCompany.exciseTaxRate) / 100 : CANNABIS_TAX_RATE
  const salesRate = foundCompany.taxRate != null && foundCompany.taxRate !== '' ? Number(foundCompany.taxRate) / 100 : SALES_TAX_RATE
  const exciseTax = cannabisSubtotal * (Number.isFinite(exciseRate) ? exciseRate : CANNABIS_TAX_RATE)
  const salesTax = subtotal * (Number.isFinite(salesRate) ? salesRate : SALES_TAX_RATE)
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
      totalWeightGrams: gramsText(totalWeightGrams),
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
