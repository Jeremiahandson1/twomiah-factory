// /api/public/food — food service's public answers, no sign-in: a guest's receipt by its private link (and the Print
// button's script). The company is the oldest row in this database (one business per tenant database).
import { Hono } from 'hono'
import { asc } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { checkIdFromToken, RECEIPT_JS } from './barReceipts.ts'
import type { BarServices } from './services.ts'

const NOT_FOUND = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt not found</title></head><body style="font:16px system-ui,sans-serif;padding:24px;color:#111;background:#fff"><h1 style="font-size:20px">That receipt link does not work</h1><p>Ask the business to send it again.</p></body></html>'

export function createBarFoodPublicRoutes(d: CrmDeps, bar: BarServices) {
  const app = new Hono()
  const theCompany = async () => (await d.db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1))[0]?.id as string | undefined

  app.get('/receipt.js', (c) => c.body(RECEIPT_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }))

  app.get('/receipt/:token', async (c) => {
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Robots-Tag', 'noindex')
    const checkId = checkIdFromToken(c.req.param('token'))
    const companyId = await theCompany()
    if (!checkId || !companyId || !(await d.features.isFeatureEnabled(companyId, 'bar_register'))) return c.html(NOT_FOUND, 404)
    const html = await bar.receipts.page(companyId, checkId)
    return html ? c.html(html) : c.html(NOT_FOUND, 404)
  })

  return app
}
