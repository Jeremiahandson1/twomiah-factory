// Crews at /api/crews (ungated: roofing's index.ts mounts it without a feature and its menu shows Crews to every
// roofer — both sides the same). Moved from templates/crm-roof/backend/src/routes/crews.ts. The registry signs the
// person in.
//
// Changes from the template:
//   · GET / is { data, pagination } (was a bare array);
//   · a crew's jobs carry the CRM's job columns (decision 2): `number` and `address` where the template sent
//     `jobNumber` and `propertyAddress`;
//   · an edit and a delete are scoped to the company in the write itself, not only in the lookup before it.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, count, desc, eq, inArray, notInArray } from 'drizzle-orm'
import { crew, job } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { phone } from '../validation.ts'

const crewSchema = z.object({
  name: z.string().min(1),
  foremanName: z.string().min(1),
  // N3: the foreman's phone is a phone number, as the adjuster's is.
  foremanPhone: phone,
  size: z.number().int().min(1),
  isSubcontractor: z.boolean().default(false),
  subcontractorCompanyName: z.string().optional(),
  isActive: z.boolean().default(true),
})

/** A crew's job is active until it is finished (invoiced, collected) or closed (lost, cancelled). */
const ACTIVE_EXCLUDES = ['invoiced', 'collected', 'lost', 'cancelled']

export function createCrewRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const ownCrew = async (companyId: string, id: string) =>
    (await db.select().from(crew).where(and(eq(crew.id, id), eq(crew.companyId, companyId))).limit(1))[0]

  // GET / — every crew. Read by the Reports page to name its revenue-by-crew rows, so no permission beyond signing in.
  app.get('/', async (c) => {
    const companyId = c.get('user').companyId
    const crews = await db.select().from(crew).where(eq(crew.companyId, companyId)).orderBy(desc(crew.createdAt), desc(crew.id))
    // Each crew's active-job count (the same rule as GET /:id's activeJobs), so the list need not open every crew: the
    // template's screen read an activeJobCount no reply ever carried, and every crew read "0 active".
    const counts = crews.length
      ? await db.select({ crewId: job.assignedCrewId, n: count() }).from(job)
        .where(and(eq(job.companyId, companyId), inArray(job.assignedCrewId, crews.map((r: any) => r.id)), notInArray(job.status, ACTIVE_EXCLUDES)))
        .groupBy(job.assignedCrewId)
      : []
    const byCrew = new Map(counts.map((r: any) => [r.crewId, Number(r.n)]))
    const rows = crews.map((r: any) => ({ ...r, activeJobCount: byCrew.get(r.id) ?? 0 }))
    return listAll(c, rows)
  })

  app.post('/', requirePermission('crews:create'), async (c) => {
    const parsed = crewSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [created] = await db.insert(crew).values({ ...parsed.data, companyId: c.get('user').companyId } as any).returning()
    return one(c, created, 201)
  })

  // GET /:id — the crew and its active jobs: assigned to it and not finished (invoiced, collected) or closed (lost,
  // cancelled). The template's comment said so and its query listed every job the crew ever had.
  app.get('/:id', async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const found = await ownCrew(companyId, id)
    if (!found) return fail(c, 404, 'Crew not found')
    const activeJobs = await db.select({
      id: job.id, number: job.number, jobType: job.jobType, status: job.status,
      address: job.address, city: job.city, state: job.state, installDate: job.installDate,
    }).from(job).where(and(eq(job.assignedCrewId, id), eq(job.companyId, companyId), notInArray(job.status, ACTIVE_EXCLUDES))).orderBy(desc(job.createdAt), desc(job.id))
    return one(c, { ...found, activeJobs })
  })

  app.put('/:id', requirePermission('crews:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const parsed = crewSchema.partial().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    if (!(await ownCrew(companyId, id))) return fail(c, 404, 'Crew not found')
    const [updated] = await db.update(crew).set({ ...parsed.data, updatedAt: new Date() } as any)
      .where(and(eq(crew.id, id), eq(crew.companyId, companyId))).returning()
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('crews:delete'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    if (!(await ownCrew(companyId, id))) return fail(c, 404, 'Crew not found')
    await db.delete(crew).where(and(eq(crew.id, id), eq(crew.companyId, companyId)))
    return c.body(null, 204)
  })

  return app
}
