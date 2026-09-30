import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { settledSale, taxCollected, taxNetExprBare, exciseNetExprBare, salesNetExprBare } from '../utils/revenue.ts'
import { medicalExciseExempt } from '../utils/tax.ts'

const app = new Hono()
// Manager and up. Every route in this file is the shop's position with the state — what it owes,
// what it has filed, what is outstanding. A budtender needs none of it to serve a customer, and it
// was readable by anyone signed in. Generating and reviewing a filing already required manager.
// (Dispensary T39 M3)
app.use('*', authenticate, requireRole('manager'))

/**
 * A filing that has actually been FILED.
 *
 * T49 H2: two separate summary queries summed every filing whatever its status, so "Total Filed"
 * read twelve times the tax the shop had collected while nothing had been filed at all — and
 * superseded filings still counted, leaving a set-aside return's money inside the total it was set
 * aside from. One fragment, used by both, so they cannot answer the same question two ways.
 *
 * 'confirmed' counts: it is 'filed' with the state's acknowledgement on it, and a return the state
 * has confirmed is the most filed a filing gets.
 */
const ACTUALLY_FILED = sql`status IN ('filed', 'confirmed')`

// GET /filings — List tax filings (paginated, filterable)
app.get('/filings', async (c) => {
  const currentUser = c.get('user') as any
  const filingType = c.req.query('type')
  const period = c.req.query('period')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let typeFilter = sql``
  if (filingType) typeFilter = sql`AND filing_type = ${filingType}`

  let periodFilter = sql``
  if (period) periodFilter = sql`AND period = ${period}`

  let statusFilter = sql``
  if (status) statusFilter = sql`AND status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT *,
      filing_type   AS "type",
      period_start  AS "startDate",
      period_end    AS "endDate",
      total_tax_due AS "totalAmount"
    FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      ${typeFilter}
      ${periodFilter}
      ${statusFilter}
    ORDER BY period_end DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      ${typeFilter}
      ${periodFilter}
      ${statusFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Map the filing-type values the UI offers onto the schema's filing_type enum
// (excise_tax|sales_tax|local_tax|combined).
const FILING_TYPE_MAP: Record<string, string> = {
  state_excise: 'excise_tax',
  local_excise: 'local_tax',
  city_tax: 'local_tax',
  sales_tax: 'sales_tax',
  excise_tax: 'excise_tax',
  local_tax: 'local_tax',
  combined: 'combined',
}

// POST /filings/generate — Generate a tax filing.
// The Tax Filing page posts { type, period, startDate, endDate }; older/API callers may send
// { filingType, periodStart, periodEnd, state }. Accept either loosely. `state` is optional
// (the UI does not collect it). Tax breakdown is stored in filing_data (schema has no per-type
// columns); tax_filings has no filing_number/total_orders/*_tax_due/category_breakdown columns.
app.post('/filings/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json().catch(() => ({}))

  const generateSchema = z.object({
    type: z.string().optional(),
    filingType: z.string().optional(),
    period: z.enum(['monthly', 'quarterly', 'annual']).default('monthly'),
    startDate: z.string().optional(),
    periodStart: z.string().optional(),
    endDate: z.string().optional(),
    periodEnd: z.string().optional(),
    state: z.string().optional(),
    jurisdiction: z.string().optional(),
  })
  const data = generateSchema.parse(body)

  const rawType = data.type || data.filingType || 'combined'
  const filingType = FILING_TYPE_MAP[rawType] || 'combined'
  const startStr = data.startDate || data.periodStart
  const endStr = data.endDate || data.periodEnd
  if (!startStr || !endStr) return c.json({ error: 'startDate and endDate are required' }, 400)

  const periodStart = new Date(startStr)
  const periodEnd = new Date(endStr)
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
    return c.json({ error: 'Invalid date range' }, 400)
  }
  // "2026-09-30" parses to the INSTANT that day begins, and the queries below bound on
  // `completed_at <= periodEnd` — so a September filing counted nothing that happened on the 30th,
  // and a single-day filing counted nothing at all. A period named by two dates means the whole of
  // both days, which is what the start bound already assumes. Only a bare date is extended; a caller
  // that sends a timestamp means that instant. (Dispensary T31, found proving L4)
  const periodEndBound = /^\d{4}-\d{2}-\d{2}$/.test(String(endStr))
    ? new Date(periodEnd.getTime() + 86_400_000 - 1)
    : periodEnd
  // The filing screen has no state box, so `state` arrived undefined and every filing was stamped
  // "NA" — on a return whose whole purpose is to name the state it is filed with, for a shop whose
  // record says OH. Fall back to the company's own state. (T45 H16)
  // settings too: whether this state's medical programme exempts patients from excise decides
  // whether those sales belong in the taxable base or on an exempt line. (T47 P5)
  const companyResult: any = await db.execute(sql`SELECT state, settings, excise_tax_rate FROM company WHERE id = ${currentUser.companyId} LIMIT 1`)
  const companyRow = (companyResult.rows || companyResult)[0] || {}
  const companyState = companyRow.state as string | null
  // The rate the shop is configured to charge, so the return can show whether what it collected
  // actually matches it. (T47 P5)
  const exciseRatePct = Number(companyRow.excise_tax_rate) || 0
  const state = (data.state || companyState)
    ? String(data.state || companyState).toUpperCase().slice(0, 2)
    : null

  // The sales tax was actually collected on, in the period. orders.subtotal/excise_tax/sales_tax/total_tax
  // are TEXT; NULLIF guards empty strings before the numeric cast.
  //
  // This counted status = 'completed' alone, which dropped every partially-refunded sale — and with it the
  // whole of that sale's tax, not just the refunded share. The figure a return is filed from was the one
  // under-reporting the liability. It now uses the same row set as the EOD and compliance tax reports, so
  // the number you file matches the number you reconcile against. (T23 H1)
  // Two row sets on purpose, and the difference is the whole of T31 L4.
  //
  // COUNT is "sales in this period", which has one answer everywhere in this product: the settled set,
  // fully refunded sales included. Filing over taxCollected alone reported 31 sales on a day every
  // other surface called 33, and a count that disagrees with the rest of the CRM is the kind of thing
  // a person notices on the one report they sign.
  //
  // MONEY stays on taxCollected. A sale handed back in full handed its tax back too, so it owes
  // nothing — but a legacy row refunded before refunded_tax existed records no returned tax, and
  // widening the sums would credit the state with its gross. The filing is not the place to find out.
  // (Dispensary T31 L4)
  const ordersResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_orders,
      COALESCE(SUM(CAST(NULLIF(subtotal, '') AS numeric)) FILTER (WHERE status IN ${taxCollected}), 0) as total_subtotal,
      -- NET of tax handed back with refunds, like every other tax surface. This summed the gross, so
      -- once refunds started being netted elsewhere (T29 M4) this became the one report left
      -- over-stating: $1,056.00 here against $1,031.68 everywhere else, the gap widening with every
      -- amount refund — on the figure someone actually files. There are TWO tax-filing surfaces, this
      -- route and the block inside compliance.ts, and M4 only found the other one. (Dispensary T31)
      COALESCE(SUM(${exciseNetExprBare}) FILTER (WHERE status IN ${taxCollected}), 0) as total_excise_tax,
      COALESCE(SUM(${salesNetExprBare}) FILTER (WHERE status IN ${taxCollected}), 0) as total_sales_tax,
      COALESCE(SUM(${taxNetExprBare}) FILTER (WHERE status IN ${taxCollected}), 0) as total_tax_collected,
      COALESCE(SUM(CAST(NULLIF(total, '') AS numeric)) FILTER (WHERE status IN ${taxCollected}), 0) as total_revenue
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${settledSale}
      AND completed_at >= ${periodStart}
      AND completed_at <= ${periodEndBound}
  `)
  const orderStats = ((ordersResult as any).rows || ordersResult)?.[0] || {}

  // Category breakdown
  const categoryResult = await db.execute(sql`
    SELECT
      oi.category,
      COUNT(DISTINCT o.id)::int as order_count,
      SUM(oi.quantity)::int as units_sold,
      COALESCE(SUM(CAST(NULLIF(oi.line_total, '') AS numeric)), 0) as category_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.company_id = ${currentUser.companyId}
      AND o.status = 'completed'
      AND o.completed_at >= ${periodStart}
      AND o.completed_at <= ${periodEndBound}
    GROUP BY oi.category
    ORDER BY category_revenue DESC
  `)
  const categoryBreakdown = (categoryResult as any).rows || categoryResult

  // What the tax is charged ON, split the way the filings are.
  //
  // T45 H16: an excise filing reported a taxable amount of $10,049 — every sale's gross subtotal,
  // T-shirts included, before a single refund — beside $951.90 of tax due, which IS net and IS
  // cannabis-only. Two numbers on one return computed over different sets, and the one a state
  // reads first was the wrong one. Excise is charged on cannabis; sales tax on the lot; and a
  // refunded unit was never sold. order_items.tax_category is stamped 'cannabis'/'non_cannabis'
  // at sale time, and refunded_quantity is the count handed back, so the split is recorded, not
  // inferred.
  const netLine = sql`
    COALESCE(NULLIF(oi.line_total, ''), NULLIF(oi.total_price, ''), '0')::numeric
    * (GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.refunded_quantity, 0), 0)::numeric
       / NULLIF(COALESCE(oi.quantity, 0), 0))
  `
  // …and the DISCOUNT comes off the base, because it came off the base when the tax was charged.
  //
  // T46 N17: excise due of $972.90 sat beside a taxable base of $6,849 — 14.2%, against a 15%
  // rate. Neither figure was wrong on its own: the due is the excise the tills actually took, and
  // the base was the sum of the cannabis lines. But the tills charge on the DISCOUNTED base
  // (assessTax: cannabisSubtotal − discount × cannabis share), and the base reported here did not
  // subtract a penny of discount. A return whose own three figures do not divide into one another
  // is the first thing an auditor notices, and the shop cannot explain it.
  //
  // Worked per ORDER and then summed, because the discount is an order-level figure apportioned
  // across that order's own cannabis share — averaging it over the period would be a different
  // number. The refund proration is the line-level one already in use, applied to the discount
  // too: a discount on goods that came back was not a discount in the end.
  const taxableResult = await db.execute(sql`
    WITH per_order AS (
      SELECT
        o.id,
        COALESCE(SUM(${netLine}) FILTER (WHERE oi.tax_category = 'cannabis'), 0) AS cannabis_net,
        COALESCE(SUM(${netLine}), 0) AS all_net,
        COALESCE(SUM(COALESCE(NULLIF(oi.line_total, ''), NULLIF(oi.total_price, ''), '0')::numeric), 0) AS all_gross,
        COALESCE(NULLIF(o.discount_amount, ''), '0')::numeric
          + COALESCE(NULLIF(o.loyalty_discount, ''), '0')::numeric AS discount,
        COALESCE(o.is_medical, false) AS is_medical,
        COUNT(oi.id)::int AS lines
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.company_id = ${currentUser.companyId}
        AND o.status IN ${taxCollected}
        AND o.completed_at >= ${periodStart}
        AND o.completed_at <= ${periodEndBound}
      GROUP BY o.id, o.discount_amount, o.loyalty_discount, o.is_medical
    ), apportioned AS (
      SELECT
        cannabis_net,
        all_net,
        lines,
        is_medical,
        LEAST(discount * (CASE WHEN all_gross > 0 THEN all_net / all_gross ELSE 0 END), all_net) AS discount_net
      FROM per_order
    )
    SELECT
      COALESCE(SUM(GREATEST(cannabis_net - discount_net * (CASE WHEN all_net > 0 THEN cannabis_net / all_net ELSE 0 END), 0)), 0) AS cannabis_net,
      COALESCE(SUM(GREATEST(all_net - discount_net, 0)), 0) AS all_net,
      COALESCE(SUM(GREATEST(cannabis_net - discount_net * (CASE WHEN all_net > 0 THEN cannabis_net / all_net ELSE 0 END), 0))
        FILTER (WHERE is_medical), 0) AS medical_cannabis_net,
      COALESCE(SUM(lines), 0)::int AS line_count
    FROM apportioned
  `)
  const taxableRow = ((taxableResult as any).rows || taxableResult)?.[0] || {}
  const round2 = (n: number) => Math.round(n * 100) / 100
  const cannabisNet = round2(Number(taxableRow.cannabis_net) || 0)
  const allLinesNet = round2(Number(taxableRow.all_net) || 0)
  // A shop whose sales predate line-level tax_category has no split to read; falling back to the
  // order subtotal is the old behaviour and better than reporting zero.
  const hasLineDetail = Number(taxableRow.line_count) > 0

  const filingNumber = `TAX-${filingType.toUpperCase().replace(/_/g, '')}-${state || 'NA'}-${startStr.slice(0, 7)}-${Date.now().toString(36).toUpperCase()}`

  // Local tax uses the rate configured in Settings (company.local_tax_rate, a
  // percent). Default 0 — never fabricate a rate. Excise/sales come from the real
  // per-order tax columns summed above.
  const localRateResult: any = await db.execute(sql`SELECT COALESCE(NULLIF(local_tax_rate, ''), '0') AS local_tax_rate FROM company WHERE id = ${currentUser.companyId}`)
  const localRatePct = Number(((localRateResult.rows || localRateResult)[0] || {}).local_tax_rate) || 0

  // Determine tax amounts based on filing type
  let exciseTaxDue = Number(orderStats.total_excise_tax) || 0
  let salesTaxDue = Number(orderStats.total_sales_tax) || 0
  let localTaxDue = 0

  // The base each filing type is charged on — the same set its tax due was computed over. (T45 H16)
  const grossSubtotal = Number(orderStats.total_subtotal) || 0
  const netAllSales = hasLineDetail ? allLinesNet : grossSubtotal
  const netCannabisSales = hasLineDetail ? cannabisNet : grossSubtotal
  let taxableAmount = netAllSales

  // Cannabis sold to a registered patient, which this state's programme exempts from excise.
  const medicalExemptSales = hasLineDetail ? round2(Number(taxableRow.medical_cannabis_net) || 0) : 0
  const exemptApplies = filingType === 'excise_tax' && medicalExciseExempt(companyRow) && medicalExemptSales > 0

  if (filingType === 'excise_tax') {
    salesTaxDue = 0
    // Excise is charged on cannabis, not on the T-shirt beside it — and not on a patient's
    // medicine either.
    //
    // T47 P5: taxable $7,079 beside $998.40 due is 14.1%, not the 15% on the return, and a set of
    // figures that do not divide is the first thing an auditor asks about. Neither number was
    // wrong: the due is the excise the tills actually took, and the tills charge a registered
    // patient nothing (utils/tax.ts: medicalExciseExempt). The BASE was the one hiding something —
    // it counted medical sales that were never charged a penny of excise.
    //
    // So the exempt sales come out of the base and are reported on their own line. A return that
    // shows $6,656 taxable, $423 exempt and $998.40 due at 15% is a return a shop can defend; one
    // that quietly folds the exempt sales into the base and lands at 14.1% is not.
    taxableAmount = exemptApplies ? round2(netCannabisSales - medicalExemptSales) : netCannabisSales
  } else if (filingType === 'sales_tax') {
    exciseTaxDue = 0
  } else if (filingType === 'local_tax') {
    exciseTaxDue = 0
    salesTaxDue = 0
    localTaxDue = round2(netAllSales * (localRatePct / 100))
  }

  const totalTaxDue = round2(exciseTaxDue + salesTaxDue + localTaxDue)
  const totalCollected = Number(orderStats.total_tax_collected) || 0

  // WHICH orders are out of step with the rate.
  //
  // T48, the tester's answer to "is reconciles: false useful?": "Mostly. But a shop owner can't
  // find 'orders created outside the register' alone. List the orders charged below the rate, with
  // order number, date and excise taken, and the note becomes something they can act on." They are
  // right — the note named a variance and then handed the owner a haystack.
  //
  // Same arithmetic as the taxable base above, per order rather than summed, so a line here and the
  // total on the return cannot disagree. Medical orders are skipped where the exemption applies:
  // they are SUPPOSED to carry no excise, and listing them as undercharged would bury the real
  // ones under every patient sale of the period.
  let varianceOrders: any[] = []
  if (filingType === 'excise_tax' && exciseRatePct > 0 && hasLineDetail) {
    const varianceResult = await db.execute(sql`
      WITH per_order AS (
        SELECT
          o.id, o.number, o.completed_at,
          ${exciseNetExprBare} AS excise_collected,
          COALESCE(SUM(${netLine}) FILTER (WHERE oi.tax_category = 'cannabis'), 0) AS cannabis_net,
          COALESCE(SUM(${netLine}), 0) AS all_net,
          COALESCE(SUM(COALESCE(NULLIF(oi.line_total, ''), NULLIF(oi.total_price, ''), '0')::numeric), 0) AS all_gross,
          COALESCE(NULLIF(o.discount_amount, ''), '0')::numeric
            + COALESCE(NULLIF(o.loyalty_discount, ''), '0')::numeric AS discount,
          COALESCE(o.is_medical, false) AS is_medical
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.company_id = ${currentUser.companyId}
          AND o.status IN ${taxCollected}
          AND o.completed_at >= ${periodStart}
          AND o.completed_at <= ${periodEndBound}
        GROUP BY o.id, o.number, o.completed_at, o.excise_tax, o.refunded_excise_tax,
                 o.discount_amount, o.loyalty_discount, o.is_medical
      ), based AS (
        SELECT number, completed_at, excise_collected, is_medical,
          GREATEST(
            cannabis_net - LEAST(discount * (CASE WHEN all_gross > 0 THEN all_net / all_gross ELSE 0 END), all_net)
              * (CASE WHEN all_net > 0 THEN cannabis_net / all_net ELSE 0 END),
            0) AS base
        FROM per_order
      )
      SELECT number, completed_at, excise_collected, base,
             ROUND(base * ${exciseRatePct} / 100.0, 2) AS expected
      FROM based
      WHERE base > 0
        AND ${exemptApplies ? sql`is_medical = false` : sql`true`}
        AND ABS(excise_collected - base * ${exciseRatePct} / 100.0) > 0.005
      ORDER BY ABS(excise_collected - base * ${exciseRatePct} / 100.0) DESC
      LIMIT 50
    `)
    varianceOrders = ((varianceResult as any).rows || varianceResult).map((r: any) => ({
      orderNumber: r.number,
      date: r.completed_at ? String(r.completed_at).slice(0, 10) : null,
      taxableBase: round2(Number(r.base) || 0),
      exciseTaken: round2(Number(r.excise_collected) || 0),
      exciseExpected: round2(Number(r.expected) || 0),
      difference: round2((Number(r.excise_collected) || 0) - (Number(r.expected) || 0)),
    }))
  }

  // Line items the detail modal renders (only non-zero components).
  const lineItems = [
    { description: 'Excise Tax', amount: exciseTaxDue },
    { description: 'Sales Tax', amount: salesTaxDue },
    { description: 'Local Tax', amount: localTaxDue },
  ].filter(li => li.amount > 0)

  const filingData = {
    filingNumber,
    totalOrders: orderStats.total_orders || 0,
    taxableSales: taxableAmount,
    // Show the working, so the person signing the return can see what was excluded and why.
    // (T45 H16; the discount and the medical exemption named since, T46 N17 and T47 P5 — a basis
    // that says "net of refunds" while the base is also net of discounts and exemptions is a
    // sentence that does not describe its own number.)
    taxableBasis: filingType === 'excise_tax'
      ? `cannabis sales, net of refunds and discounts${exemptApplies ? ', excluding medical (exempt)' : ''}`
      : 'all sales, net of refunds and discounts',
    // The exempt line, so the three figures on the return divide into one another.
    exemptSales: exemptApplies ? medicalExemptSales : 0,
    exemptBasis: exemptApplies ? 'medical cannabis — registered patients are exempt from excise in this state' : null,
    // What the return actually works out at, for the person signing it.
    effectiveRate: taxableAmount > 0 ? round2((exciseTaxDue / taxableAmount) * 100) : 0,
    // …and what it WOULD come to at the shop's configured rate, with the difference named.
    //
    // The base and the due are computed over the same set and both are net of refunds and
    // discounts, so on a shop whose till has always charged correctly these agree. When they do
    // not, the shop under- or over-collected — a rate changed mid-period, a sale rung up before
    // the rate was configured, an order written straight into the database by an integration.
    // That is exactly what a return must not hide: the first thing an auditor does is divide.
    //
    // Saying "$6,839 taxable, $983.40 due, and $42.45 less collected than 15% because of these
    // orders" is a return a shop can defend. Printing 14.38% beside a 15% rate and leaving them to
    // notice is not. (T47 P5, the half that only shows on real data)
    expectedAtRate: filingType === 'excise_tax' && exciseRatePct > 0 ? round2(taxableAmount * (exciseRatePct / 100)) : null,
    collectedVariance: filingType === 'excise_tax' && exciseRatePct > 0
      ? round2(exciseTaxDue - taxableAmount * (exciseRatePct / 100))
      : null,
    reconciles: filingType === 'excise_tax' && exciseRatePct > 0
      ? Math.abs(exciseTaxDue - taxableAmount * (exciseRatePct / 100)) <= Math.max(0.5, taxableAmount * 0.0005)
      : null,
    reconcileNote: filingType === 'excise_tax' && exciseRatePct > 0
        && Math.abs(exciseTaxDue - taxableAmount * (exciseRatePct / 100)) > Math.max(0.5, taxableAmount * 0.0005)
      ? `The excise collected is $${Math.abs(round2(exciseTaxDue - taxableAmount * (exciseRatePct / 100))).toFixed(2)} ${exciseTaxDue < taxableAmount * (exciseRatePct / 100) ? 'less' : 'more'} than ${exciseRatePct}% of the taxable base.${varianceOrders.length ? ` ${varianceOrders.length === 1 ? 'One order is' : `${varianceOrders.length} orders are`} out of step with the rate — they are listed under "orders out of step" with the excise each one took.` : ' Some sales in this period were not charged at the current rate — check sales made before the rate was set, or orders created outside the register.'}`
      : null,
    // The orders behind the variance, named. Empty when everything reconciles, so a clean period
    // carries no list at all. (T48, the tester's ask on P5)
    varianceOrders,
    grossSales: round2(grossSubtotal),
    netSales: netAllSales,
    netCannabisSales,
    netNonCannabisSales: round2(netAllSales - netCannabisSales),
    state,
    exciseTaxDue,
    salesTaxDue,
    localTaxDue,
    categoryBreakdown,
    lineItems,
  }

  // Store filing using the real tax_filings columns.
  const result = await db.execute(sql`
    INSERT INTO tax_filings (
      id, filing_type, period, period_start, period_end, state, jurisdiction, status,
      total_taxable_amount, total_tax_due, total_tax_collected, filing_data,
      company_id, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(), ${filingType}, ${data.period},
      ${periodStart}, ${periodEnd}, ${state}, ${data.jurisdiction || null},
      'calculated',
      ${taxableAmount.toFixed(2)}, ${totalTaxDue.toFixed(2)}, ${totalCollected.toFixed(2)},
      ${JSON.stringify(filingData)}::jsonb,
      ${currentUser.companyId}, NOW(), NOW()
    )
    RETURNING *, filing_type AS "type", period_start AS "startDate", period_end AS "endDate", total_tax_due AS "totalAmount"
  `)

  const filing = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'tax_filing',
    entityId: filing?.id,
    entityName: filingNumber,
    metadata: { filingType, period: data.period, state, totalTaxDue },
    req: c,
  })

  return c.json(filing, 201)
})

