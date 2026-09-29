import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql, eq } from 'drizzle-orm'
import { company } from '../../db/schema.ts'
import { storeTimeZone, storeDateString } from '../utils/isoTime.ts'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { taxCollected, settledSale } from '../utils/revenue.ts'
import { zodRefusal } from '../utils/errors.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── POST /generate ── Generate EOD report for a date + location ─────────────

const generateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // IDs across this app are cuid2 (createId), not UUIDs, so `.uuid()` here
  // rejected every real location id. Location is also optional — the report
  // aggregates company-wide for the date and just labels the row.
  locationId: z.string().min(1).optional(),
})

app.post('/generate', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  let data: z.infer<typeof generateSchema>
  try {
    data = generateSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json(zodRefusal(err), 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const reportDate = data.date
  const locationId = data.locationId

  // End of day means the end of the STORE's day. created_at is a naive UTC timestamp, so DATE(created_at)
  // cut the report at UTC midnight: the last hours of the evening — four of them in Ohio — were counted
  // on the next day's reconciliation, which is precisely the report a manager uses to square the drawer
  // against the till. Label it UTC, read it in the store's zone. (T24 N1)
  const [coRow] = await db.select({ settings: company.settings, state: company.state })
    .from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const tzDay = storeTimeZone(coRow)

  // A day that has not happened has nothing to reconcile. T45 M18 generated one for a future date
  // and got a report of zeros that then sits in the history looking like a day with no trade.
  // "Today" is the store's today, for the same reason the report itself is.
  const storeToday = storeDateString(new Date(), tzDay)
  if (reportDate > storeToday) {
    return c.json({
      error: `${reportDate} has not happened yet — End of Day can only be run up to ${storeToday}`,
      code: 'future_date',
    }, 400)
  }

  // ── Orders summary ──
  // Revenue/tax/count are COMPLETED-only. Previously order_count and total_revenue had no
  // status filter, so refunded and voided orders inflated Total Revenue while the cash
  // breakdown (status='completed') excluded them — EOD showed revenue $1,058.40 next to
  // Cash $0.00. Refunds/voids are reported on their own lines. (retest#7)
  const ordersResult = await db.execute(sql`
    SELECT
      -- "How many sales today" has one answer in this product: the settled set, fully refunded
      -- sales included. This counted completed + partially refunded only, so End of Day reported
      -- fewer sales than the dashboard for the same day and neither number was wrong on its own
      -- terms — they were answering different questions with the same words. (T45 M18)
      COUNT(*) FILTER (WHERE status IN ${settledSale})::int as order_count,
      -- NET revenue: partial refunds subtract what was returned; full refunds count $0 (QA V-3).
      COALESCE(SUM(total::numeric - COALESCE(NULLIF(refunded_amount, '')::numeric, 0)) FILTER (WHERE status IN ('completed', 'partially_refunded')), 0) as total_revenue,
      -- These three were already right; they are pinned to the shared row set so they cannot drift away
      -- from it, which is how six surfaces came to answer this three different ways. (T23 H1)
      COALESCE(SUM(excise_tax::numeric) FILTER (WHERE status IN ${taxCollected}), 0) as total_excise_tax,
      COALESCE(SUM(sales_tax::numeric) FILTER (WHERE status IN ${taxCollected}), 0) as total_sales_tax,
      COALESCE(SUM(total_tax::numeric) FILTER (WHERE status IN ${taxCollected}), 0) as total_tax,
      COALESCE(SUM(discount_amount::numeric) FILTER (WHERE status IN ('completed', 'partially_refunded')), 0) as total_discounts,
      COUNT(*) FILTER (WHERE status IN ('refunded', 'partially_refunded'))::int as refund_count,
      COALESCE(SUM(COALESCE(NULLIF(refunded_amount, '')::numeric, total::numeric)) FILTER (WHERE status IN ('refunded', 'partially_refunded')), 0) as refund_total,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int as void_count
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
  `)
  const orderStats = ((ordersResult as any).rows || ordersResult)?.[0] || {}

  // Revenue by payment method
  const paymentResult = await db.execute(sql`
    SELECT
      payment_method,
      COUNT(*)::int as count,
      COALESCE(SUM(total::numeric), 0) as total
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
      AND status = 'completed'
    GROUP BY payment_method
    ORDER BY total DESC
  `)
  const revenueByPaymentMethod = (paymentResult as any).rows || paymentResult

  // ── Cash reconciliation ──
  // expected_amount is only persisted when the drawer is CLOSED, so a mid-day EOD on an
  // open drawer showed Expected $0.00 (retest#6 N2). Also compute a live expected from the
  // session's cash orders (opening + cash sales - refunds) and use it when the drawer is
  // still open. Net cash added per sale == order total (tendered - change == total).
  const cashResult = await db.execute(sql`
    SELECT
      cs.opening_amount,
      cs.closing_amount,
      cs.actual_count,
      cs.expected_amount,
      cs.variance,
      cs.status as session_status,
      cs.opened_at,
      cs.closed_at,
      cs.register,
      opener.first_name || ' ' || opener.last_name AS opened_by_name,
      closer.first_name || ' ' || closer.last_name AS closed_by_name,
      -- Same attribution as cash.ts (go-live QA M-3): cash IN = cash sales settled in the window
      -- regardless of later refund status; cash OUT = refunds PAID in the window (refunded_at / refunded_amount).
      COALESCE((SELECT SUM(o.total::numeric) FROM orders o
        WHERE o.company_id = cs.company_id AND o.status IN ('completed', 'refunded', 'partially_refunded') AND o.payment_method = 'cash'
          AND o.completed_at >= cs.opened_at
          AND (cs.closed_at IS NULL OR o.completed_at <= cs.closed_at)), 0) as cash_sales,
      COALESCE((SELECT SUM(NULLIF(o.refunded_amount, '')::numeric) FROM orders o
        WHERE o.company_id = cs.company_id AND o.status IN ('refunded', 'partially_refunded') AND o.payment_method = 'cash'
          AND o.refunded_at >= cs.opened_at
          AND (cs.closed_at IS NULL OR o.refunded_at <= cs.closed_at)), 0) as cash_refunds
    FROM cash_sessions cs
    LEFT JOIN "user" opener ON opener.id = cs.opened_by_id
    LEFT JOIN "user" closer ON closer.id = cs.closed_by_id
    WHERE cs.company_id = ${currentUser.companyId}
      AND DATE(cs.opened_at) = ${reportDate}::date
    -- EVERY drawer opened today, newest first. This used to be LIMIT 1, so on a day with five
    -- drawers End of Day reported one of them: $103.75 expected against $103.75 counted and a
    -- variance of zero, while the day was actually $1,191.25 expected, $1,181.25 counted and $10
    -- short. A shortage the report cannot show is a shortage nobody chases. (T45 H18)
    ORDER BY cs.opened_at DESC
  `)
  const cashSessions = ((cashResult as any).rows || cashResult) as any[]

  // Each drawer's own figures. A closed session keeps the expected it was reconciled against at
  // close; an open one is estimated live from its opening float and its cash movements.
  const liveExpected = (s: any) =>
    Number(s.opening_amount || 0) + Number(s.cash_sales || 0) - Number(s.cash_refunds || 0)
  const drawers = cashSessions.map((s: any) => {
    const expected = s.expected_amount != null ? Number(s.expected_amount) : liveExpected(s)
    const counted = Number(s.actual_count ?? s.closing_amount ?? 0)
    return {
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      status: s.session_status,
      // Who, and which till. T46 L-b: the per-drawer rows carried times and amounts and nothing
      // else, so a $10 shortfall on one of five drawers named nobody to ask about it — which is
      // the only question anyone has when they read that line.
      register: s.register || null,
      openedByName: (s.opened_by_name || '').trim() || null,
      closedByName: (s.closed_by_name || '').trim() || null,
      openingBalance: Number(s.opening_amount || 0),
      expected,
      // An open drawer has not been counted yet, so it has no count and no variance to report.
      counted: s.session_status === 'open' ? null : counted,
      variance: s.session_status === 'open'
        ? null
        : (s.variance != null ? Number(s.variance) : counted - expected),
    }
  })

  // The day's line is the sum over the drawers that have actually been counted. An open drawer is
  // reported separately rather than folded in, so a mid-day EOD does not read as a shortage.
  const countedDrawers = drawers.filter((d) => d.counted != null)
  const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100
  const cashSession = cashSessions[0] || null
  const openDrawers = drawers.filter((d) => d.status === 'open')
  const dayExpected = countedDrawers.length ? sum(countedDrawers.map((d) => d.expected)) : null
  const dayCounted = countedDrawers.length ? sum(countedDrawers.map((d) => d.counted as number)) : null
  const dayVariance = countedDrawers.length ? sum(countedDrawers.map((d) => d.variance as number)) : null
  const liveExpectedCash = cashSession ? liveExpected(cashSession) : null

  // ── Inventory adjustments ──
  const inventoryResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as adjustment_count,
      COALESCE(SUM(ABS(quantity_change)) FILTER (WHERE quantity_change < 0), 0) as shrinkage_units,
      COUNT(*) FILTER (WHERE quantity_change < 0)::int as shrinkage_count
    FROM inventory_adjustments
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
  `)
  const inventoryStats = ((inventoryResult as any).rows || inventoryResult)?.[0] || {}

  // Shrinkage value estimate (units * avg cost)
  const shrinkageValueResult = await db.execute(sql`
    SELECT COALESCE(SUM(ABS(ia.quantity_change) * COALESCE(p.cost_price::numeric, 0)), 0) as shrinkage_value
    FROM inventory_adjustments ia
    JOIN products p ON p.id = ia.product_id
    WHERE ia.company_id = ${currentUser.companyId}
      AND DATE(ia.created_at) = ${reportDate}::date
      AND ia.quantity_change < 0
  `)
  const shrinkageValue = Number(((shrinkageValueResult as any).rows || shrinkageValueResult)?.[0]?.shrinkage_value || 0)

  // ── Compliance ──
  const complianceResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(o.total_weight_grams::numeric), 0) as total_cannabis_weight_sold,
      -- Violations are judged against the tenant's configured limit (Settings), not a hardcoded 2.5 oz. (V-1)
      COUNT(*) FILTER (WHERE o.total_weight_grams::numeric > COALESCE(NULLIF(co.purchase_limit_oz, ''), '2.5')::numeric * 28.3495)::int as purchase_limit_violations,
      COUNT(*) FILTER (WHERE o.id_verified = true)::int as id_verifications
    FROM orders o
    JOIN company co ON co.id = o.company_id
    WHERE o.company_id = ${currentUser.companyId}
      AND DATE(o.created_at) = ${reportDate}::date
      AND o.status = 'completed'
  `)
  const complianceStats = ((complianceResult as any).rows || complianceResult)?.[0] || {}

  // ── Staff ──
  const staffResult = await db.execute(sql`
    SELECT
      u.id, u.first_name, u.last_name,
      COUNT(o.id)::int as orders_processed,
      COALESCE(SUM(o.total::numeric), 0) as revenue_generated,
      COALESCE(SUM(o.tip_amount::numeric), 0) as tips_earned
    FROM "user" u
    JOIN orders o ON o.budtender_id = u.id
    WHERE o.company_id = ${currentUser.companyId}
      AND DATE(o.created_at) = ${reportDate}::date
      AND o.status = 'completed'
    GROUP BY u.id, u.first_name, u.last_name
    ORDER BY revenue_generated DESC
  `)
  const staffStats = (staffResult as any).rows || staffResult

  // Total tips
  const tipsResult = await db.execute(sql`
    SELECT COALESCE(SUM(tip_amount::numeric), 0) as total_tips
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
      AND status = 'completed'
  `)
  const totalTips = Number(((tipsResult as any).rows || tipsResult)?.[0]?.total_tips || 0)

  // ── Loyalty ──
  const loyaltyResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(points) FILTER (WHERE type = 'earn'), 0)::int as points_issued,
      COALESCE(SUM(ABS(points)) FILTER (WHERE type = 'redeem'), 0)::int as points_redeemed,
      COUNT(DISTINCT member_id) FILTER (WHERE type = 'earn')::int as active_members
    FROM loyalty_transactions
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
  `)
  const loyaltyStats = ((loyaltyResult as any).rows || loyaltyResult)?.[0] || {}

  const newMembersResult = await db.execute(sql`
    SELECT COUNT(*)::int as new_members
    FROM loyalty_members
    WHERE company_id = ${currentUser.companyId}
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
  `)
  const newMembers = Number(((newMembersResult as any).rows || newMembersResult)?.[0]?.new_members || 0)

  // ── Build the report ──
  const report = {
    date: reportDate,
    locationId,
    orders: {
      count: Number(orderStats.order_count) || 0,
      totalRevenue: Number(orderStats.total_revenue) || 0,
      revenueByPaymentMethod,
      totalExciseTax: Number(orderStats.total_excise_tax) || 0,
      totalSalesTax: Number(orderStats.total_sales_tax) || 0,
      totalTax: Number(orderStats.total_tax) || 0,
      totalDiscounts: Number(orderStats.total_discounts) || 0,
      refundCount: Number(orderStats.refund_count) || 0,
      refundTotal: Number(orderStats.refund_total) || 0,
      voidCount: Number(orderStats.void_count) || 0,
    },
    cash: {
      // The day across every drawer, not the last one. Where no drawer has been counted yet these
      // fall back to the newest session's live estimate so a mid-day EOD still reads sensibly.
      openingBalance: drawers.length ? sum(drawers.map((d) => d.openingBalance)) : null,
      // Actual counted cash = actual_count (or closing_amount); never the opening float. (retest#11)
      closingAmount: dayCounted,
      expectedCash: dayExpected ?? liveExpectedCash,
      variance: dayVariance,
      sessionStatus: cashSession?.session_status || null,
      // So a manager can see WHICH drawer is short, and that there were five of them. (T45 H18)
      drawerCount: drawers.length,
      countedDrawerCount: countedDrawers.length,
      openDrawerCount: openDrawers.length,
      drawers,
    },
    inventory: {
      adjustmentCount: Number(inventoryStats.adjustment_count) || 0,
      shrinkageUnits: Number(inventoryStats.shrinkage_units) || 0,
      shrinkageCount: Number(inventoryStats.shrinkage_count) || 0,
      shrinkageValue,
    },
    compliance: {
      totalCannabisWeightSoldGrams: Number(complianceStats.total_cannabis_weight_sold) || 0,
      purchaseLimitViolations: Number(complianceStats.purchase_limit_violations) || 0,
      idVerifications: Number(complianceStats.id_verifications) || 0,
    },
    staff: {
      employees: staffStats,
      totalEmployees: staffStats.length,
      totalTips,
    },
    loyalty: {
      pointsIssued: Number(loyaltyStats.points_issued) || 0,
      pointsRedeemed: Number(loyaltyStats.points_redeemed) || 0,
      activeMembers: Number(loyaltyStats.active_members) || 0,
      newMembers,
    },
  }

  // Revenue split by payment method for the flat cash/debit/ach columns
  const pmAmount = (name: string) => Number(
    (revenueByPaymentMethod as any[]).find(
      (r: any) => String(r.payment_method || '').toLowerCase() === name
    )?.total || 0
  )
  const cashRevenue = pmAmount('cash')
  const debitRevenue = pmAmount('debit')
  const achRevenue = pmAmount('ach')

  // Persist to the flat eod_reports columns (this table has no report_data JSON
  // column and no unique index for ON CONFLICT). Replace any prior report for
  // the same company/date/location so a re-generate overwrites cleanly.
  // One report per day.
  //
  // T45 M18: generating End of Day again for a day left the first report behind. The replace was
  // keyed on company + date + LOCATION, so a company-wide run and a per-location run for the same
  // day produced two rows, the history listed both, and nothing said which was the day's answer.
  // A company-wide report is the whole day, so it supersedes everything for that date; a report
  // for one location replaces that location's.
  const locId = locationId || null
  if (locId) {
    await db.execute(sql`
      DELETE FROM eod_reports
      WHERE company_id = ${currentUser.companyId}
        AND date = ${reportDate}::date
        AND location_id = ${locId}
    `)
  } else {
    await db.execute(sql`
      DELETE FROM eod_reports
      WHERE company_id = ${currentUser.companyId}
        AND date = ${reportDate}::date
    `)
  }
  const insertResult = await db.execute(sql`
    INSERT INTO eod_reports (
      id, company_id, location_id, date, status,
      total_orders, total_revenue, cash_revenue, debit_revenue, ach_revenue,
      total_tax, total_discounts, total_refunds, total_voids,
      expected_cash, actual_cash, cash_variance,
      inventory_adjustments, shrinkage_value,
      total_cannabis_weight_sold, purchase_limit_violations, id_verifications_performed,
      staff_on_duty, total_labor_hours, total_tips,
      loyalty_points_issued, loyalty_points_redeemed, new_loyalty_members,
      prepared_by, created_at
    ) VALUES (
      gen_random_uuid(), ${currentUser.companyId}, ${locId}, ${reportDate}::date, 'draft',
      ${report.orders.count}, ${String(report.orders.totalRevenue)}, ${String(cashRevenue)}, ${String(debitRevenue)}, ${String(achRevenue)},
      ${String(report.orders.totalTax)}, ${String(report.orders.totalDiscounts)}, ${String(report.orders.refundTotal)}, ${report.orders.voidCount},
      ${report.cash.expectedCash != null ? String(report.cash.expectedCash) : null}, ${report.cash.closingAmount != null ? String(report.cash.closingAmount) : null}, ${report.cash.variance != null ? String(report.cash.variance) : null},
      ${report.inventory.adjustmentCount}, ${String(report.inventory.shrinkageValue)},
      ${String(report.compliance.totalCannabisWeightSoldGrams)}, ${report.compliance.purchaseLimitViolations}, ${report.compliance.idVerifications},
      ${report.staff.totalEmployees}, '0', ${String(report.staff.totalTips)},
      ${report.loyalty.pointsIssued}, ${report.loyalty.pointsRedeemed}, ${report.loyalty.newMembers},
      ${currentUser.userId}, NOW()
    )
    RETURNING *
  `)

  const savedReport = ((insertResult as any).rows || insertResult)?.[0]

  // Sales raised on this day and still not settled — product out of the door, money not taken.
  // Nearly always an offline cash sale rung up with no drawer open (routes/offline.ts leaves it
  // standing on purpose, because the customer already has the goods). (T47, N1 cash)
  const unsettledResult: any = await db.execute(sql`
    SELECT id, order_number, total, payment_method
    FROM orders
    WHERE company_id = ${currentUser.companyId}
      AND status = 'pending'
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzDay}) = ${reportDate}::date
    ORDER BY created_at ASC
  `)
  const unsettledRows = ((unsettledResult as any).rows || unsettledResult) as any[]
  const unsettled = {
    count: unsettledRows.length,
    total: Math.round(unsettledRows.reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100,
    orders: unsettledRows.map((o) => ({
      id: o.id, number: o.order_number, total: Number(o.total) || 0, paymentMethod: o.payment_method,
    })),
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'eod_report',
    entityId: savedReport?.id,
    entityName: `EOD Report ${reportDate}`,
    metadata: { date: reportDate, locationId: locId, orderCount: report.orders.count, revenue: report.orders.totalRevenue },
    req: c,
  })

  // Shape the response to the flat camelCase fields the EOD page renders.
  return c.json({
    id: savedReport?.id,
    date: reportDate,
    status: savedReport?.status || 'draft',
    locationId: locId,
    totalOrders: report.orders.count,
    totalRevenue: report.orders.totalRevenue,
    refundCount: report.orders.refundCount,
    refundTotal: report.orders.refundTotal,
    voidCount: report.orders.voidCount,
    cashTotal: cashRevenue,
    debitTotal: debitRevenue + achRevenue,
    cashExpected: report.cash.expectedCash || 0,
    cashActual: report.cash.closingAmount || 0,
    cashVariance: report.cash.variance,
    // Surface whether the reconciled drawer is still open or already closed, so the UI can
    // frame a closed drawer's figures as final-at-close, not a pending count. (retest#12)
    cashDrawerStatus: report.cash.sessionStatus || null,
    // A day can run several drawers; the screen needs to know it is looking at a total, and which
    // of them is the one that came up short. (T45 H18)
    drawerCount: report.cash.drawerCount,
    countedDrawerCount: report.cash.countedDrawerCount,
    openDrawerCount: report.cash.openDrawerCount,
    drawers: report.cash.drawers,
    inventoryAdjustments: report.inventory.adjustmentCount,
    shrinkageValue: report.inventory.shrinkageValue,
    employeesOnDuty: report.staff.totalEmployees,
    totalHours: 0,
    tipsTotal: report.staff.totalTips,
    pointsIssued: report.loyalty.pointsIssued,
    pointsRedeemed: report.loyalty.pointsRedeemed,
    newLoyaltyMembers: report.loyalty.newMembers,
    // Sales the shop has already handed over and not yet taken money for.
    //
    // A cash sale rung up while the connection was down, with no drawer open, is raised and left
    // PENDING on purpose — the customer has walked out with the product and the shop needs the
    // record (routes/offline.ts). The T47 retest agreed that is the right call and asked for the
    // obvious follow-on: say so somewhere it cannot be forgotten. End of Day is that place. A day
    // that balances perfectly while three sales sit unsettled has not balanced.
    unsettledSales: unsettled.count,
    unsettledTotal: unsettled.total,
    unsettledOrders: unsettled.orders,
  })
})

// ─── GET / ── List EOD reports ───────────────────────────────────────────────

// An End-of-Day report is the day's takings, the drawer count and the variance — the shop's money,
// not a budtender's own shift. Generating one was already manager-only; READING past ones was not,
// so any signed-in staff could pull ,923.75 of revenue with cashExpected and cashVariance beside
// it. Same rank to read as to produce. (T43 N8)
app.get('/', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const locationId = c.req.query('locationId')
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  // The list previously selected columns this table does not have (report_date, report_data,
  // generated_by, submitted_at, updated_at) → every history load 500'd. Select the real flat
  // columns and shape to the camelCase fields the history table renders.
  let filters = sql``
  if (startDate) filters = sql`${filters} AND eod.date >= ${startDate}::date`
  if (endDate) filters = sql`${filters} AND eod.date <= ${endDate}::date`
  if (locationId) filters = sql`${filters} AND eod.location_id = ${locationId}`
  if (status) filters = sql`${filters} AND eod.status = ${status}`

  const [dataResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT eod.id, eod.date, eod.location_id, eod.status,
             eod.total_revenue, eod.expected_cash, eod.actual_cash, eod.cash_variance,
             eod.reviewed_at, eod.created_at,
             l.name as location_name,
             pu.first_name || ' ' || pu.last_name as prepared_by_name,
             ru.first_name || ' ' || ru.last_name as reviewed_by_name
      FROM eod_reports eod
      LEFT JOIN locations l ON l.id = eod.location_id
      LEFT JOIN "user" pu ON pu.id = eod.prepared_by
      LEFT JOIN "user" ru ON ru.id = eod.reviewed_by
      WHERE eod.company_id = ${currentUser.companyId} ${filters}
      ORDER BY eod.date DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM eod_reports eod
      WHERE eod.company_id = ${currentUser.companyId} ${filters}
    `),
  ])

  const rows = (dataResult as any).rows || dataResult
  const data = rows.map((r: any) => ({
    id: r.id,
    date: r.date,
    locationId: r.location_id,
    locationName: r.location_name || null,
    status: r.status,
    totalRevenue: Number(r.total_revenue || 0),
    cashExpected: Number(r.expected_cash || 0),
    cashActual: Number(r.actual_cash || 0),
    cashVariance: Number(r.cash_variance || 0),
    submittedBy: r.prepared_by_name || null,
    reviewedBy: r.reviewed_by_name || null,
    createdAt: r.created_at,
  }))
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ─── GET /checklist ── Default compliance checklist items ────────────────────
// NOTE: must be declared BEFORE `/:id` or the literal path is shadowed by the
// param route and 404s.

