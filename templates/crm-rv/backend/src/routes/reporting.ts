import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { salesLead, repairOrder } from '../../db/schema.ts'
import { sql, eq, and, gte, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

/**
 * Reporting — seasonal / year-over-year analytics.
 *
 * RV and powersports are intensely seasonal, so the headline report is a
 * trailing-24-month monthly series plus a same-month-last-year comparison,
 * which is the question owners actually ask ("how's this March vs last March?").
 */

const app = new Hono()
app.use('*', authenticate)

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// GET /reporting/seasonal — trailing 24-month series + YoY deltas
app.get('/seasonal', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId

  const since = new Date()
  since.setMonth(since.getMonth() - 23)
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const monthExpr = (col: any) => sql<string>`to_char(date_trunc('month', ${col}), 'YYYY-MM')`

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [leadRows, soldRows, roRows] = await Promise.all([
    safe(() => db.select({ month: monthExpr(salesLead.createdAt), value: count() })
      .from(salesLead)
      .where(and(eq(salesLead.companyId, companyId), gte(salesLead.createdAt, since)))
      .groupBy(monthExpr(salesLead.createdAt)), [] as { month: string; value: number }[]),
    safe(() => db.select({ month: monthExpr(salesLead.closedAt), value: count() })
      .from(salesLead)
      .where(and(eq(salesLead.companyId, companyId), eq(salesLead.stage, 'closed_won'), gte(salesLead.closedAt, since)))
      .groupBy(monthExpr(salesLead.closedAt)), [] as { month: string; value: number }[]),
    safe(() => db.select({ month: monthExpr(repairOrder.createdAt), value: count() })
      .from(repairOrder)
      .where(and(eq(repairOrder.companyId, companyId), gte(repairOrder.createdAt, since)))
      .groupBy(monthExpr(repairOrder.createdAt)), [] as { month: string; value: number }[]),
  ])

  // Build a dense 24-month axis so the frontend can chart without gaps.
  const months: string[] = []
  const cursor = new Date(since)
  for (let i = 0; i < 24; i++) {
    months.push(monthKey(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const densify = (rows: { month: string; value: number }[]) => {
    const map = new Map(rows.map(r => [r.month, Number(r.value)]))
    return months.map(m => ({ month: m, value: map.get(m) || 0 }))
  }

  const leads = densify(leadRows)
  const unitsSold = densify(soldRows)
  const repairOrders = densify(roRows)

  // YoY: current month vs same month last year.
  const now = new Date()
  const thisMonth = monthKey(now)
  const lastYear = new Date(now); lastYear.setFullYear(now.getFullYear() - 1)
  const sameMonthLastYear = monthKey(lastYear)
  const at = (series: { month: string; value: number }[], key: string) => series.find(s => s.month === key)?.value || 0
  const yoy = (series: { month: string; value: number }[]) => {
    const curr = at(series, thisMonth)
    const prev = at(series, sameMonthLastYear)
    const deltaPct = prev === 0 ? (curr === 0 ? 0 : 100) : Math.round(((curr - prev) / prev) * 100)
    return { current: curr, sameMonthLastYear: prev, deltaPct }
  }

  return c.json({
    months,
    series: { leads, unitsSold, repairOrders },
    yoy: {
      thisMonth,
      sameMonthLastYear,
      leads: yoy(leads),
      unitsSold: yoy(unitsSold),
      repairOrders: yoy(repairOrders),
    },
  })
})

// GET /reporting/lead-sources — close rate and volume by source (sales intelligence)
app.get('/lead-sources', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const companyId = user.companyId
  try {
    const rows = await db.select({
      source: salesLead.source,
      total: count(),
      won: sql<number>`count(*) filter (where ${salesLead.stage} = 'closed_won')`,
    })
      .from(salesLead)
      .where(eq(salesLead.companyId, companyId))
      .groupBy(salesLead.source)

    const sources = rows.map(r => ({
      source: r.source || 'unknown',
      total: Number(r.total),
      won: Number(r.won),
      closeRate: Number(r.total) ? Math.round((Number(r.won) / Number(r.total)) * 100) : 0,
    })).sort((a, b) => b.total - a.total)

    return c.json({ sources })
  } catch {
    return c.json({ sources: [] })
  }
})

export default app
