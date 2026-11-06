// POST /api/quote-preview/:quoteId — the office's "Preview as client" (Jobber): a link to the customer's own page for this quote,
// read only, good for 30 minutes (tenant-backend portal/documentLinks.ts quotePreviewToken; the page is /v/<token>, whose server
// door portal.ts mounts with GETs only). Nothing is sent and the customer's own link is not minted. Feature quote_preview (hidden,
// not ready); whoever may read quotes may preview one.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { quotePreviewToken, quotePreviewPath, PREVIEW_MINUTES } from '@twomiah/tenant-backend'
import { quote } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export function createQuotePreviewRoutes(d: CrmDeps) {
  const app = new Hono<AppEnv>()

  app.post('/:quoteId', d.permissions.requirePermission('quotes:read'), async (c) => {
    const u = c.get('user')
    const [q] = await d.db.select({ id: quote.id }).from(quote).where(and(eq(quote.id, c.req.param('quoteId')), eq(quote.companyId, u.companyId))).limit(1)
    if (!q) return fail(c, 404, 'Quote not found')
    const token = quotePreviewToken(u.companyId, q.id)
    return one(c, { path: quotePreviewPath(token), minutes: PREVIEW_MINUTES }, 201)
  })

  return app
}
