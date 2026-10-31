// The store's sales reports at /api/admin/sales-reports (2026-10-30, gap 1 against Shopify's Analytics): sales over time,
// top products, repeat customers and the average order, for a window of days on the shop's own clock.
//
// Behind the store_sales_reports feature (registered not ready: switched on by no plan or signup) AND revenue:read — the
// takings are the owner's and the manager's, never the staff seat's, the same line the Dashboard draws. The Menu row asks
// the same feature and permission. The shared /crm/reports is invoices and jobs and is not offered to a store.
//
//   Also cut by variant (size, colour…): units, net sales, cost and margin per option, beside the by-product view.
//   GET /?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|week|month   (default: the last 30 days, bucket chosen from the length)
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { salesOverTime, salesTotals, topProducts, salesByVariant, repeatCustomers, profitTotals, discountCodes, type Bucket } from '../../../data/storeReports.ts'
import { escapeCsv } from '../../../core/sanitize.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../../deps.ts'

/** The longest window one report covers (a year of days, leap day included). */
export const MAX_DAYS = 366
const DAY = 86_400_000
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
/** Today on the shop's clock, as YYYY-MM-DD. */
const todayIn = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
/** Days a window covers, both ends counted. */
const spanOf = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1
/** Day by day while it fits on a page, then by week, then by month. */
const bucketFor = (days: number): Bucket => (days <= 62 ? 'day' : days <= 183 ? 'week' : 'month')

/** Profit and margin of the costed part of a line group; both null when none of it had a cost (never zero, never a guess). */
const profitOf = (costedSalesCents: number, costCents: number | null) =>
  costCents == null ? { profitCents: null, marginPercent: null }
    : { profitCents: costedSalesCents - costCents, marginPercent: costedSalesCents > 0 ? Math.round(((costedSalesCents - costCents) / costedSalesCents) * 1000) / 10 : null }

/** Money as a spreadsheet wants it: 1234 → 12.34. */
const dollars = (cents: number) => (cents / 100).toFixed(2)

