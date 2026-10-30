// Two report doors for the people side of the business, both `reports:read` (the same seat as the Reports page):
//   /api/team-revenue — revenue per tech, quote conversion per rep and per tech        (Team Revenue Reports, not ready)
//   /api/plan-reports — plans sold per person, renewals due in 30/60 days, churned plans (Plan Reports, not ready)
// The figures come from server/data/teamReports.ts, where the rules are written down.
import { Hono } from 'hono'
import { parseRange, ReportError, companyTimeZone, storeDateString, dayMarker } from '@twomiah/tenant-backend'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { fail, one } from '../../http/reply.ts'
import { churnedPlans, planSales, quoteConversion, renewalsDue, revenueByTech } from '../../data/teamReports.ts'

/** The period the page asked for, in the business's own days; a bad date is a plain 400. */
async function periodOf(d: CrmDeps, c: any) {
  const companyId = c.get('user').companyId as string
  const tz = await companyTimeZone(d.db, companyId)
  try { return { companyId, tz, range: parseRange(c.req.query('startDate'), c.req.query('endDate'), tz) } }
  catch (e) { if (e instanceof ReportError) return { companyId, tz, error: e.message }; throw e }
}

export function createTeamRevenueRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/by-tech', requirePermission('reports:read'), async (c) => {
    const p = await periodOf(d, c)
    if ('error' in p) return fail(c, 400, p.error as string)
    return one(c, await revenueByTech(db, p.companyId, p.range))
  })

  app.get('/quote-conversion', requirePermission('reports:read'), async (c) => {
    const p = await periodOf(d, c)
    if ('error' in p) return fail(c, 400, p.error as string)
    const by = c.req.query('by') === 'tech' ? 'tech' : 'writer'
    return one(c, { by, rows: await quoteConversion(db, p.companyId, p.range, by) })
  })
  return app
}

export function createPlanReportRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/sold', requirePermission('reports:read'), async (c) => {
    const p = await periodOf(d, c)
    if ('error' in p) return fail(c, 400, p.error as string)
    return one(c, { rows: await planSales(db, p.companyId, p.range) })
  })

  // Not a period: what is coming due from today, on the business's calendar. 30 or 60 days.
  app.get('/renewals', requirePermission('reports:read'), async (c) => {
    const days = Number(c.req.query('days') ?? 30)
    if (days !== 30 && days !== 60) return fail(c, 400, 'Choose 30 or 60 days.')
    const companyId = c.get('user').companyId as string
    const tz = await companyTimeZone(db, companyId)
    const today = dayMarker(storeDateString(new Date(), tz))
    const rows = await renewalsDue(db, companyId, today, days)
    return one(c, { days, rows, needsAction: rows.filter((r) => r.renewal === 'manual').length })
  })

  app.get('/churned', requirePermission('reports:read'), async (c) => {
    const p = await periodOf(d, c)
    if ('error' in p) return fail(c, 400, p.error as string)
    return one(c, { rows: await churnedPlans(db, p.companyId, p.range) })
  })
  return app
}
