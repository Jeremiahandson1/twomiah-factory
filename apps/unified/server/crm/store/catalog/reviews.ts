// Product review moderation at /api/admin/reviews. Moved from templates/crm-store/backend/src/routes/reviews.ts.
// Shoppers write reviews on the storefront (the checkout group); they show publicly only once approved.
//
// Kept as the template had it: the permissions (reviews:read for the queue; staff publish or reject a review,
// reviews:update; deleting one for good is the manager's, reviews:delete); the queue defaults to what needs a decision
// (?status=pending), 'all' shows every review, newest first, 200 at most; the counts by status.
//
// Changes from the template:
//   · every review is the company's (company_id);
//   · replies (RULEBOOK §3): the queue is { data, pagination } (was { data }); a delete is { success: true } (was
//     { ok: true }); a bad status is a validation reply naming the box (was 'Invalid status');
//   · deleting a review that is not there is a 404 (the template answered ok: true having deleted nothing);
//   · a decision and a delete write their own audit row (product_review, by its title or its author) — the template
//     left them to the write floor.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { productReview, storeProduct } from '../../../db/schema/store.ts'
import { reviewCountsByStatus } from '../../../data/storeCatalog.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

const patchSchema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) })
const QUEUE_LIMIT = 200

export function createReviewRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  // Staff publish or reject a review (reviews:update); deleting one for good is the manager's (reviews:delete).
  app.use('*', requirePermission('reviews:read'))

  // Moderation queue. Defaults to what needs a decision.
  app.get('/', async (c) => {
    const u = c.get('user')
    const status = c.req.query('status') || 'pending'
    const rows = await db.select({
      id: productReview.id,
      productId: productReview.productId,
      productName: storeProduct.name,
      productSlug: storeProduct.slug,
      authorName: productReview.authorName,
      authorEmail: productReview.authorEmail,
      rating: productReview.rating,
      title: productReview.title,
      body: productReview.body,
      status: productReview.status,
      verifiedPurchase: productReview.verifiedPurchase,
      createdAt: productReview.createdAt,
    })
      .from(productReview)
      .leftJoin(storeProduct, eq(storeProduct.id, productReview.productId))
      .where(and(eq(productReview.companyId, u.companyId), status === 'all' ? undefined : eq(productReview.status, status)))
      .orderBy(desc(productReview.createdAt))
      .limit(QUEUE_LIMIT)
    return list(c, rows, { page: 1, limit: QUEUE_LIMIT, total: rows.length })
  })

  app.get('/counts', async (c) => one(c, await reviewCountsByStatus(db, c.get('user').companyId)))

  app.patch('/:id', requirePermission('reviews:update'), async (c) => {
    const u = c.get('user')
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const mine = and(eq(productReview.id, c.req.param('id')), eq(productReview.companyId, u.companyId))
    const [before] = await db.select().from(productReview).where(mine).limit(1)
    if (!before) return fail(c, 404, 'Review not found')
    const [updated] = await db.update(productReview).set({ status: parsed.data.status, updatedAt: new Date() }).where(mine).returning()
    if (!updated) return fail(c, 404, 'Review not found')
    await audit.log({
      action: audit.ACTIONS.STATUS_CHANGE, entity: 'product_review', entityId: updated.id, entityName: updated.title || updated.authorName,
      changes: before.status !== updated.status ? { status: { old: before.status, new: updated.status } } : null, metadata: { productId: updated.productId }, req: c,
    })
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('reviews:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(productReview).where(and(eq(productReview.id, c.req.param('id')), eq(productReview.companyId, u.companyId))).returning()
    if (!gone) return fail(c, 404, 'Review not found')
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'product_review', entityId: gone.id, entityName: gone.title || gone.authorName, metadata: { productId: gone.productId, rating: gone.rating }, req: c })
    return done(c)
  })

  return app
}
