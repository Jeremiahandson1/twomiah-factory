// /api/plan-reports — the service-plan reports, finished (Plan Reports; feature plan_reports, `reports:read`):
//   the first three doors are what the page started with — plans sold per person, renewals due in 30/60 days, plans that ended —
//   and take the same filters as the rest (plan name, seller, customer, status);
//   /table builds any tab as columns and rows (chosen columns, links to the customer, plan and invoice behind a number,
//   ?format=csv); /filters lists the choices; /saved keeps a report as it is set up and emails it on a schedule.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { parseRange, ReportError, companyTimeZone, storeDateString, dayMarker } from '@twomiah/tenant-backend'
import { serviceAgreement, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { fail, one } from '../../http/reply.ts'
import { churnedPlans, planSales, renewalsDue, type PlanFilter, type Range } from '../../data/teamReports.ts'
import { PLAN_TABS, planTable, type PlanParams } from './planReportTables.ts'
import { PERIOD_IDS, chooseColumns, csvOf, resolvePeriod, type Col, type ReportTable } from './reportTables.ts'
import { createSavedReports, type SavedKind } from './savedReports.ts'
import { periodOf } from './teamReportRoutes.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
export const planParamsSchema = z.object({
  tab: z.enum(PLAN_TABS, { error: 'Choose a report' }),
  period: z.enum(PERIOD_IDS).optional(),
  startDate: z.string().regex(DAY, 'Enter a date').optional(),
  endDate: z.string().regex(DAY, 'Enter a date').optional(),
  planName: z.string().trim().max(200).optional(),
  sellerId: z.string().trim().max(60).optional(),
  contactId: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'pending', 'suspended', 'cancelled', 'expired']).optional(),
  days: z.union([z.literal(30), z.literal(60)]).optional(),
  kind: z.enum(['created', 'renewed', 'suspended', 'reactivated', 'cancelled', 'expired']).optional(),
  measure: z.enum(['recurring', 'collected']).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Enter a month').optional(),
  columns: z.array(z.string().max(40)).max(40).optional(),
}).strip()
export type PlanSavedParams = z.infer<typeof planParamsSchema>

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)

/** Saved or asked-for settings → the table's inputs, on the business's own clock. A bad date is a plain error. */
export async function planParamsToTable(db: any, companyId: string, saved: PlanSavedParams, now = new Date()): Promise<{ table: ReportTable; columns: Col[] }> {
  const tz = await companyTimeZone(db, companyId)
  const today = storeDateString(now, tz)
  const days = saved.period ? resolvePeriod(saved.period, today) : { startDate: saved.startDate, endDate: saved.endDate }
  let range: Range
  try { range = parseRange(days.startDate, days.endDate, tz) } catch (e) { if (e instanceof ReportError) throw new z.ZodError([{ code: 'custom', path: ['startDate'], message: e.message, input: undefined } as any]); throw e }
  const params: PlanParams = {
    tab: saved.tab, range, today, tz, now, days: saved.days, kind: saved.kind, measure: saved.measure, month: saved.month,
    filter: { name: clean(saved.planName), sellerId: clean(saved.sellerId), contactId: clean(saved.contactId), status: saved.status } as PlanFilter,
  }
  const table = await planTable(db, companyId, params)
  return { table, columns: chooseColumns(table.columns, saved.columns) }
}

const fromQuery = (c: any) => {
  const q = c.req.query()
  const raw: Record<string, unknown> = { ...q, columns: q.columns ? String(q.columns).split(',') : undefined, days: q.days ? Number(q.days) : undefined }
  return planParamsSchema.safeParse(raw)
}

export function createPlanReports(d: CrmDeps) {
  const saved = createSavedReports(d, [{
    report: 'plans', feature: 'plan_reports', permission: 'reports:read',
    parse: (p) => planParamsSchema.parse(p),
    run: (companyId, params, now) => planParamsToTable(d.db, companyId, params as PlanSavedParams, now),
  } satisfies SavedKind])
  return { saved, routes: createPlanReportRoutes(d, saved) }
}

function createPlanReportRoutes(d: CrmDeps, saved: ReturnType<typeof createSavedReports>) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const filterOf = (c: any): PlanFilter => ({ name: clean(c.req.query('planName')), sellerId: clean(c.req.query('sellerId')), contactId: clean(c.req.query('contactId')), status: clean(c.req.query('status')) })

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
    const rows = await renewalsDue(db, companyId, today, days, filterOf(c))
    return one(c, { days, rows, needsAction: rows.filter((r) => r.renewal === 'manual').length })
  })

  app.get('/churned', requirePermission('reports:read'), async (c) => {
    const p = await periodOf(d, c)
    if ('error' in p) return fail(c, 400, p.error as string)
    return one(c, { rows: await churnedPlans(db, p.companyId, p.range, filterOf(c)) })
  })

  /** Any tab as a table: the columns on offer, the ones chosen, the rows, and CSV. */
  app.get('/table', requirePermission('reports:read'), async (c) => {
    const parsed = fromQuery(c)
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check the report settings.')
    let built
    try { built = await planParamsToTable(db, c.get('user').companyId, parsed.data) }
    catch (e) { if (e instanceof z.ZodError) return fail(c, 400, e.issues[0]?.message || 'Check the dates.'); throw e }
    const { table, columns } = built
    if (c.req.query('format') === 'csv') {
      return new Response('﻿' + csvOf(table, columns), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="plan-reports-${table.tab}.csv"` } })
    }
    return one(c, { ...table, shown: columns.map((x) => x.key) })
  })

  /** What the filters can be set to: the plan names in use, the people who sold plans, the customers who have one. */
  app.get('/filters', requirePermission('reports:read'), async (c) => {
    const companyId = c.get('user').companyId as string
    const names = await db.selectDistinct({ name: serviceAgreement.name }).from(serviceAgreement).where(eq(serviceAgreement.companyId, companyId)).orderBy(serviceAgreement.name)
    const sellers = await db.execute(sql`SELECT DISTINCT u.id, u.first_name, u.last_name FROM service_agreement a JOIN "user" u ON u.id = a.sold_by_id WHERE a.company_id = ${companyId} ORDER BY u.first_name, u.last_name`)
    const customers = await db.execute(sql`SELECT DISTINCT c.id, c.name, c.company FROM service_agreement a JOIN contact c ON c.id = a.contact_id WHERE a.company_id = ${companyId} ORDER BY c.name LIMIT 500`)
    const rows = (r: any): any[] => (r?.rows || r) as any[]
    return one(c, {
      planNames: names.map((n: any) => n.name),
      sellers: rows(sellers).map((u) => ({ id: u.id, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unnamed' })),
      customers: rows(customers).map((x) => ({ id: x.id, name: x.name || x.company || 'Customer' })),
    })
  })

  app.route('/saved', saved.routesFor('plans'))
  return app
}
