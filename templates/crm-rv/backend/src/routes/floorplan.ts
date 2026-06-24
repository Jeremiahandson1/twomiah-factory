import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { unit } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

// ── Floorplan / Flooring ────────────────────────────────────────────────────
// Tracks new units financed on floorplan (curtailment, interest accrual). The
// lender curtailment/payoff feed (Wells Fargo CDF, Sheffield, Synchrony) is a
// swappable rail — mock today; pulls REAL units and attaches floorplan financing.
const app = new Hono()
app.use('*', authenticate)

const LENDERS = ['Wells Fargo CDF', 'Sheffield Financial', 'Synchrony Floor']

app.get('/units', async (c) => {
  const u = c.get('user') as any
  let units: any[] = []
  try { units = await db.select().from(unit).where(and(eq(unit.companyId, u.companyId), eq(unit.status, 'available'))).limit(60) } catch {}
  const floored = units.filter((x) => x.condition === 'new').map((x, i) => {
    const amount = Math.round(Number(x.cost || x.internetPrice || 0) * 0.9)
    const days = 25 + (i * 17) % 150
    const curtailmentDue = days > 120
    const interest = Math.round(amount * 0.085 / 365 * days)
    return {
      id: x.id, unit: [x.year, x.make, x.modelName].filter(Boolean).join(' '), stock: x.stockNumber,
      lender: LENDERS[i % LENDERS.length], amount, flooredDays: days, interest,
      status: curtailmentDue ? 'curtailment due' : 'current', curtailmentDue,
    }
  })
  return c.json({
    units: floored,
    summary: {
      count: floored.length,
      totalFloored: floored.reduce((s, f) => s + f.amount, 0),
      totalInterest: floored.reduce((s, f) => s + f.interest, 0),
      dueCount: floored.filter((f) => f.curtailmentDue).length,
    },
    live: false,
  })
})

export default app
