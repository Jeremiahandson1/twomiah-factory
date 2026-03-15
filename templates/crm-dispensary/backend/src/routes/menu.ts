import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { product, company } from '../../db/schema.ts'
import { eq, and, asc, sql } from 'drizzle-orm'

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

export default app
