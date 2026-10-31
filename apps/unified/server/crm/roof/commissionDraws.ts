// Pre-commission DRAWS (roofing parity row 3; docs/parity/roof-commissions-costing.md #9): AccuLynx's "pre-commission when a job
// is turned in" — a part of a person's commission paid in advance, once the job has been signed (Approved), and taken off the commission
// when the plan pays it (./commissions.ts, drawnBy). A draw is a commission row with source 'draw' on the job, the plan and the person,
// so it is paid, voided and statemented like any other commission; only the final commission is smaller by what was drawn.
//
//   GET  /?jobId=   the job's draws                        commissions:read
//   POST /          give a draw                            commissions:create
//
// A draw is for a person who holds the plan's role on the job, on a plan that pays a job role automatically; once the plan has paid
// the person's commission on the job there is nothing left to draw against (409). Voiding a draw is the shared void
// (POST /api/commissions/:id/void). Mounted at /api/commission-draws under the existing commission_tracking feature.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import { jobRoleOfAutoEarn } from '@twomiah/tenant-backend'
import { commission, commissionPlan, job, jobPerson, user } from '../../db/schema/index.ts'
import { invalid } from '../../http/errors.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { TRIGGER_STAGE, stageReachedBy } from './commissions.ts'

const drawSchema = z.object({
  jobId: z.string().min(1, 'Choose the job.').max(64),
  userId: z.string().min(1, 'Choose who is drawing.').max(64),
  planId: z.string().min(1, 'Choose the plan the draw is against.').max(64),
  amount: z.number({ error: 'The draw is a number of dollars.' }).positive('A draw must be more than nothing.').max(100000000, 'That draw is too large.'),
  notes: z.string().max(500).optional(),
})

export function createCommissionDrawRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('commissions:read'), async (c) => {
    const jobId = c.req.query('jobId')
    if (!jobId) return fail(c, 400, 'Say which job.', 'validation_failed', { jobId: 'Choose a job.' })
    const me = c.get('user')
    const rows = await db.select().from(commission)
      .where(and(eq(commission.companyId, me.companyId), eq(commission.jobId, jobId), eq(commission.source, 'draw')))
      .orderBy(desc(commission.createdAt))
    return listAll(c, rows)
  })

  app.post('/', requirePermission('commissions:create'), async (c) => {
    const me = c.get('user')
    const parsed = drawSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const [row] = await db.select().from(job).where(and(eq(job.id, data.jobId), eq(job.companyId, me.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Job not found')
    if (!stageReachedBy(row.status, TRIGGER_STAGE.approved)) return fail(c, 409, 'A draw is given once the job is turned in — signed and Approved.', 'not_turned_in')
    const [plan] = await db.select().from(commissionPlan).where(and(eq(commissionPlan.id, data.planId), eq(commissionPlan.companyId, me.companyId))).limit(1)
    const role = plan ? jobRoleOfAutoEarn(plan.autoEarn) : null
    if (!plan || !role) return fail(c, 400, 'A draw is against a plan that pays someone on the job automatically.', 'bad_plan', { planId: 'Choose a plan that pays a role on the job.' })
    const [person] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, data.userId), eq(user.companyId, me.companyId))).limit(1)
    if (!person) return fail(c, 400, 'That person is not on this account.', 'not_on_account', { userId: 'Choose someone from the team.' })
    const holds = role === 'sales_rep'
      ? row.assignedSalesRepId === data.userId
      : (await db.select({ id: jobPerson.id }).from(jobPerson).where(and(eq(jobPerson.jobId, row.id), eq(jobPerson.userId, data.userId), eq(jobPerson.role, role))).limit(1)).length > 0
    if (!holds) return fail(c, 400, 'That person does not hold the plan’s role on this job.', 'not_on_job', { userId: 'Choose someone who holds the role on this job.' })
    const paid = await db.select({ id: commission.id }).from(commission)
      .where(and(eq(commission.companyId, me.companyId), eq(commission.jobId, row.id), eq(commission.planId, plan.id), eq(commission.userId, data.userId),
        eq(commission.source, 'auto'), notInArray(commission.status, ['void', 'cancelled']))).limit(1)
    if (paid.length) return fail(c, 409, 'This plan has already paid its commission on the job, so there is nothing left to draw against.', 'already_paid')
    const [made] = await db.insert(commission).values({
      companyId: me.companyId, planId: plan.id, userId: data.userId, jobId: row.id, baseAmount: '0', commissionAmount: String(data.amount),
      earnedAt: new Date(), source: 'draw',
      notes: `Draw in advance on ${row.number || 'the job'} when it was turned in${data.notes ? ` · ${data.notes}` : ''}; it comes off the commission when ${plan.name} pays it`,
    } as any).returning()
    return one(c, made, 201)
  })

  return app
}
