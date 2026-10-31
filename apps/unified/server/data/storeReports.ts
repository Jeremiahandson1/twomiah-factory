// The store's sales reports' raw SQL (RULEBOOK §2), for server/crm/store/orders/reports.ts: sales over time, top
// products, repeat customers and the average order. Every figure counts the SAME orders the Dashboard counts
// (countedOrderCondition: anything but an unfinished checkout or a cancelled order — a refunded sale still was a sale)
// and takes what went back off beside it, so a report and the Dashboard never disagree about the same days.
//
// Days are the SHOP's days: a created_at is stored in UTC (timestamp without zone) and every day, week and month here is
// worked out on the company's own time zone, so an order at 9pm on the 3rd in Chicago is the 3rd, not the 4th.
import { sql } from 'drizzle-orm'
import { storeOrder, storeOrderItem } from '../db/schema/store.ts'
import { countedOrderCondition } from '../crm/store/tileConditions.ts'

export type Bucket = 'day' | 'week' | 'month'

/** A report's window, in the shop's days: `from` and `to` are both included (YYYY-MM-DD). */
export interface Window { from: string; to: string; timeZone: string }

/** The order's local time: UTC stored, read on the shop's clock. */
const localAt = (tz: string) => sql`((${storeOrder.createdAt} at time zone 'UTC') at time zone ${tz})`
/** In the window: from the start of `from`'s day up to, not including, the day after `to`. */
const inWindow = (w: Window) => sql`${localAt(w.timeZone)} >= ${w.from}::date and ${localAt(w.timeZone)} < (${w.to}::date + 1)`

export interface SalesPoint { period: string; orders: number; grossCents: number; refundedCents: number; netCents: number }

/** Sales per day, week (starting Monday) or month: the orders, what was paid, what went back and what was kept. Oldest first. */
export async function salesOverTime(db: any, companyId: string, w: Window, bucket: Bucket): Promise<SalesPoint[]> {
  const period = sql<string>`to_char(date_trunc(${bucket}::text, ${localAt(w.timeZone)}), 'YYYY-MM-DD')`
  const rows = await db.select({
    period,
    orders: sql<number>`count(*)`,
    grossCents: sql<number>`coalesce(sum(${storeOrder.totalCents}), 0)`,
    refundedCents: sql<number>`coalesce(sum(${storeOrder.refundedCents}), 0)`,
  }).from(storeOrder)
    .where(sql`${storeOrder.companyId} = ${companyId} and ${countedOrderCondition(storeOrder)} and ${inWindow(w)}`)
    // By position: the zone and bucket travel as parameters, and the same expression written twice would carry two different
    // placeholders — the database could not tell the group by from the column it selects.
    .groupBy(sql`1`).orderBy(sql`1`)
  return rows.map((r: any) => ({
    period: String(r.period), orders: Number(r.orders), grossCents: Number(r.grossCents), refundedCents: Number(r.refundedCents),
    netCents: Number(r.grossCents) - Number(r.refundedCents),
  }))
}

export interface Totals { orders: number; customers: number; grossCents: number; refundedCents: number; netCents: number; averageOrderCents: number }

/** The window's totals. The average order is what was paid per order, before refunds (the Dashboard's revenue ÷ orders). */
export async function salesTotals(db: any, companyId: string, w: Window): Promise<Totals> {
  const [r] = await db.select({
    orders: sql<number>`count(*)`,
    customers: sql<number>`count(distinct coalesce(${storeOrder.contactId}, lower(${storeOrder.customerEmail})))`,
    grossCents: sql<number>`coalesce(sum(${storeOrder.totalCents}), 0)`,
    refundedCents: sql<number>`coalesce(sum(${storeOrder.refundedCents}), 0)`,
  }).from(storeOrder).where(sql`${storeOrder.companyId} = ${companyId} and ${countedOrderCondition(storeOrder)} and ${inWindow(w)}`)
  const orders = Number(r?.orders ?? 0), gross = Number(r?.grossCents ?? 0), refunded = Number(r?.refundedCents ?? 0)
  return { orders, customers: Number(r?.customers ?? 0), grossCents: gross, refundedCents: refunded, netCents: gross - refunded, averageOrderCents: orders ? Math.round(gross / orders) : 0 }
}

