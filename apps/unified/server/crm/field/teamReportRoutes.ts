// /api/team-revenue — the people side of the money (Team Revenue Reports; feature team_revenue_reports, `reports:read`):
//   /by-tech, /quote-conversion      the two figures the page started with, on the shared engine (data/teamRevenue.ts)
//   /table                           any tab as columns and rows: revenue per person, the invoices and jobs behind it, quote
//                                    conversion by salesperson / writer / tech on the date you choose, the quotes behind it —
//                                    with a custom range, filters (customer, person), chosen columns and ?format=csv
//   /filters                         the people and customers a filter can name
//   /saved                           a view kept by name and emailed on a schedule (savedReports.ts)
//   /jobs/:id/split                  how one job's revenue is shared between the people on it (jobs:read / jobs:update)
// (/api/plan-reports is planReportRoutes.ts.)
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { parseRange, ReportError, companyTimeZone, storeDateString } from '@twomiah/tenant-backend'
import { job } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { fail, one } from '../../http/reply.ts'
import { QUOTE_BASES, QUOTE_GROUPS, jobCrew, quoteConversion, revenueByTech, teamFilterOptions, type QuoteBasis, type QuoteGroup } from '../../data/teamRevenue.ts'
import type { Range } from '../../data/teamReports.ts'
import { TEAM_TABS, teamTable, type TeamParams } from './teamReportTables.ts'
import { PERIOD_IDS, chooseColumns, csvOf, resolvePeriod, type Col, type ReportTable } from './reportTables.ts'
import { createSavedReports, type SavedKind } from './savedReports.ts'

