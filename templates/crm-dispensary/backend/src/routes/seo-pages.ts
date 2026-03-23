import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// ===== PUBLIC ROUTES (no auth) =====

// GET /sitemap — XML sitemap of all published product pages
app.get('/sitemap', async (c) => {
  const slug = c.req.query('slug') || c.req.header('x-company-slug')
  if (!slug) return c.json({ error: 'Company slug is required' }, 400)

  const companyResult = await db.execute(sql`
    SELECT id, name, custom_domain FROM company
    WHERE slug = ${slug}
    LIMIT 1
  `)
  const company = ((companyResult as any).rows || companyResult)?.[0]
  if (!company) return c.json({ error: 'Company not found' }, 404)

  const baseUrl = company.custom_domain
    ? `https://${company.custom_domain}`
    : `https://${slug}.twomiah.com`

  const pagesResult = await db.execute(sql`
    SELECT sp.slug, sp.updated_at
    FROM seo_product_pages sp
    WHERE sp.company_id = ${company.id} AND sp.is_published = true
    ORDER BY sp.updated_at DESC
  `)
  const pages = (pagesResult as any).rows || pagesResult

  const urls = pages.map((p: any) => {
    const lastmod = p.updated_at ? new Date(p.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    return `<url><loc>${baseUrl}/products/${p.slug}</loc><lastmod>${lastmod}</lastmod></url>`
  }).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`

  return c.text(xml, 200, { 'Content-Type': 'application/xml' })
})

// GET /product/:slug — Public individual product page data
app.get('/product/:slug', async (c) => {
  const companySlug = c.req.query('slug') || c.req.header('x-company-slug')
  if (!companySlug) return c.json({ error: 'Company slug is required' }, 400)
  const productSlug = c.req.param('slug')

  const companyResult = await db.execute(sql`
    SELECT id, name, logo, primary_color, custom_domain FROM company
    WHERE slug = ${companySlug}
    LIMIT 1
  `)
  const company = ((companyResult as any).rows || companyResult)?.[0]
  if (!company) return c.json({ error: 'Company not found' }, 404)

  const pageResult = await db.execute(sql`
    SELECT sp.*, p.name as product_name, p.description as product_description,
           p.price, p.category, p.brand, p.strain, p.strain_type,
           p.thc_percent, p.cbd_percent, p.weight, p.weight_unit,
           p.image_url, p.images, p.tags, p.lab_results,
           p.stock_quantity, p.track_inventory, p.active
    FROM seo_product_pages sp
    JOIN products p ON p.id = sp.product_id
    WHERE sp.slug = ${productSlug}
      AND sp.company_id = ${company.id}
      AND sp.is_published = true
    LIMIT 1
  `)
  const page = ((pageResult as any).rows || pageResult)?.[0]
  if (!page) return c.json({ error: 'Product page not found' }, 404)

  // Fetch related products (same category, excluding current)
  const relatedResult = await db.execute(sql`
    SELECT p.id, p.name, p.price, p.image_url, p.strain, p.strain_type, p.thc_percent, p.cbd_percent,
           sp.slug as seo_slug
    FROM products p
    LEFT JOIN seo_product_pages sp ON sp.product_id = p.id AND sp.is_published = true
    WHERE p.company_id = ${company.id}
      AND p.category = ${page.category}
      AND p.id != ${page.product_id}
      AND p.active = true AND p.visible = true
    ORDER BY RANDOM()
    LIMIT 6
  `)
  const related = (relatedResult as any).rows || relatedResult

  return c.json({
    product: {
      id: page.product_id,
      name: page.product_name,
      description: page.product_description,
      price: page.price,
      category: page.category,
      brand: page.brand,
      strain: page.strain,
      strainType: page.strain_type,
      thcPercent: page.thc_percent,
      cbdPercent: page.cbd_percent,
      weight: page.weight,
      weightUnit: page.weight_unit,
      imageUrl: page.image_url,
      images: page.images,
      tags: page.tags,
      labResults: page.lab_results,
      inStock: page.track_inventory ? Number(page.stock_quantity) > 0 : true,
    },
    seo: {
      metaTitle: page.meta_title,
      metaDescription: page.meta_description,
      ogImage: page.og_image,
      canonicalUrl: page.canonical_url,
      structuredData: page.structured_data,
      customContent: page.custom_content,
    },
    related,
    company: { id: company.id, name: company.name, logo: company.logo },
  })
})

// ===== AUTHENTICATED ROUTES =====
app.use('*', authenticate)

// GET /products — List SEO product pages (paginated)
app.get('/products', async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit
  const search = c.req.query('search')
  const published = c.req.query('published')

  let searchClause = sql``
  if (search) {
    searchClause = sql`AND (p.name ILIKE ${'%' + search + '%'} OR p.brand ILIKE ${'%' + search + '%'})`
  }
  let publishedClause = sql``
  if (published !== undefined) {
    publishedClause = sql`AND sp.is_published = ${published === 'true'}`
  }

  const dataResult = await db.execute(sql`
    SELECT sp.*, p.name as product_name, p.category, p.brand, p.strain, p.strain_type,
           p.price, p.image_url, p.stock_quantity
    FROM seo_product_pages sp
    JOIN products p ON p.id = sp.product_id
    WHERE sp.company_id = ${currentUser.companyId} ${searchClause} ${publishedClause}
    ORDER BY sp.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM seo_product_pages sp
    JOIN products p ON p.id = sp.product_id
    WHERE sp.company_id = ${currentUser.companyId} ${searchClause} ${publishedClause}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /products/generate — Auto-generate SEO pages for all products missing them
app.post('/products/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Get company info for meta titles
  const companyResult = await db.execute(sql`
    SELECT name, slug, custom_domain FROM company WHERE id = ${currentUser.companyId} LIMIT 1
  `)
  const company = ((companyResult as any).rows || companyResult)?.[0]
  if (!company) return c.json({ error: 'Company not found' }, 404)

  const baseUrl = company.custom_domain
    ? `https://${company.custom_domain}`
    : `https://${company.slug}.twomiah.com`

  // Find products without SEO pages
  const productsResult = await db.execute(sql`
    SELECT p.id, p.name, p.description, p.category, p.brand, p.strain, p.strain_type,
           p.thc_percent, p.cbd_percent, p.price, p.image_url, p.tags, p.weight, p.weight_unit
    FROM products p
    LEFT JOIN seo_product_pages sp ON sp.product_id = p.id AND sp.company_id = p.company_id
    WHERE p.company_id = ${currentUser.companyId}
      AND p.active = true
      AND sp.id IS NULL
  `)
  const products = (productsResult as any).rows || productsResult

  let generated = 0
  for (const prod of products) {
    const slug = `${prod.name}${prod.strain ? '-' + prod.strain : ''}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const strainLabel = prod.strain_type && prod.strain_type !== 'na'
      ? prod.strain_type.charAt(0).toUpperCase() + prod.strain_type.slice(1)
      : ''

    const metaTitle = strainLabel
      ? `${prod.name} - ${strainLabel} | ${company.name}`
      : `${prod.name} | ${company.name}`

    const effectsSnippet = prod.tags?.length
      ? ` Effects: ${prod.tags.slice(0, 3).join(', ')}.`
      : ''
    const metaDescription = prod.description
      ? `${prod.description.slice(0, 140)}${effectsSnippet}`
      : `${prod.name}${prod.strain ? ' (' + prod.strain + ')' : ''} available at ${company.name}.${effectsSnippet}`

    const canonicalUrl = `${baseUrl}/products/${slug}`

    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: prod.name,
      description: prod.description || metaDescription,
      brand: prod.brand ? { '@type': 'Brand', name: prod.brand } : undefined,
      image: prod.image_url || undefined,
      offers: {
        '@type': 'Offer',
        price: prod.price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
    }

    await db.execute(sql`
      INSERT INTO seo_product_pages(id, product_id, slug, meta_title, meta_description, og_image, canonical_url, structured_data, custom_content, is_published, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${prod.id}, ${slug}, ${metaTitle}, ${metaDescription}, ${prod.image_url || null}, ${canonicalUrl}, ${JSON.stringify(structuredData)}::jsonb, NULL, true, ${currentUser.companyId}, NOW(), NOW())
    `)
    generated++
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'seo_product_page',
    metadata: { type: 'bulk_generate', generated, totalProducts: products.length },
    req: c.req,
  })

  return c.json({ generated, alreadyExisted: 0, message: `Generated ${generated} SEO pages` })
})

// PUT /products/:id — Update SEO fields
app.put('/products/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const updateSchema = z.object({
    metaTitle: z.string().min(1).optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
    customContent: z.string().optional(),
    isPublished: z.boolean().optional(),
  })
  const data = updateSchema.parse(await c.req.json())

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.metaTitle !== undefined) sets.push(sql`meta_title = ${data.metaTitle}`)
  if (data.metaDescription !== undefined) sets.push(sql`meta_description = ${data.metaDescription}`)
  if (data.ogImage !== undefined) sets.push(sql`og_image = ${data.ogImage}`)
  if (data.customContent !== undefined) sets.push(sql`custom_content = ${data.customContent}`)
  if (data.isPublished !== undefined) sets.push(sql`is_published = ${data.isPublished}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE seo_product_pages SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'SEO page not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'seo_product_page',
    entityId: id,
    metadata: { fields: Object.keys(data) },
    req: c.req,
  })

  return c.json(updated)
})

// DELETE /products/:id — Unpublish (soft delete)
app.delete('/products/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE seo_product_pages SET is_published = false, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, slug
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'SEO page not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'seo_product_page',
    entityId: id,
    metadata: { type: 'unpublish', slug: updated.slug },
    req: c.req,
  })

  return c.json({ success: true, unpublished: updated.slug })
})

export default app