// PUT /filings/:id/review — Mark as reviewed (manager+)
app.put('/filings/:id/review', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // tax_filings has no reviewed_at / reviewed_by columns — only status + updated_at.
  const result = await db.execute(sql`
    UPDATE tax_filings
    SET status = 'reviewed', updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Filing not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'tax_filing',
    entityId: id,
    entityName: updated.filing_number,
    changes: { status: { old: 'calculated', new: 'reviewed' } },
    req: c,
  })

  return c.json(updated)
})

/**
 * PUT /filings/:id/supersede — this one was a mistake, or has been replaced.
 *
 * T48 Q8. A filing cannot be deleted and should not be: it is a tax record, and a product that
 * lets someone quietly remove one is a product that helps hide a number from a regulator. But
 * "immutable" was being used to mean "nothing can ever be said about it", and the result is a list
 * where a filing generated by mistake sits beside the real ones looking exactly as authoritative.
 * The tester's three from one afternoon, and fourteen of mine, are all still in there.
 *
 * Superseding keeps the row, its figures and its audit trail exactly as they are, and records that
 * it is no longer the current one — with a reason, because "why is this one not current" is the
 * question it exists to answer. The upcoming-deadlines view already looks only at calculated,
 * reviewed and filed, so a superseded filing stops counting as work outstanding on its own.
 *
 * A filing that has actually been FILED is not supersedable. That one was submitted to the state;
 * saying it never counted is rewriting history rather than recording it. The honest move there is
 * a new amended filing, and the refusal says so.
 */
app.put('/filings/:id/supersede', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const parsed = z.object({
    reason: z.string().trim().min(1, 'Say why this filing is being superseded').max(500),
  }).safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({
      error: 'Say why this filing is being superseded — generated by mistake, replaced by a corrected run, wrong period.',
      code: 'supersede_needs_reason',
    }, 400)
  }
  const why = parsed.data.reason

  const foundResult = await db.execute(sql`
    SELECT * FROM tax_filings WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const found = ((foundResult as any).rows || foundResult)?.[0]
  if (!found) return c.json({ error: 'Filing not found' }, 404)

  if (found.status === 'filed' || found.status === 'confirmed') {
    return c.json({
      error: 'This filing has already been submitted, so it cannot be set aside. Generate an amended filing for the same period instead — the submitted one has to stay as it was filed.',
      code: 'already_filed',
    }, 400)
  }
  if (found.status === 'superseded') {
    return c.json({ error: 'This filing is already superseded.', code: 'already_superseded' }, 400)
  }

  const stamp = `Superseded ${new Date().toISOString().slice(0, 10)}: ${why}`
  const result = await db.execute(sql`
    UPDATE tax_filings
    SET status = 'superseded',
        notes = CASE WHEN COALESCE(notes, '') = '' THEN ${stamp} ELSE notes || E'\n' || ${stamp} END,
        updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)
  const updated = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'tax_filing',
    entityId: id,
    entityName: updated.filing_number,
    changes: { status: { old: found.status, new: 'superseded' } },
    metadata: { reason: why },
    req: c,
  })

  return c.json(updated)
})

// PUT /filings/:id/file — Mark as filed
app.put('/filings/:id/file', requireRole('admin'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { confirmationNumber } = z.object({ confirmationNumber: z.string().min(1) }).parse(await c.req.json())

  // A filing somebody set aside must not be submittable afterwards — that is the whole point of
  // setting it aside, and the state would be receiving a return the shop has already disowned. (T48 Q8)
  const beforeResult = await db.execute(sql`
    SELECT status FROM tax_filings WHERE id = ${id} AND company_id = ${currentUser.companyId} LIMIT 1
  `)
  const before = ((beforeResult as any).rows || beforeResult)?.[0]
  if (!before) return c.json({ error: 'Filing not found' }, 404)
  if (before.status === 'superseded') {
    return c.json({
      error: 'This filing was superseded, so it cannot be submitted. Generate a fresh filing for the period and submit that one.',
      code: 'filing_superseded',
    }, 400)
  }

  const result = await db.execute(sql`
    UPDATE tax_filings
    SET status = 'filed', confirmation_number = ${confirmationNumber}, filed_at = NOW(), filed_by = ${currentUser.userId}, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Filing not found' }, 404)

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'tax_filing',
    entityId: id,
    entityName: updated.filing_number,
    changes: { status: { old: updated.status, new: 'filed' } },
    metadata: { confirmationNumber },
    req: c,
  })

  return c.json(updated)
})

