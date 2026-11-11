// A project's size and its builder's risk policy (parity tier 3, contractor — Buildertrend's job fields; feature builders_risk,
// not ready).
//
//   GET /api/project-details/:projectId    projects:read     { squareFeet, buildersRisk, perSquareFoot }
//   PUT /api/project-details/:projectId    projects:update   { squareFeet?, buildersRisk? } (null clears)
//
// perSquareFoot: the price (estimated value) and the budget per square foot, where the size is known — the money only for a seat
// that sees project money (MONEY_PERMISSION, the rule the project page's own figures follow in ./projects.ts). The policy says when it ends; one ending within 30 days, or already ended while the project is open, is flagged.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { project } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { canSeeWith } from '../deps.ts'
import { MONEY_PERMISSION } from './projects.ts'

const DAY = 86_400_000
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31')
const policy = z.object({
  carrier: z.string().trim().min(1, 'Name the insurer').max(120),
  policyNumber: z.string().trim().max(80).optional().nullable(),
  coverage: z.number().min(0, 'Coverage cannot be negative').max(1_000_000_000).optional().nullable(),
  startsOn: ymd.optional().nullable(),
  endsOn: ymd.optional().nullable(),
}).refine((p) => !p.startsOn || !p.endsOn || p.endsOn >= p.startsOn, { message: 'The policy must end on or after it starts', path: ['endsOn'] })
const body = z.object({
  squareFeet: z.number().int('Whole square feet').min(1, 'At least 1 square foot').max(10_000_000).nullable().optional(),
  buildersRisk: policy.nullable().optional(),
})

const per = (money: unknown, sqft: number | null) => (sqft && money != null && Number(money) > 0 ? Math.round((Number(money) / sqft) * 100) / 100 : null)

/** Ending soon (30 days) or ended while the work is still open — said on the project page. */
export function policyStanding(p: any, projectOpen: boolean, today: Date = new Date()): 'ok' | 'ending_soon' | 'ended' | null {
  if (!p?.endsOn) return null
  const ends = Date.parse(`${p.endsOn}T00:00:00Z`)
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  if (ends < now) return projectOpen ? 'ended' : 'ok'
  return ends - now <= 30 * DAY ? 'ending_soon' : 'ok'
}

export function createProjectDetailRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const mayWith = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  const view = async (c: any, p: any) => {
    const me = c.get('user')
    const money = await mayWith(me.role, MONEY_PERMISSION, me.userId).catch(() => false)
    const open = !['completed', 'cancelled'].includes(String(p.status))
    return {
      squareFeet: p.squareFeet ?? null,
      buildersRisk: p.buildersRisk ?? null,
      policyStanding: policyStanding(p.buildersRisk, open),
      perSquareFoot: money ? { price: per(p.estimatedValue, p.squareFeet), budget: per(p.budget, p.squareFeet) } : null,
    }
  }
  const projectOf = async (companyId: string, id: string) =>
    (await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, companyId))).limit(1))[0] ?? null

  app.get('/:projectId', requirePermission('projects:read'), async (c) => {
    const p = await projectOf(c.get('user').companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    return one(c, await view(c, p))
  })

  app.put('/:projectId', requirePermission('projects:update'), async (c) => {
    const parsed = body.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const p = await projectOf(companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.squareFeet !== undefined) patch.squareFeet = parsed.data.squareFeet
    if (parsed.data.buildersRisk !== undefined) patch.buildersRisk = parsed.data.buildersRisk
    const [updated] = await db.update(project).set(patch as any).where(and(eq(project.id, p.id), eq(project.companyId, companyId))).returning()
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'project', entityId: p.id, entityName: p.name, metadata: { squareFeet: updated.squareFeet, buildersRisk: updated.buildersRisk }, req: c })
    return one(c, await view(c, updated))
  })

  return app
}