app.get('/checklist', async (c) => {
  return c.json({
    items: [
      'Cash drawer counted',
      'Safe deposit verified',
      'Metrc daily report reviewed',
      'Waste log updated',
      'Delivery manifests filed',
      'ID scanner cleaned',
      'Kiosk reset',
      'Floor swept and mopped',
    ],
  })
})

// ─── GET /:id ── Report detail ───────────────────────────────────────────────

app.get('/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Was joining eod.generated_by (no such column) → 500 on every "View". Join prepared_by and
  // shape to the same flat camelCase fields the report card renders (matching /generate).
  const result = await db.execute(sql`
    SELECT eod.*,
           l.name as location_name,
           pu.first_name || ' ' || pu.last_name as prepared_by_name,
           ru.first_name || ' ' || ru.last_name as reviewed_by_name
    FROM eod_reports eod
    LEFT JOIN locations l ON l.id = eod.location_id
    LEFT JOIN "user" pu ON pu.id = eod.prepared_by
    LEFT JOIN "user" ru ON ru.id = eod.reviewed_by
    WHERE eod.id = ${id} AND eod.company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const r = ((result as any).rows || result)?.[0]
  if (!r) return c.json({ error: 'Report not found' }, 404)

  return c.json({
    id: r.id,
    date: r.date,
    status: r.status,
    locationId: r.location_id,
    locationName: r.location_name || null,
    totalOrders: Number(r.total_orders) || 0,
    totalRevenue: Number(r.total_revenue) || 0,
    cashTotal: Number(r.cash_revenue) || 0,
    debitTotal: (Number(r.debit_revenue) || 0) + (Number(r.ach_revenue) || 0),
    totalTax: Number(r.total_tax) || 0,
    totalDiscounts: Number(r.total_discounts) || 0,
    totalRefunds: Number(r.total_refunds) || 0,
    totalVoids: Number(r.total_voids) || 0,
    cashExpected: Number(r.expected_cash) || 0,
    cashActual: Number(r.actual_cash) || 0,
    cashVariance: Number(r.cash_variance) || 0,
    inventoryAdjustments: Number(r.inventory_adjustments) || 0,
    shrinkageValue: Number(r.shrinkage_value) || 0,
    cannabisWeightSold: Number(r.total_cannabis_weight_sold) || 0,
    purchaseLimitViolations: Number(r.purchase_limit_violations) || 0,
    idVerifications: Number(r.id_verifications_performed) || 0,
    employeesOnDuty: Number(r.staff_on_duty) || 0,
    totalHours: Number(r.total_labor_hours) || 0,
    tipsTotal: Number(r.total_tips) || 0,
    pointsIssued: Number(r.loyalty_points_issued) || 0,
    pointsRedeemed: Number(r.loyalty_points_redeemed) || 0,
    newLoyaltyMembers: Number(r.new_loyalty_members) || 0,
    complianceChecklist: r.compliance_checklist || [],
    notes: r.notes || null,
    submittedBy: r.prepared_by_name || null,
    reviewedBy: r.reviewed_by_name || null,
    reviewedAt: r.reviewed_at || null,
    createdAt: r.created_at,
  })
})

// ─── PUT /:id/review ── Mark as reviewed by manager ──────────────────────────

app.put('/:id/review', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE eod_reports
    SET status = 'reviewed', reviewed_by = ${currentUser.userId}, reviewed_at = NOW()
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status = 'draft'
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found or already reviewed' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'eod_report',
    entityId: id,
    entityName: `EOD Report ${updated.date}`,
    changes: { status: { old: 'draft', new: 'reviewed' } },
    req: c,
  })

  return c.json(updated)
})

// ─── PUT /:id/submit ── Mark as submitted (final) ───────────────────────────

app.put('/:id/submit', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE eod_reports
    SET status = 'submitted'
    WHERE id = ${id} AND company_id = ${currentUser.companyId} AND status IN ('draft', 'reviewed')
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found or already submitted' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'eod_report',
    entityId: id,
    entityName: `EOD Report ${updated.date}`,
    changes: { status: { old: updated.status, new: 'submitted' } },
    req: c,
  })

  return c.json(updated)
})

// ─── PUT /:id/checklist ── Update checklist items ────────────────────────────

const checklistSchema = z.object({
  checklist: z.array(z.object({
    item: z.string().min(1),
    checked: z.boolean(),
    checkedBy: z.string().optional(),
    checkedAt: z.string().optional(),
  })),
})

app.put('/:id/checklist', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  let data: z.infer<typeof checklistSchema>
  try {
    data = checklistSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json(zodRefusal(err), 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const result = await db.execute(sql`
    UPDATE eod_reports
    SET compliance_checklist = ${JSON.stringify(data.checklist)}::jsonb
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Report not found' }, 404)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'eod_report',
    entityId: id,
    entityName: `EOD Checklist`,
    metadata: { checkedCount: data.checklist.filter(i => i.checked).length, totalCount: data.checklist.length },
    req: c,
  })

  return c.json(updated)
})

export default app
