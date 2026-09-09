import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Floorplan / Flooring ────────────────────────────────────────────────────
// Tracks new units financed on floorplan (curtailment, interest accrual). The
// lender curtailment/payoff feed (Wells Fargo CDF, Sheffield, Synchrony) is a
// swappable rail — mock today; pulls REAL units and attaches floorplan financing.
const app = new Hono()
app.use('*', authenticate)

app.get('/units', async (c) => {
  // Floorplan financing (which units are floored, lender, floored-days, accrued
  // interest, curtailment-due) comes from the lender curtailment feed — it is NOT
  // something we can derive ourselves. We do NOT fabricate interest/curtailment on
  // real units (a fake "curtailment due, $X interest" could drive real payments).
  // Until a feed is connected, return an honest empty state.
  return c.json({
    units: [],
    summary: { count: 0, totalFloored: 0, totalInterest: 0, dueCount: 0 },
    live: false,
    message: 'Floorplan tracking is not connected. Connect a lender curtailment feed (Wells Fargo CDF, Sheffield, or Synchrony) to see floored units, interest, and curtailment.',
  })
})

export default app