export interface TopProduct { productId: string | null; name: string; units: number; salesCents: number; /** Sales and cost of the units that carried a cost; cost null = none of them did. */ costedSalesCents: number; costCents: number | null }

/**
 * The products that sold most in the window, by what they brought in. Units and sales are what stayed sold — a returned
 * unit (refunded_quantity) comes off both. A line is the price × quantity of the product alone: shipping, tax and a
 * discount code belong to the order, not to a product, so they are not shared out here. A product removed since is still
 * listed, by the name it had when it sold.
 */
export async function topProducts(db: any, companyId: string, w: Window, limit = 10): Promise<TopProduct[]> {
  const kept = sql`(${storeOrderItem.quantity} - ${storeOrderItem.refundedQuantity})`
  const key = sql`coalesce(${storeOrderItem.productId}, ${storeOrderItem.productName})`
  const rows = await db.select({
    productId: sql<string | null>`max(${storeOrderItem.productId})`,
    name: sql<string>`max(${storeOrderItem.productName})`,
    units: sql<number>`coalesce(sum(${kept}), 0)`,
    salesCents: sql<number>`coalesce(sum(${storeOrderItem.unitPriceCents} * ${kept}), 0)`,
    costedSalesCents: sql<number>`coalesce(sum(${storeOrderItem.unitPriceCents} * ${kept}) filter (where ${storeOrderItem.unitCostCents} is not null), 0)`,
    costCents: sql<number | null>`sum(${storeOrderItem.unitCostCents} * ${kept}) filter (where ${storeOrderItem.unitCostCents} is not null)`,
  }).from(storeOrderItem).innerJoin(storeOrder, sql`${storeOrder.id} = ${storeOrderItem.orderId}`)
    .where(sql`${storeOrder.companyId} = ${companyId} and ${countedOrderCondition(storeOrder)} and ${inWindow(w)}`)
    .groupBy(key)
    .having(sql`coalesce(sum(${kept}), 0) > 0`)
    .orderBy(sql`coalesce(sum(${storeOrderItem.unitPriceCents} * ${kept}), 0) desc`, sql`max(${storeOrderItem.productName}) asc`)
    .limit(limit)
  return rows.map((r: any) => ({ productId: r.productId ?? null, name: String(r.name), units: Number(r.units), salesCents: Number(r.salesCents), costedSalesCents: Number(r.costedSalesCents), costCents: r.costCents == null ? null : Number(r.costCents) }))
}

export interface Repeat {
  /** Shoppers who ordered in the window. */
  customers: number
  /** …of them, those who ordered before the window began, or more than once inside it. */
  repeat: number
  /** …and those whose first order ever is in the window. */
  firstTime: number
  /** What the repeat shoppers paid in the window, less refunds. */
  repeatNetCents: number
  /** repeat ÷ customers, 0 to 1 (0 when nobody ordered). */
  repeatRate: number
  /** The five who ordered most in the window, then by spend. */
  top: { customerId: string; name: string | null; email: string; orders: number; netCents: number }[]
}

/** Who came back. A shopper is the contact on the order, else the order's email in lower case (an old order has no contact). */
export async function repeatCustomers(db: any, companyId: string, w: Window): Promise<Repeat> {
  const who = sql`coalesce(${storeOrder.contactId}, lower(${storeOrder.customerEmail}))`
  const rows = await db.execute(sql`
    with counted as (
      select ${who} as who, ${storeOrder.customerEmail} as email, ${storeOrder.customerName} as name,
             ${localAt(w.timeZone)} as at, ${storeOrder.totalCents} - ${storeOrder.refundedCents} as net
        from ${storeOrder}
       where ${storeOrder.companyId} = ${companyId} and ${countedOrderCondition(storeOrder)}
         and ${localAt(w.timeZone)} < (${w.to}::date + 1)
    ), mine as (
      select who, count(*) filter (where at >= ${w.from}::date) as in_window,
             count(*) filter (where at < ${w.from}::date) as before,
             coalesce(sum(net) filter (where at >= ${w.from}::date), 0) as net,
             max(email) as email, max(name) as name
        from counted group by who
    )
    select who, in_window, before, net, email, name from mine where in_window > 0
    order by in_window desc, net desc, who asc`)
  const list: any[] = (rows as any).rows ?? rows
  const isRepeat = (r: any) => Number(r.before) > 0 || Number(r.in_window) > 1
  const repeat = list.filter(isRepeat)
  return {
    customers: list.length,
    repeat: repeat.length,
    firstTime: list.length - repeat.length,
    repeatNetCents: repeat.reduce((n, r) => n + Number(r.net), 0),
    repeatRate: list.length ? repeat.length / list.length : 0,
    top: repeat.slice(0, 5).map((r) => ({ customerId: String(r.who), name: r.name ?? null, email: String(r.email), orders: Number(r.in_window), netCents: Number(r.net) })),
  }
}

