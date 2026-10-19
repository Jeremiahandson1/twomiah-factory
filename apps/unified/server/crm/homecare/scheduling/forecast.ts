// /api/forecast — revenue forecasting. Moved from templates/crm-homecare/backend/src/routes/forecast.ts (ported there from
// CVHC routes/forecastRoutes.js).
//
// Projections come off the shared schedule engine, so the forecast matches what payroll and billing see. Dollar values
// use each client's REAL rate — the private-pay rate, or the payer's contracted rate for the client's care type
// effective that day. The weekly projection and the caregiver view fall back to $18.50/h only where no rate is on file
// (CVHC's figure, stated on the screen); the authorization view never invents one.
//
// Permissions: the office's (the template's requireAdmin): money is care-billing, and reading it is care-billing:read —
// the office manager holds it, a caregiver does not.
//
// Replies: camelCase rows (clientName, authorizedHours, weekStart, estimatedRevenue …; authSummary's keys too:
// totalActiveAuths, totalAuthHours, …). /caregiver-utilization is a list reply ({ data, pagination }).
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { addDays } from '../core/agencyTime.ts'
import { forecastActual, forecastAuthorizations, forecastWeekly, forecastTopClients, caregiverUtilization } from '../../../data/homecareScheduling.ts'
import { who } from './shared.ts'

export function createForecastRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const db = d.db
  app.use('*', d.permissions.requirePermission('care-billing:read'))

  // GET /api/forecast/revenue?months=3
  app.get('/revenue', async (c) => {
    const { companyId } = who(c)
    const months = Math.max(1, Math.min(36, parseInt(c.req.query('months') || '3', 10) || 3))
    const today = await core.time.today(companyId)
    const since = (() => { const x = new Date(`${today}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() - months); return x.toISOString().slice(0, 10) })()

    const [actual, projected, weekly, topClients] = await Promise.all([
      forecastActual(db, companyId, since, today),
      forecastAuthorizations(db, companyId, today, addDays(today, 6)),
      forecastWeekly(db, companyId, today, addDays(today, 27)),
      forecastTopClients(db, companyId, addDays(today, -90), today),
    ])

    // KPI tiles derive from the per-client rows above, so they can never disagree with the table.
    const totAuth = projected.reduce((s, r) => s + (parseFloat(r.authorizedHours) || 0), 0)
    const totSched = projected.reduce((s, r) => s + (parseFloat(r.usedHours) || 0), 0)
    const authSummary = {
      totalActiveAuths: projected.length,
      totalAuthHours: totAuth,
      totalUsedHours: totSched,
      avgUtilizationPct: totAuth > 0 ? Math.round((totSched / totAuth) * 1000) / 10 : 0,
      totalProjectedRemaining: projected.reduce((s, r) => s + (parseFloat(r.projectedRemainingRevenue) || 0), 0),
      unvaluedClients: projected.filter((r) => r.hourlyRate == null && parseFloat(r.remainingHours) > 0).length,
    }
    return one(c, { actual, projected, weekly, topClients, authSummary })
  })

  // GET /api/forecast/caregiver-utilization — each caregiver's scheduled hours over the next 7 days.
  app.get('/caregiver-utilization', async (c) => {
    const { companyId } = who(c)
    const today = await core.time.today(companyId)
    const rows = await caregiverUtilization(db, companyId, today, addDays(today, 6))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  return app
}
