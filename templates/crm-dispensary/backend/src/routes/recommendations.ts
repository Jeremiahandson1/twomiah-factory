import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// GET /for-customer/:contactId — AI-powered recommendations for a customer
app.get('/for-customer/:contactId', async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  // 1. Fetch customer's last 20 orders with items
  const ordersResult = await db.execute(sql`
    SELECT o.id, o.items, o.created_at
    FROM orders o
    WHERE o.contact_id = ${contactId}
      AND o.company_id = ${currentUser.companyId}
      AND o.status NOT IN ('cancelled', 'refunded')
    ORDER BY o.created_at DESC
    LIMIT 20
  `)
  const orders = (ordersResult as any).rows || ordersResult

  // 2. Extract most purchased categories and strains
  const categoryCount: Record<string, number> = {}
  const strainCount: Record<string, number> = {}
  const purchasedProductIds = new Set<string>()

  for (const order of orders) {
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || [])
    for (const item of items) {
      if (item.productId) purchasedProductIds.add(item.productId)
      if (item.category) categoryCount[item.category] = (categoryCount[item.category] || 0) + (item.quantity || 1)
      if (item.strainName) strainCount[item.strainName] = (strainCount[item.strainName] || 0) + (item.quantity || 1)
    }
  }

  const topCategories = Object.entries(categoryCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0])
  const topStrains = Object.entries(strainCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0])

  // If no history, return popular products
  if (!topCategories.length && !topStrains.length) {
    const popularResult = await db.execute(sql`
      SELECT p.* FROM products p
      WHERE p.company_id = ${currentUser.companyId} AND p.active = true AND p.in_stock = true
      ORDER BY p.total_sold DESC NULLS LAST
      LIMIT 10
    `)
    return c.json({ recommendations: (popularResult as any).rows || popularResult, source: 'popular' })
  }

  // 3. Find candidate products (same categories/strains, not already purchased)
  const purchasedArray = Array.from(purchasedProductIds)
  const candidatesResult = await db.execute(sql`
    SELECT p.*,
           COALESCE(p.total_sold, 0) as popularity,
           CASE WHEN p.sale_price IS NOT NULL AND p.sale_price < p.price THEN true ELSE false END as on_sale,
           CASE WHEN p.created_at >= NOW() - INTERVAL '14 days' THEN true ELSE false END as new_arrival
    FROM products p
    WHERE p.company_id = ${currentUser.companyId}
      AND p.active = true
      AND p.in_stock = true
      AND (
        p.category = ANY(${topCategories}::text[])
        OR p.strain_name = ANY(${topStrains}::text[])
      )
      ${purchasedArray.length > 0 ? sql`AND p.id != ALL(${purchasedArray}::uuid[])` : sql``}
    LIMIT 100
  `)
  const candidates = (candidatesResult as any).rows || candidatesResult

  if (!candidates.length) {
    return c.json({ recommendations: [], source: 'none' })
  }

  // 4. Score candidates
  // Weights: same strain type (0.3), same category (0.2), popular (0.2), on sale (0.15), new arrival (0.15)
  const maxPopularity = Math.max(...candidates.map((p: any) => Number(p.popularity) || 1), 1)

  const scored = candidates.map((p: any) => {
    let score = 0

    // Strain type match (indica/sativa/hybrid)
    if (topStrains.includes(p.strain_name)) score += 0.3

    // Category match
    if (topCategories.includes(p.category)) score += 0.2

    // Popularity (normalized 0-1)
    score += 0.2 * (Number(p.popularity) / maxPopularity)

    // On sale bonus
    if (p.on_sale) score += 0.15

    // New arrival bonus
    if (p.new_arrival) score += 0.15

    return { ...p, score }
  })

  scored.sort((a: any, b: any) => b.score - a.score)
  const top10 = scored.slice(0, 10)

  // 5. Store recommendations
  for (const rec of top10) {
    await db.execute(sql`
      INSERT INTO product_recommendations(id, contact_id, product_id, score, reason, company_id, created_at)
      VALUES (gen_random_uuid(), ${contactId}, ${rec.id}, ${rec.score}, ${
        rec.on_sale ? 'on_sale' : rec.new_arrival ? 'new_arrival' : topStrains.includes(rec.strain_name) ? 'strain_match' : 'category_match'
      }, ${currentUser.companyId}, NOW())
      ON CONFLICT (contact_id, product_id) WHERE created_at::date = CURRENT_DATE
      DO UPDATE SET score = ${rec.score}, updated_at = NOW()
    `)
  }

  return c.json({
    recommendations: top10.map((r: any) => ({
      id: r.id,
      recommendationId: r.id,
      name: r.name,
      category: r.category,
      strainName: r.strain_name,
      strainType: r.strain_type,
      thcPercentage: r.thc_percent,
      cbdPercentage: r.cbd_percent,
      price: r.price,
      salePrice: r.sale_price,
      imageUrl: r.image_url,
      score: r.score,
      reason: r.on_sale ? 'on_sale' : r.new_arrival ? 'new_arrival' : topStrains.includes(r.strain_name) ? 'strain_match' : 'category_match',
    })),
    source: 'personalized',
    topCategories,
    topStrains,
  })
})