export interface Profit {
  /** What the product lines of the window sold for (returned units off), before shipping, tax and discount codes. */
  productSalesCents: number
  /** …of which these carried a cost: a unit cost kept on the line, or — a dropshipped order with none — the supplier's price for the order. */
  costedSalesCents: number
  costCents: number
  /** costedSales − cost. Only the costed part: an item with no cost is not counted as free. */
  profitCents: number
}

/**
 * Profit where a cost is stored. A line's cost is the unit cost kept on it when it sold; an order none of whose lines has one
 * but which a supplier fulfilled (supplier_cost_cents) is costed at what the supplier charged. Everything else has no cost
 * and is left out of the profit, and says so (costedSalesCents against productSalesCents).
 */
export async function profitTotals(db: any, companyId: string, w: Window): Promise<Profit> {
  const kept = sql`(${storeOrderItem.quantity} - ${storeOrderItem.refundedQuantity})`
  const rows = await db.execute(sql`
    with per_order as (
      select ${storeOrder.supplierCostCents} as supplier_cost,
             coalesce(sum(${storeOrderItem.unitPriceCents} * ${kept}), 0) as all_sales,
             sum(${storeOrderItem.unitPriceCents} * ${kept}) filter (where ${storeOrderItem.unitCostCents} is not null) as costed_sales,
             sum(${storeOrderItem.unitCostCents} * ${kept}) filter (where ${storeOrderItem.unitCostCents} is not null) as line_cost
        from ${storeOrder} join ${storeOrderItem} on ${storeOrderItem.orderId} = ${storeOrder.id}
       where ${storeOrder.companyId} = ${companyId} and ${countedOrderCondition(storeOrder)} and ${inWindow(w)}
       group by ${storeOrder.id}, ${storeOrder.supplierCostCents}
    )
    select coalesce(sum(all_sales), 0) as product_sales,
           coalesce(sum(case when line_cost is not null then costed_sales when supplier_cost is not null then all_sales end), 0) as costed_sales,
           coalesce(sum(case when line_cost is not null then line_cost when supplier_cost is not null then supplier_cost end), 0) as cost
      from per_order`)
  const r: any = ((rows as any).rows ?? rows)[0] ?? {}
  const sales = Number(r.product_sales ?? 0), costed = Number(r.costed_sales ?? 0), cost = Number(r.cost ?? 0)
  return { productSalesCents: sales, costedSalesCents: costed, costCents: cost, profitCents: costed - cost }
}

export interface DiscountCodeRow { code: string; orders: number; discountCents: number; netCents: number }

/** Per discount code: the orders it was used on, what it took off (the loyalty reward's share is not the code's), and what those orders kept. */
export async function discountCodes(db: any, companyId: string, w: Window): Promise<DiscountCodeRow[]> {
  const code = sql<string>`upper(${storeOrder.discountCode})`
  const rows = await db.select({
    code,
    orders: sql<number>`count(*)`,
    discountCents: sql<number>`coalesce(sum(greatest(0, ${storeOrder.discountCents} - ${storeOrder.loyaltyDiscountCents})), 0)`,
    netCents: sql<number>`coalesce(sum(${storeOrder.totalCents} - ${storeOrder.refundedCents}), 0)`,
  }).from(storeOrder)
    .where(sql`${storeOrder.companyId} = ${companyId} and ${countedOrderCondition(storeOrder)} and ${storeOrder.discountCode} is not null and ${storeOrder.discountCode} <> '' and ${inWindow(w)}`)
    .groupBy(sql`1`).orderBy(sql`3 desc`, sql`1 asc`)
  return rows.map((r: any) => ({ code: String(r.code), orders: Number(r.orders), discountCents: Number(r.discountCents), netCents: Number(r.netCents) }))
}
