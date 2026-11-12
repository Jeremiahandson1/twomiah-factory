// The store's sales reports, SAVED and SCHEDULED (parity tier 3, store — Shopify's saved reports and their emailed exports;
// feature store_report_schedules, not ready). On the shared saved-report machinery the field trades' plan and team reports use
// (../../field/savedReports.ts): an owner saves a report — which table and which period, a NAME like "last month", never two
// dates — and may have it emailed as a CSV weekly or monthly, so a scheduled report always covers the latest days.
//
//   tables: sales over time · by product (with profit where costs are kept) · by option · discount codes — the same figures as
//   Store › Sales (../../../data/storeReports.ts), on the shop's own clock — and Shopify's further reports: by customer, by channel
//   (online, counter, draft), by place (where it shipped; picked up = in store), taxes by month, refunds given, inventory value
//   (now, at cost and at price). Each is also shown and exported on Store › Sales (./reports.ts /table, /export).
//   /api/admin/sales-reports/saved   revenue:read (the takings are the owner's and the manager's, as the Sales page)
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { companyRowTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { salesOverTime, topProducts, salesByVariant, discountCodes, salesByCustomer, salesByChannel, salesByPlace, taxesByMonth, refundsGiven, inventoryValue, inventoryFlow, sellThroughPercent, daysOfStockLeft, abcGrades, windowInstants, type Bucket, type Window } from '../../../data/storeReports.ts'
import { STOCK_REASON_WORDS, historyStarts, movesBetween, type StockReason } from '../../../data/storeStockMoves.ts'
import type { CrmDeps } from '../../deps.ts'
import { createSavedReports } from '../../field/savedReports.ts'
import { PERIOD_IDS, chooseColumns, resolvePeriod, type Col, type ReportTable } from '../../field/reportTables.ts'

export const STORE_REPORT_SCHEDULES = 'store_report_schedules'
export const STORE_TABS = ['over_time', 'products', 'variants', 'discounts', 'customers', 'channels', 'places', 'taxes', 'refunds', 'inventory', 'sell_through', 'days_left', 'abc', 'stock_moves'] as const
export type StoreTab = typeof STORE_TABS[number]
/** The further reports (store_report_schedules): shown on Store › Sales only where that switch is on. */
export const MORE_TABS: StoreTab[] = ['customers', 'channels', 'places', 'taxes', 'refunds', 'inventory', 'sell_through', 'days_left', 'abc', 'stock_moves']
export const CHANNEL_WORDS: Record<string, string> = { storefront: 'Online store', counter: 'At the counter', draft: 'Draft orders (sent to pay)' }
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
  return storeTableFor(db, companyId, p.tab, { from: r.startDate ?? '2000-01-01', to: r.endDate ?? today, timeZone }, { cost: true })
}

/**
 * One store table for a window of the shop's days. `cost`: the seat sees what things cost (margin:read) — without it the cost and
 * profit columns are LEFT OUT, never zero (a saved report is the owner's, and keeps them).
 */
