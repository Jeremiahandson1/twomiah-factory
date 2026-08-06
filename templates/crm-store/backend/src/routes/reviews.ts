import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { productReviews, products } from '../../db/schema.ts'
import { eq, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const admin = new Hono()
admin.use('*', authenticate)

// Moderation queue. Defaults to what needs a decision.
admin.get('/', async (c) => {
  const status = c.req.query('status') || 'pending'
  const rows = await db.select({
    id: productReviews.id,
    productId: productReviews.productId,
    productName: products.name,
    productSlug: products.slug,
    authorName: productReviews.authorName,
    authorEmail: productReviews.authorEmail,
    rating: productReviews.rating,
    title: productReviews.title,
    body: productReviews.body,
    status: productReviews.status,
    verifiedPurchase: productReviews.verifiedPurchase,
    createdAt: productReviews.createdAt,
  })
    .from(productReviews)
    .leftJoin(products, eq(products.id, productReviews.productId))
    .where(status === 'all' ? sql`true` : eq(productReviews.status, status))
    .orderBy(desc(productReviews.createdAt))
    .limit(200)
  return c.json({ data: rows })
})

admin.get('/counts', async (c) => {
  const [row] = await db.select({
    pending: sql<number>`COUNT(*) FILTER (WHERE ${productReviews.status} = 'pending')::int`,
    approved: sql<number>`COUNT(*) FILTER (WHERE ${productReviews.status} = 'approved')::int`,
    rejected: sql<number>`COUNT(*) FILTER (WHERE ${productReviews.status} = 'rejected')::int`,
  }).from(productReviews)
  return c.json(row ?? { pending: 0, approved: 0, rejected: 0 })
})

const patchSchema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) })

admin.patch('/:id', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid status' }, 400)
  const [updated] = await db.update(productReviews)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(productReviews.id, c.req.param('id')))
    .returning()
  if (!updated) return c.json({ error: 'Review not found' }, 404)
  return c.json(updated)
})

admin.delete('/:id', async (c) => {
  await db.delete(productReviews).where(eq(productReviews.id, c.req.param('id')))
  return c.json({ ok: true })
})

export default admin
