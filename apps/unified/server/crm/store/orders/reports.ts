// The store's sales reports at /api/admin/sales-reports (2026-10-30, gap 1 against Shopify's Analytics): sales over time,
// top products, repeat customers and the average order, for a window of days on the shop's own clock.
//
// Behind the store_sales_reports feature (registered not ready: switched on by no plan or signup) AND revenue:read — the
// takings are the owner's and the manager's, never the staff seat's, the same line the Dashboard draws. The Menu row asks
// the same feature and permission. The shared /crm/reports is invoices and jobs and is not offered to a store.
//
//   GET /?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|week|month   (default: the last 30 days, bucket chosen from the length)
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { salesOverTime, salesTotals, topProducts, repeatCustomers, type Bucket } from '../../../data/storeReports.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

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

export function createSalesReportRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('revenue:read'))

  app.get('/', async (c) => {
    const companyId = (c as any).get('user').companyId as string
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
    const bucket = (q.bucket || bucketFor(days)) as Bucket
    const w = { from, to, timeZone }
    const [totals, series, products, repeat] = await Promise.all([
      salesTotals(db, companyId, w), salesOverTime(db, companyId, w, bucket), topProducts(db, companyId, w), repeatCustomers(db, companyId, w),
    ])
    return one(c, { from, to, timeZone, bucket, totals, series, topProducts: products, repeat })
  })
  return app
}