// GET /trending — Trending products (last 7 days)
app.get('/trending', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    WITH recent_orders AS (
      SELECT o.items
      FROM orders o
      WHERE o.company_id = ${currentUser.companyId}
        AND o.created_at >= NOW() - INTERVAL '7 days'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    item_counts AS (
      SELECT
        (item->>'productId') as product_id,
        SUM((item->>'quantity')::int) as order_count
      FROM recent_orders, jsonb_array_elements(items::jsonb) as item
      WHERE item->>'productId' IS NOT NULL
      GROUP BY item->>'productId'
    )
    SELECT p.*, ic.order_count
    FROM item_counts ic
    JOIN products p ON p.id = ic.product_id::uuid
    WHERE p.active = true
    ORDER BY ic.order_count DESC
    LIMIT 20
  `)

  return c.json((result as any).rows || result)
})

// GET /similar/:productId — Products similar to a given product
app.get('/similar/:productId', async (c) => {
  const currentUser = c.get('user') as any
  const productId = c.req.param('productId')

  // Get the source product
  const sourceResult = await db.execute(sql`
    SELECT * FROM products
    WHERE id = ${productId} AND company_id = ${currentUser.companyId}
  `)
  const source = ((sourceResult as any).rows || sourceResult)?.[0]
  if (!source) return c.json({ error: 'Product not found' }, 404)

  const thcLow = (Number(source.thc_percent) || 0) * 0.95
  const thcHigh = (Number(source.thc_percent) || 0) * 1.05
  const priceLow = (Number(source.price) || 0) * 0.8
  const priceHigh = (Number(source.price) || 0) * 1.2

  const result = await db.execute(sql`
    SELECT p.*,
      CASE
        WHEN p.strain_type = ${source.strain_type} AND p.category = ${source.category} THEN 3
        WHEN p.strain_type = ${source.strain_type} THEN 2
        WHEN p.category = ${source.category} THEN 1
        ELSE 0
      END as relevance_score
    FROM products p
    WHERE p.company_id = ${currentUser.companyId}
      AND p.id != ${productId}
      AND p.active = true
      AND p.in_stock = true
      AND (
        p.strain_type = ${source.strain_type}
        OR p.category = ${source.category}
        OR (p.thc_percent BETWEEN ${thcLow} AND ${thcHigh})
        OR (p.price BETWEEN ${priceLow} AND ${priceHigh})
      )
    ORDER BY relevance_score DESC, p.total_sold DESC NULLS LAST
    LIMIT 10
  `)

  return c.json((result as any).rows || result)
})

// POST /track — Track recommendation interaction
app.post('/track', async (c) => {
  const currentUser = c.get('user') as any

  const trackSchema = z.object({
    recommendationId: z.string(),
    action: z.enum(['shown', 'clicked', 'purchased']),
  })
  const data = trackSchema.parse(await c.req.json())

  const column = data.action === 'shown' ? 'shown_at' : data.action === 'clicked' ? 'clicked_at' : 'purchased_at'

  const result = await db.execute(sql`
    UPDATE product_recommendations
    SET ${sql.raw(column)} = NOW(), updated_at = NOW()
    WHERE id = ${data.recommendationId} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const rec = ((result as any).rows || result)?.[0]
  if (!rec) return c.json({ error: 'Recommendation not found' }, 404)

  return c.json(rec)
})

// GET /performance — Recommendation performance stats
app.get('/performance', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const days = +(c.req.query('days') || '30')

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_recommendations,
      COUNT(shown_at)::int as total_shown,
      COUNT(clicked_at)::int as total_clicked,
      COUNT(purchased_at)::int as total_purchased,
      CASE WHEN COUNT(shown_at) > 0
        THEN ROUND(COUNT(clicked_at)::numeric / COUNT(shown_at) * 100, 2)
        ELSE 0
      END as click_rate,
      CASE WHEN COUNT(shown_at) > 0
        THEN ROUND(COUNT(purchased_at)::numeric / COUNT(shown_at) * 100, 2)
        ELSE 0
      END as purchase_rate
    FROM product_recommendations
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= NOW() - INTERVAL '1 day' * ${days}
  `)

  const stats = ((result as any).rows || result)?.[0]

  // Revenue attributed to recommendations
  const revenueResult = await db.execute(sql`
    SELECT COALESCE(SUM(p.price), 0)::numeric as attributed_revenue
    FROM product_recommendations pr
    JOIN products p ON p.id = pr.product_id
    WHERE pr.company_id = ${currentUser.companyId}
      AND pr.purchased_at IS NOT NULL
      AND pr.created_at >= NOW() - INTERVAL '1 day' * ${days}
  `)

  const revenue = ((revenueResult as any).rows || revenueResult)?.[0]

  return c.json({
    ...stats,
    attributedRevenue: Number(revenue?.attributed_revenue || 0),
    periodDays: days,
  })
})

export default app