export function createSalesReportRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('revenue:read'))

  /** The window the query names, on the shop's clock; or the refusal to send back. */
  async function windowOf(c: any): Promise<{ w: { from: string; to: string; timeZone: string }; bucket: Bucket; companyId: string } | Response> {
    const companyId = c.get('user').companyId as string
    const [row] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    const timeZone = companyRowTimeZone(row)
    const q = c.req.query()
    const to = q.to === undefined || q.to === '' ? todayIn(timeZone) : q.to
    const from = q.from === undefined || q.from === '' ? addDays(to, -29) : q.from
    if (!isDay(from) || !isDay(to)) return fail(c, 400, 'Choose the first and last day as dates, like 2026-10-01.', 'validation_failed', { ...(!isDay(from) ? { from: 'Not a date' } : {}), ...(!isDay(to) ? { to: 'Not a date' } : {}) })
    if (from > to) return fail(c, 400, 'The first day is after the last day.', 'validation_failed', { from: 'After the last day' })
    const days = spanOf(from, to)
    if (days > MAX_DAYS) return fail(c, 400, `A report covers up to ${MAX_DAYS} days at a time. Choose a shorter stretch.`, 'validation_failed', { to: 'Too long' })
    if (q.bucket !== undefined && q.bucket !== '' && !['day', 'week', 'month'].includes(q.bucket)) return fail(c, 400, 'Group by day, week or month.', 'validation_failed', { bucket: 'Not day, week or month' })
    return { w: { from, to, timeZone }, bucket: (q.bucket || bucketFor(days)) as Bucket, companyId }
  }
  /** What a product costs the shop, and so the profit, is margin:read's — the Dashboard-takings seat (revenue:read) may not have it. */
  const seesMargin = (c: any) => canSeeWith(d.permissions)(c.get('user').role, 'margin:read', c.get('user').userId)

  app.get('/', async (c) => {
    const win = await windowOf(c)
    if (win instanceof Response) return win
    const { w, bucket, companyId } = win
    const margin = await seesMargin(c)
    const [totals, series, products, variants, repeat, codes, profit] = await Promise.all([
      salesTotals(db, companyId, w), salesOverTime(db, companyId, w, bucket), topProducts(db, companyId, w), salesByVariant(db, companyId, w), repeatCustomers(db, companyId, w),
      discountCodes(db, companyId, w), margin ? profitTotals(db, companyId, w) : Promise.resolve(null),
    ])
    return one(c, {
      from: w.from, to: w.to, timeZone: w.timeZone, bucket, totals, series, repeat, discountCodes: codes,
      // A seat without margin:read is sent no cost and no profit — LEFT OUT, never zero. A product with no cost says costCents null.
      topProducts: products.map(({ costedSalesCents, costCents, ...p }) => (margin ? { ...p, costCents, profitCents: costCents == null ? null : costedSalesCents - costCents } : p)),
      // The same rule by variant: cost, profit and margin only for a seat that sees costs; null = no cost stored, never zero.
      variants: variants.map(({ costedSalesCents, costCents, ...v }) => (margin ? { ...v, costCents, ...profitOf(costedSalesCents, costCents) } : v)),
      ...(profit ? { profit } : {}),
    })
  })

  // The same figures as a spreadsheet: ?report=sales (by day, week or month) | products | discounts. Opens in Excel and Sheets.
  app.get('/export', async (c) => {
    const win = await windowOf(c)
    if (win instanceof Response) return win
    const { w, bucket, companyId } = win
    const report = c.req.query('report') || 'sales'
    if (!['sales', 'products', 'variants', 'discounts'].includes(report)) return fail(c, 400, 'Export sales, products, variants or discounts.', 'validation_failed', { report: 'Not sales, products, variants or discounts' })
    const margin = await seesMargin(c)
    let rows: unknown[][]
    if (report === 'sales') {
      const series = await salesOverTime(db, companyId, w, bucket)
      rows = [[bucket === 'day' ? 'Day' : bucket === 'week' ? 'Week starting' : 'Month starting', 'Orders', 'Paid', 'Sent back', 'Net'],
        ...series.map((p) => [p.period, p.orders, dollars(p.grossCents), dollars(p.refundedCents), dollars(p.netCents)])]
    } else if (report === 'products') {
      const products = await topProducts(db, companyId, w, 5000)
      rows = [['Product', 'Units sold', 'Brought in', ...(margin ? ['Cost', 'Profit'] : [])],
        ...products.map((p) => [p.name, p.units, dollars(p.salesCents), ...(margin ? [p.costCents == null ? 'no cost' : dollars(p.costCents), p.costCents == null ? 'no cost' : dollars(p.costedSalesCents - p.costCents)] : [])])]
    } else if (report === 'variants') {
      const variants = await salesByVariant(db, companyId, w, 50_000)
      rows = [['Product', 'Option', 'SKU', 'Units sold', 'Net sales', ...(margin ? ['Cost', 'Profit', 'Margin %'] : [])],
        ...variants.map((v) => {
          const p = profitOf(v.costedSalesCents, v.costCents)
          return [v.productName, v.variantName, v.sku, v.units, dollars(v.salesCents), ...(margin ? [v.costCents == null ? 'no cost' : dollars(v.costCents), p.profitCents == null ? 'no cost' : dollars(p.profitCents), p.marginPercent == null ? 'no cost' : p.marginPercent] : [])]
        })]
    } else {
      const codes = await discountCodes(db, companyId, w)
      rows = [['Code', 'Orders', 'Taken off', 'Orders kept'], ...codes.map((r) => [r.code, r.orders, dollars(r.discountCents), dollars(r.netCents)])]
    }
    const body = '\ufeff' + rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n') + '\r\n'
    return new Response(body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${report}-${w.from}-to-${w.to}.csv"`, 'cache-control': 'no-store' } })
  })
  return app
}