/** The period the page asked for, in the business's own days; a bad date is a plain 400. */
export async function periodOf(d: CrmDeps, c: any) {
  const companyId = c.get('user').companyId as string
  const tz = await companyTimeZone(d.db, companyId)
  try { return { companyId, tz, range: parseRange(c.req.query('startDate'), c.req.query('endDate'), tz) } }
  catch (e) { if (e instanceof ReportError) return { companyId, tz, error: e.message }; throw e }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const PERSON = /^(u:|m:)[A-Za-z0-9_-]{1,60}$|^(unassigned|no_job|none)$/
export const teamParamsSchema = z.object({
  tab: z.enum(TEAM_TABS, { error: 'Choose a report' }),
  period: z.enum(PERIOD_IDS).optional(),
  startDate: z.string().regex(DAY, 'Enter a date').optional(),
  endDate: z.string().regex(DAY, 'Enter a date').optional(),
  contactId: z.string().trim().max(60).optional(),
  person: z.string().trim().regex(PERSON, 'Choose a person from the list').optional().or(z.literal('')),
  by: z.enum(QUOTE_GROUPS).optional(),
  basis: z.enum(QUOTE_BASES).optional(),
  status: z.enum(['approved', 'declined', 'open']).optional(),
  columns: z.array(z.string().max(40)).max(40).optional(),
}).strip()
export type TeamSavedParams = z.infer<typeof teamParamsSchema>

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

/** Saved or asked-for settings → the table, on the business's own clock. A bad date is a plain error. */
export async function teamParamsToTable(db: any, companyId: string, saved: TeamSavedParams, now = new Date()): Promise<{ table: ReportTable; columns: Col[] }> {
  const tz = await companyTimeZone(db, companyId)
  const today = storeDateString(now, tz)
  const days = saved.period ? resolvePeriod(saved.period, today) : { startDate: saved.startDate, endDate: saved.endDate }
  let range: Range
  try { range = parseRange(days.startDate, days.endDate, tz) } catch (e) { if (e instanceof ReportError) throw new z.ZodError([{ code: 'custom', path: ['startDate'], message: e.message, input: undefined } as any]); throw e }
  const params: TeamParams = { tab: saved.tab, range, tz, contactId: clean(saved.contactId), person: clean(saved.person), by: saved.by ?? 'salesperson', basis: saved.basis ?? 'drafted', status: saved.status }
  const table = await teamTable(db, companyId, params)
  return { table, columns: chooseColumns(table.columns, saved.columns) }
}

const fromQuery = (c: any) => {
  const q = c.req.query()
  return teamParamsSchema.safeParse({ ...q, columns: q.columns ? String(q.columns).split(',') : undefined })
}

const splitSchema = z.object({
  mode: z.enum(['equal', 'hours', 'percent'], { error: 'Choose how to share the revenue' }),
  percents: z.record(z.string(), z.number({ error: 'Enter a percentage' }).min(0, 'A percentage cannot be below 0').max(100, 'A percentage cannot be above 100')).optional(),
})

export function createTeamReports(d: CrmDeps) {
  const saved = createSavedReports(d, [{
    report: 'team', feature: 'team_revenue_reports', permission: 'reports:read',
    parse: (p) => teamParamsSchema.parse(p),
    run: (companyId, params, now) => teamParamsToTable(d.db, companyId, params as TeamSavedParams, now),
  } satisfies SavedKind])
  return { saved, routes: createTeamRevenueRoutes(d), savedRoutes: saved.routesFor('team') }
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
    const by = (QUOTE_GROUPS as readonly string[]).includes(c.req.query('by') ?? '') ? c.req.query('by') as QuoteGroup : 'writer'
    const basisAsked = c.req.query('basis') ?? 'drafted'
    if (!(QUOTE_BASES as readonly string[]).includes(basisAsked)) return fail(c, 400, 'Choose drafted, sent, approved, converted or job completed.')
    return one(c, { by, basis: basisAsked, rows: await quoteConversion(db, p.companyId, p.range, by, basisAsked as QuoteBasis, { contactId: clean(c.req.query('contactId')) }) })
  })

  app.get('/table', requirePermission('reports:read'), async (c) => {
    const parsed = fromQuery(c)
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the report settings.')
    let built
    try { built = await teamParamsToTable(db, c.get('user').companyId, parsed.data) }
    catch (e) { if (e instanceof z.ZodError) return fail(c, 400, e.issues[0]?.message || 'Check the dates.'); throw e }
    const { table, columns } = built
    if (c.req.query('format') === 'csv') {
      return new Response('﻿' + csvOf(table, columns), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="team-revenue-${table.tab}.csv"` } })
    }
    return one(c, { ...table, shown: columns.map((x) => x.key) })
  })

  app.get('/filters', requirePermission('reports:read'), async (c) => one(c, await teamFilterOptions(db, c.get('user').companyId as string)))

  // How one job's revenue is shared when several people are on it. Reading it asks jobs:read; changing it asks jobs:update.
  app.get('/jobs/:id/split', requirePermission('jobs:read'), async (c) => {
    const crew = await jobCrew(db, c.get('user').companyId as string, c.req.param('id'))
    if (!crew) return fail(c, 404, 'That job was not found.')
    return one(c, { jobId: crew.job.jobId, people: crew.people.map((p) => ({ key: p.key, name: p.name, hours: Math.round(p.hours * 100) / 100 })), mode: crew.split?.mode ?? 'equal', percents: crew.split?.percents ?? {}, applied: crew.job.mode, shares: crew.job.shares, note: crew.job.fallback })
  })

  app.put('/jobs/:id/split', requirePermission('jobs:update'), async (c) => {
    const companyId = c.get('user').companyId as string
    const parsed = splitSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the split.')
    const crew = await jobCrew(db, companyId, c.req.param('id'))
    if (!crew) return fail(c, 404, 'That job was not found.')
    if (crew.people.length < 2) return fail(c, 400, 'Only a job with several people on it can be split.')
    const { mode, percents } = parsed.data
    let value: { mode: 'equal' | 'hours' | 'percent'; percents?: Record<string, number> } = { mode }
    if (mode === 'percent') {
      const keys = crew.people.map((p) => p.key)
      const given = percents ?? {}
      const stray = Object.keys(given).find((k) => !keys.includes(k))
      if (stray) return fail(c, 400, 'A percentage was given for someone who is not on this job.')
      const missing = crew.people.find((p) => typeof given[p.key] !== 'number')
      if (missing) return fail(c, 400, `Enter a percentage for ${missing.name}.`)
      const total = keys.reduce((n, k) => n + given[k], 0)
      if (Math.abs(total - 100) > 0.005) return fail(c, 400, `The percentages add up to ${Math.round(total * 100) / 100}, not 100.`)
      value = { mode, percents: Object.fromEntries(keys.map((k) => [k, given[k]])) }
    }
    await db.update(job).set({ revenueSplit: value, updatedAt: new Date() } as any).where(and(eq(job.id, c.req.param('id')), eq(job.companyId, companyId)))
    d.audit.log({ action: d.audit.ACTIONS.UPDATE, entity: 'job', entityId: c.req.param('id'), entityName: crew.job.number, req: c })
    const after = await jobCrew(db, companyId, c.req.param('id'))
    return one(c, { jobId: c.req.param('id'), mode: value.mode, percents: value.percents ?? {}, applied: after?.job.mode ?? value.mode, shares: after?.job.shares ?? {}, note: after?.job.fallback ?? null })
  })
  return app
}
