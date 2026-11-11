// The store's sales reports, SAVED and SCHEDULED (parity tier 3, store — Shopify's saved reports and their emailed exports;
// feature store_report_schedules, not ready). On the shared saved-report machinery the field trades' plan and team reports use
// (../../field/savedReports.ts): an owner saves a report — which table and which period, a NAME like "last month", never two
// dates — and may have it emailed as a CSV weekly or monthly, so a scheduled report always covers the latest days.
//
//   tables: sales over time · by product (with profit where costs are kept) · by option · discount codes — the same figures as
//   Store › Sales (../../../data/storeReports.ts), on the shop's own clock.
//   /api/admin/sales-reports/saved   revenue:read (the takings are the owner's and the manager's, as the Sales page)
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { companyRowTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { salesOverTime, topProducts, salesByVariant, discountCodes, type Bucket } from '../../../data/storeReports.ts'
import type { CrmDeps } from '../../deps.ts'
import { createSavedReports } from '../../field/savedReports.ts'
import { PERIOD_IDS, chooseColumns, resolvePeriod, type Col, type ReportTable } from '../../field/reportTables.ts'

export const STORE_REPORT_SCHEDULES = 'store_report_schedules'
export const STORE_TABS = ['over_time', 'products', 'variants', 'discounts'] as const
const DAY = 86_400_000
const dollars = (cents: number | null | undefined) => (cents == null ? null : Math.round(Number(cents)) / 100)
const params = z.object({
  tab: z.enum(STORE_TABS, { error: 'Choose which sales report' }),
  period: z.enum(PERIOD_IDS, { error: 'Choose the period' }),
  columns: z.array(z.string().max(40)).max(20).optional(),
})

/** One store sales table for a named period on the shop's clock. */
export async function storeSalesTable(db: any, companyId: string, p: z.infer<typeof params>, now: Date): Promise<ReportTable> {
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const timeZone = companyRowTimeZone(co)
  const today = storeDateString(now, timeZone)
  const r = resolvePeriod(p.period, today)
  const w = { from: r.startDate ?? '2000-01-01', to: r.endDate ?? today, timeZone }
  const money = (key: string, label: string): Col => ({ key, label, kind: 'money', default: true })
  if (p.tab === 'over_time') {
    const span = Math.round((Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / DAY) + 1
    const bucket: Bucket = span <= 62 ? 'day' : span <= 183 ? 'week' : 'month'
    const rows = (await salesOverTime(db, companyId, w, bucket)).map((s) => ({ period: s.period, orders: s.orders, gross: dollars(s.grossCents), refunded: dollars(s.refundedCents), net: dollars(s.netCents) }))
    return { tab: p.tab, title: 'Sales over time', columns: [{ key: 'period', label: bucket === 'day' ? 'Day' : bucket === 'week' ? 'Week of' : 'Month', kind: 'date', default: true }, { key: 'orders', label: 'Orders', kind: 'number', default: true }, money('gross', 'Gross'), money('refunded', 'Refunded'), money('net', 'Net sales')], rows }
  }
  if (p.tab === 'products') {
    const rows = (await topProducts(db, companyId, w, 500)).map((t) => ({ name: t.name, units: t.units, sales: dollars(t.salesCents), profit: t.costCents == null ? null : dollars(t.costedSalesCents - t.costCents) }))
    return { tab: p.tab, title: 'Sales by product', columns: [{ key: 'name', label: 'Product', default: true }, { key: 'units', label: 'Units', kind: 'number', default: true }, money('sales', 'Net sales'), { key: 'profit', label: 'Profit (costed units)', kind: 'money' }], rows }
  }
  if (p.tab === 'variants') {
    const rows = (await salesByVariant(db, companyId, w, 500)).map((v) => ({ product: v.productName, option: v.variantName, sku: v.sku, units: v.units, sales: dollars(v.salesCents) }))
    return { tab: p.tab, title: 'Sales by option', columns: [{ key: 'product', label: 'Product', default: true }, { key: 'option', label: 'Option', default: true }, { key: 'sku', label: 'SKU', default: true }, { key: 'units', label: 'Units', kind: 'number', default: true }, money('sales', 'Net sales')], rows }
  }
  const rows = (await discountCodes(db, companyId, w)).map((x) => ({ code: x.code, orders: x.orders, discount: dollars(x.discountCents), net: dollars(x.netCents) }))
  return { tab: p.tab, title: 'Discount codes', columns: [{ key: 'code', label: 'Code', default: true }, { key: 'orders', label: 'Orders', kind: 'number', default: true }, money('discount', 'Taken off'), money('net', 'Net sales')], rows }
}

export function createStoreSavedReports(d: CrmDeps) {
  return createSavedReports(d, [{
    report: 'store_sales', feature: STORE_REPORT_SCHEDULES, permission: 'revenue:read',
    parse: (raw) => params.parse(raw),
    run: async (companyId, p, now) => {
      const table = await storeSalesTable(d.db, companyId, p as any, now)
      return { table, columns: chooseColumns(table.columns, (p as any).columns) }
    },
  }])
}