export async function storeTableFor(db: any, companyId: string, tab: StoreTab, w: Window, see: { cost: boolean }): Promise<ReportTable> {
  const money = (key: string, label: string, dflt = true): Col => ({ key, label, kind: 'money', default: dflt })
  const num = (key: string, label: string): Col => ({ key, label, kind: 'number', default: true })
  const text = (key: string, label: string): Col => ({ key, label, default: true })
  if (tab === 'over_time') {
    const span = Math.round((Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / DAY) + 1
    const bucket: Bucket = span <= 62 ? 'day' : span <= 183 ? 'week' : 'month'
    const rows = (await salesOverTime(db, companyId, w, bucket)).map((s) => ({ period: s.period, orders: s.orders, gross: dollars(s.grossCents), refunded: dollars(s.refundedCents), net: dollars(s.netCents) }))
    return { tab, title: 'Sales over time', columns: [{ key: 'period', label: bucket === 'day' ? 'Day' : bucket === 'week' ? 'Week of' : 'Month', kind: 'date', default: true }, num('orders', 'Orders'), money('gross', 'Gross'), money('refunded', 'Refunded'), money('net', 'Net sales')], rows }
  }
  if (tab === 'products') {
    const rows = (await topProducts(db, companyId, w, 500)).map((t) => ({ name: t.name, units: t.units, sales: dollars(t.salesCents), ...(see.cost ? { profit: t.costCents == null ? null : dollars(t.costedSalesCents - t.costCents) } : {}) }))
    return { tab, title: 'Sales by product', columns: [text('name', 'Product'), num('units', 'Units'), money('sales', 'Net sales'), ...(see.cost ? [{ key: 'profit', label: 'Profit (costed units)', kind: 'money' } as Col] : [])], rows }
  }
  if (tab === 'variants') {
    const rows = (await salesByVariant(db, companyId, w, 500)).map((v) => ({ product: v.productName, option: v.variantName, sku: v.sku, units: v.units, sales: dollars(v.salesCents) }))
    return { tab, title: 'Sales by option', columns: [text('product', 'Product'), text('option', 'Option'), text('sku', 'SKU'), num('units', 'Units'), money('sales', 'Net sales')], rows }
  }
  if (tab === 'discounts') {
    const rows = (await discountCodes(db, companyId, w)).map((x) => ({ code: x.code, orders: x.orders, discount: dollars(x.discountCents), net: dollars(x.netCents) }))
    return { tab, title: 'Discount codes', columns: [text('code', 'Code'), num('orders', 'Orders'), money('discount', 'Taken off'), money('net', 'Net sales')], rows }
  }
  if (tab === 'customers') {
    const rows = (await salesByCustomer(db, companyId, w)).map((x) => ({ name: x.name || x.email || 'No name given', email: x.email, orders: x.orders, net: dollars(x.netCents), average: dollars(Math.round(x.grossCents / Math.max(1, x.orders))), first: x.firstOrder }))
    return { tab, title: 'Sales by customer', columns: [text('name', 'Customer'), text('email', 'Email'), num('orders', 'Orders'), money('net', 'Net sales'), money('average', 'Average order'), { key: 'first', label: 'First order in the period', kind: 'date', default: true }], rows }
  }
  if (tab === 'channels' || tab === 'places') {
    const groups = tab === 'channels' ? await salesByChannel(db, companyId, w) : await salesByPlace(db, companyId, w)
    const label = (k: string) => (tab === 'channels' ? CHANNEL_WORDS[k] ?? k : k === 'in_store' ? 'Picked up or digital (in store)' : k.split('|').reverse().filter((x) => x && x !== '?').join(', ') || 'No address')
    const rows = groups.map((g) => ({ name: label(g.key), orders: g.orders, gross: dollars(g.grossCents), refunded: dollars(g.refundedCents), net: dollars(g.netCents), tax: dollars(g.taxCents), shipping: dollars(g.shippingCents) }))
    return { tab, title: tab === 'channels' ? 'Sales by channel' : 'Sales by place', columns: [text('name', tab === 'channels' ? 'Channel' : 'Shipped to'), num('orders', 'Orders'), money('gross', 'Gross'), money('refunded', 'Refunded'), money('net', 'Net sales'), money('tax', 'Tax', tab === 'places'), money('shipping', 'Shipping', false)], rows }
  }
  if (tab === 'taxes') {
    const rows = (await taxesByMonth(db, companyId, w)).map((x) => ({ month: `${x.month}-01`, orders: x.orders, taxed: x.taxedOrders, sales: dollars(x.salesCents), tax: dollars(x.taxCents), automatic: x.automatic }))
    return { tab, title: 'Taxes', columns: [{ key: 'month', label: 'Month', kind: 'date', default: true }, num('orders', 'Orders'), num('taxed', 'Orders with tax'), money('sales', 'Sales before tax and shipping'), money('tax', 'Tax collected'), { key: 'automatic', label: 'Worked out by Stripe Tax', kind: 'number' }], rows,
      note: 'Tax is what each order carried at checkout; a refund does not take it back here. Your tax return may need the refunds too (the Refunds report).' }
  }
  if (tab === 'refunds') {
    const rows = (await refundsGiven(db, companyId, w)).map((x) => ({ order: x.orderNumber ? `#${String(x.orderNumber).replace(/^#/, '')}` : '', name: x.name || x.email || 'No name given', on: x.on, placed: x.placed, total: dollars(x.totalCents), refunded: dollars(x.refundedCents), kind: x.full ? 'Full' : 'Part' }))
    return { tab, title: 'Refunds given', columns: [text('order', 'Order'), text('name', 'Customer'), { key: 'on', label: 'Refunded on', kind: 'date', default: true }, { key: 'placed', label: 'Ordered on', kind: 'date', default: true }, money('total', 'Order total'), money('refunded', 'Refunded'), text('kind', 'Full or part')], rows }
  }
  if (tab === 'sell_through' || tab === 'days_left' || tab === 'abc') {
    const flow = await inventoryFlow(db, companyId, w)
    const days = Math.round((Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / DAY) + 1
    const started = await historyStarts(db, companyId)
    const { startUtc } = await windowInstants(db, w)
    const early = !started || started > startUtc
      ? ` The stock history began ${started ? `on ${storeDateString(started, w.timeZone)}` : 'with this release'}; before that, a count is the earliest one kept.` : ''
    const opt = [text('product', 'Product'), text('option', 'Option'), text('sku', 'SKU')]
    if (tab === 'sell_through') {
      const rows = flow.filter((r) => r.sold > 0 || (r.ending ?? 0) > 0 || (r.starting ?? 0) > 0)
        .map((r) => ({ product: r.productName, option: r.variantName, sku: r.sku, starting: r.starting, sold: r.sold, ending: r.ending, rate: sellThroughPercent(r.sold, r.ending), ofStarting: r.starting && r.starting > 0 ? Math.round((r.sold / r.starting) * 1000) / 10 : null }))
        .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.product.localeCompare(b.product))
      const sold = rows.reduce((n, r) => n + r.sold, 0), ending = rows.reduce((n, r) => n + Math.max(0, r.ending ?? 0), 0)
      return { tab, title: 'Sell-through rate', columns: [...opt, num('starting', 'Starting stock'), num('sold', 'Units sold'), num('ending', 'Ending stock'), { key: 'rate', label: 'Sell-through', kind: 'percent', default: true }, { key: 'ofStarting', label: 'Of starting stock sold', kind: 'percent' }], rows,
        totals: { product: 'Total', sold, ending, rate: sellThroughPercent(sold, ending) },
        note: `Sell-through is units sold ÷ (units sold + ending stock), as Shopify works it out. Units sold are what stayed sold (returns off).${early}` }
    }
    if (tab === 'days_left') {
      const rows = flow.filter((r) => (r.ending ?? 0) > 0 || r.sold > 0)
        .map((r) => ({ product: r.productName, option: r.variantName, sku: r.sku, ending: r.ending, sold: r.sold, perDay: Math.round((r.sold / days) * 100) / 100, daysLeft: daysOfStockLeft(r.sold, r.ending, days) }))
        .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.product.localeCompare(b.product))
      return { tab, title: 'Days of inventory remaining', columns: [...opt, num('ending', 'Ending stock'), num('sold', 'Units sold'), num('perDay', 'Sold a day'), num('daysLeft', 'Days left')], rows,
        note: `Days left is ending stock ÷ the units sold a day over these ${days} day${days === 1 ? '' : 's'}; blank when it sold nothing. Shortest first.${early}` }
    }
    const graded = abcGrades(flow.map((r) => ({ product: r.productName, option: r.variantName, sku: r.sku, ending: r.ending, sold: r.sold, salesCents: r.salesCents })))
    const rows = graded.map((g) => ({ product: g.product, option: g.option, sku: g.sku, grade: g.grade, sales: dollars(g.salesCents), share: g.sharePercent, cumulative: g.cumulativePercent, sold: g.sold, ending: g.ending }))
    return { tab, title: 'ABC analysis', columns: [...opt, text('grade', 'Grade'), money('sales', 'Net sales'), { key: 'share', label: 'Share of sales', kind: 'percent', default: true }, { key: 'cumulative', label: 'Running share', kind: 'percent' }, num('sold', 'Units sold'), num('ending', 'Ending stock')], rows,
      note: 'A: the best sellers making up the first 80% of sales; B: the next 15%; C: the rest, and every counted option that sold nothing. Sales are what stayed sold, before shipping and tax.' }
  }
  if (tab === 'stock_moves') {
    const { startUtc, endUtc } = await windowInstants(db, w)
    const moves = await movesBetween(db, companyId, startUtc, endUtc)
    const rows = moves.map((m) => ({ at: new Date(m.createdAt as any).toISOString(), product: m.productName, option: m.variantName, sku: m.sku, what: STOCK_REASON_WORDS[m.reason as StockReason] ?? m.reason, change: m.delta, after: m.quantityAfter, by: m.byName, detail: m.note }))
    const opt = [text('product', 'Product'), text('option', 'Option'), text('sku', 'SKU')]
    return { tab, title: 'Stock changes', columns: [{ key: 'at', label: 'When', kind: 'datetime', default: true }, ...opt, text('what', 'What happened'), num('change', 'Change'), num('after', 'Count after'), text('by', 'By'), text('detail', 'Detail')], rows,
      note: rows.length >= 5000 ? 'The newest 5,000 changes; choose a shorter period for the rest.' : "Every change to a counted option's stock, newest first." }
  }
  // inventory — now, whatever the period.
  const items = await inventoryValue(db, companyId)
  const rows = items.map((x) => ({ product: x.product, option: x.option, sku: x.sku, onHand: x.onHand, ...(see.cost ? { cost: x.costCents == null ? null : dollars(x.costCents), atCost: x.costCents == null ? null : dollars(x.costCents * x.onHand) } : {}), price: dollars(x.priceCents), atPrice: dollars(x.priceCents * x.onHand) }))
  const totalAt = (k: 'atCost' | 'atPrice') => Math.round(rows.reduce((n, r: any) => n + (r[k] == null ? 0 : Number(r[k]) * 100), 0)) / 100
  return { tab, title: 'Inventory value', columns: [text('product', 'Product'), text('option', 'Option'), text('sku', 'SKU'), num('onHand', 'On hand'), ...(see.cost ? [money('cost', 'Cost each'), money('atCost', 'Value at cost')] : []), money('price', 'Price each', false), money('atPrice', 'Value at price')], rows,
    totals: { product: 'Total', onHand: rows.reduce((n, r) => n + r.onHand, 0), ...(see.cost ? { atCost: totalAt('atCost') } : {}), atPrice: totalAt('atPrice') },
    note: `Stock on hand now, whatever the period.${see.cost ? ' An option with no cost kept is left out of the value at cost.' : ''}` }
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