// GET /filings/upcoming — Upcoming filing deadlines
app.get('/filings/upcoming', async (c) => {
  const currentUser = c.get('user') as any

  // Determine upcoming deadlines based on common filing periods
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const deadlines: any[] = []

  // Monthly excise tax: due 20th of following month
  const monthlyDue = new Date(currentYear, currentMonth + 1, 20)
  deadlines.push({
    type: 'excise_tax',
    period: 'monthly',
    periodLabel: new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    dueDate: monthlyDue.toISOString().split('T')[0],
    daysUntilDue: Math.ceil((monthlyDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  })

  // Monthly sales tax: due last day of following month
  const salesTaxDue = new Date(currentYear, currentMonth + 2, 0)
  deadlines.push({
    type: 'sales_tax',
    period: 'monthly',
    periodLabel: new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    dueDate: salesTaxDue.toISOString().split('T')[0],
    daysUntilDue: Math.ceil((salesTaxDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  })

  // Quarterly: due last day of month following quarter end
  const quarterEnd = Math.floor(currentMonth / 3) * 3 + 2
  if (currentMonth <= quarterEnd) {
    const quarterlyDue = new Date(currentYear, quarterEnd + 2, 0)
    const quarterLabel = `Q${Math.floor(quarterEnd / 3) + 1} ${currentYear}`
    deadlines.push({
      type: 'combined',
      period: 'quarterly',
      periodLabel: quarterLabel,
      dueDate: quarterlyDue.toISOString().split('T')[0],
      daysUntilDue: Math.ceil((quarterlyDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    })
  }

  // Check which filings already exist
  const existingResult = await db.execute(sql`
    SELECT filing_type, period, period_start, period_end, status FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      AND status IN ('calculated', 'reviewed', 'filed')
    ORDER BY period_end DESC
    LIMIT 20
  `)
  const existingFilings = (existingResult as any).rows || existingResult

  return c.json({ deadlines, recentFilings: existingFilings })
})

// GET /filings/summary — Tax summary: YTD totals
app.get('/filings/summary', async (c) => {
  const currentUser = c.get('user') as any

  const yearStart = new Date(new Date().getFullYear(), 0, 1)

  // orders.excise_tax/sales_tax/total_tax are TEXT; NULLIF guards empty strings before cast.
  const collectedResult = await db.execute(sql`
    SELECT
      -- NET of tax handed back with returns, like every other tax surface in this product. Summing
      -- the gross here is what made Tax Filing read $1,056.00 against $1,031.68 everywhere else, and
      -- the gap grew with every amount refund. (Dispensary T31 M3)
      COALESCE(SUM(${exciseNetExprBare}), 0) as excise_collected,
      COALESCE(SUM(${salesNetExprBare}), 0) as sales_collected,
      COALESCE(SUM(${taxNetExprBare}), 0) as total_collected
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${taxCollected}
      AND completed_at >= ${yearStart}
  `)
  const collected = ((collectedResult as any).rows || collectedResult)?.[0] || {}

  // tax_filings.total_tax_due is a TEXT column; SUM(text) throws — cast per-row (NULLIF guards
  // empty strings). (schema fix)
  //
  // …and "filed" means FILED. (T49 H2)
  //
  // This summed every filing whatever its status, so the screen read Total Collected $1,766.74 and
  // Total Filed $22,198.19 — twelve times the tax the shop had taken — while nothing had actually
  // been filed at all: all 23 rows were still 'calculated'. Superseded filings were in there too,
  // so setting one aside left its money in the total it was set aside from, which is half of Q8
  // undone. A Total Filed bigger than Total Collected is the kind of number that stops an owner
  // trusting the module, and they would be right.
  const filedResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CAST(NULLIF(total_tax_due, '') AS numeric)) FILTER (WHERE ${ACTUALLY_FILED}), 0) as total_filed,
      COUNT(*) FILTER (WHERE ${ACTUALLY_FILED})::int as filings_filed,
      COUNT(*) FILTER (WHERE status IN ('calculated', 'reviewed'))::int as filings_outstanding
    FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      AND period_end >= ${yearStart}
  `)
  const filed = ((filedResult as any).rows || filedResult)?.[0] || {}

  return c.json({
    totalCollectedYTD: Number(collected.total_collected) || 0,
    exciseCollectedYTD: Number(collected.excise_collected) || 0,
    salesCollectedYTD: Number(collected.sales_collected) || 0,
    totalFiledYTD: Number(filed.total_filed) || 0,
    totalOutstanding: Math.max(0, (Number(collected.total_collected) || 0) - (Number(filed.total_filed) || 0)),
    filingsFiled: filed.filings_filed || 0,
    filingsOutstanding: filed.filings_outstanding || 0,
  })
})

// GET /filings/:id — Filing detail with breakdown.
// Declared AFTER the literal /filings/upcoming and /filings/summary routes so the ':id'
// wildcard doesn't shadow them (previously they resolved here and 404'd as "Filing not found").
app.get('/filings/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    SELECT *,
      filing_type   AS "type",
      period_start  AS "startDate",
      period_end    AS "endDate",
      total_tax_due AS "totalAmount",
      filing_data->'lineItems' AS "lineItems"
    FROM tax_filings
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const filing = ((result as any).rows || result)?.[0]
  if (!filing) return c.json({ error: 'Filing not found' }, 404)

  return c.json(filing)
})

// GET /deadlines — Upcoming filing deadlines as a flat array (Upcoming tab).
// Each item: { type, period, description, dueDate }.
app.get('/deadlines', async (c) => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const monthLabel = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const deadlines: any[] = []

  // Monthly excise tax: due the 20th of the following month
  deadlines.push({
    type: 'excise_tax',
    period: 'monthly',
    description: `Excise tax for ${monthLabel}`,
    dueDate: new Date(y, m + 1, 20).toISOString().split('T')[0],
  })

  // Monthly sales tax: due the last day of the following month
  deadlines.push({
    type: 'sales_tax',
    period: 'monthly',
    description: `Sales tax for ${monthLabel}`,
    dueDate: new Date(y, m + 2, 0).toISOString().split('T')[0],
  })

  // Quarterly combined: due the last day of the month following quarter end
  const quarterEnd = Math.floor(m / 3) * 3 + 2
  deadlines.push({
    type: 'combined',
    period: 'quarterly',
    description: `Q${Math.floor(quarterEnd / 3) + 1} ${y} combined filing`,
    dueDate: new Date(y, quarterEnd + 2, 0).toISOString().split('T')[0],
  })

  return c.json(deadlines)
})

// GET /summary — YTD tax summary (Summary tab).
// { totalCollected, totalFiled, outstanding, breakdown: [{ type, collected, filed, outstanding }] }.
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const yearStart = new Date(new Date().getFullYear(), 0, 1)

  // orders.excise_tax/sales_tax/total_tax/total are TEXT; NULLIF guards empty strings.
  const collectedResult = await db.execute(sql`
    SELECT
      -- NET of tax handed back with returns, like every other tax surface in this product. Summing
      -- the gross here is what made Tax Filing read $1,056.00 against $1,031.68 everywhere else, and
      -- the gap grew with every amount refund. (Dispensary T31 M3)
      COALESCE(SUM(${exciseNetExprBare}), 0) as excise_collected,
      COALESCE(SUM(${salesNetExprBare}), 0) as sales_collected,
      COALESCE(SUM(${taxNetExprBare}), 0) as total_collected
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status IN ${taxCollected}
      AND completed_at >= ${yearStart}
  `)
  const collected = ((collectedResult as any).rows || collectedResult)?.[0] || {}

  // tax_filings.total_tax_due is TEXT; cast per-row. Group filed amounts by filing_type.
  //
  // The SAME filter as /filings/summary, through the same named fragment. These two queries answer
  // the same question on two screens and both had the same bug: the tester found the Excise "filed"
  // line at $19,658.25 — every excise filing ever generated, superseded ones included — and the
  // whole Local Tax line was one superseded combined filing. (T49 H2)
  const filedResult = await db.execute(sql`
    SELECT filing_type,
      COALESCE(SUM(CAST(NULLIF(total_tax_due, '') AS numeric)), 0) as filed
    FROM tax_filings
    WHERE company_id = ${currentUser.companyId}
      AND period_end >= ${yearStart}
      AND ${ACTUALLY_FILED}
    GROUP BY filing_type
  `)
  const filedRows = (filedResult as any).rows || filedResult
  const filedByType: Record<string, number> = {}
  let totalFiled = 0
  for (const r of filedRows) {
    filedByType[r.filing_type] = Number(r.filed) || 0
    totalFiled += Number(r.filed) || 0
  }

  const exciseCollected = Number(collected.excise_collected) || 0
  const salesCollected = Number(collected.sales_collected) || 0
  const totalCollected = Number(collected.total_collected) || 0
  const localCollected = Math.max(0, totalCollected - exciseCollected - salesCollected)

  const row = (type: string, label: string, coll: number, filed: number) => ({
    type: label,
    collected: coll,
    filed,
    outstanding: Math.max(0, coll - filed),
  })

  const breakdown = [
    row('excise_tax', 'Excise Tax', exciseCollected, filedByType['excise_tax'] || 0),
    row('sales_tax', 'Sales Tax', salesCollected, filedByType['sales_tax'] || 0),
    row('local_tax', 'Local Tax', localCollected, (filedByType['local_tax'] || 0) + (filedByType['combined'] || 0)),
  ]

  return c.json({
    totalCollected,
    totalFiled,
    outstanding: Math.max(0, totalCollected - totalFiled),
    breakdown,
  })
})

export default app
