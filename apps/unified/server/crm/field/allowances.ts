// Shared allowances (contractor parity row 7; Buildertrend's allowances, JobTread's allowance budget lines): one allowance that
// several selections are chosen against — "Plumbing fixtures, $4,000" covering the faucet, both sinks and the tub. Feature
// shared_allowances (not ready); off, nothing here is reached and a selection is priced against its own allowance as before.
//
// The money, per shared allowance:
//   chosen   = what the APPROVED selections in it come to (option price × quantity)
//   standing = chosen − amount while every selection in it is approved; while any is still open, only an overage counts
//              (max(0, chosen − amount)) — the customer has not finished choosing, so no credit is given yet
//   raised   = what its approved selections have already been charged or credited (their price_difference)
// Approving a selection in it charges standing − raised (with this one counted as approved): the overage as it grows, and the
// credit, if it came in under, when the last one is approved. That is the change order's amount; the selection keeps it as its
// price_difference, so the change orders add up to exactly what the allowance ends over or under.
//
//   GET    /api/selections/project/:projectId/allowances   each shared allowance: amount, chosen, over / under, its selections
//   POST   /api/selections/project/:projectId/allowances   { name, amount, costCode?, selectionIds? }        selections:create
//   PUT    /api/selections/allowances/:id                  { name?, amount?, costCode? }                     selections:update
//   DELETE /api/selections/allowances/:id                  only while none of its selections is approved      selections:delete
//   PUT    /api/selections/:id/allowance                   { allowanceId | null } — put a selection under one  selections:update
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { round2 } from '@twomiah/tenant-backend'
import { project, projectAllowance, projectSelection, selectionOption } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

export const SHARED_ALLOWANCES = 'shared_allowances'
const money = z.coerce.number({ error: 'The amount must be a number' }).min(0, 'The amount cannot be negative').max(100_000_000, 'That amount is too large').transform(round2)
const createBody = z.object({
  name: z.string().trim().min(1, 'Name the allowance').max(200),
  amount: money,
  costCode: z.string().trim().max(60).optional(),
  selectionIds: z.array(z.string().min(1)).max(200).optional(),
})
const editBody = z.object({ name: z.string().trim().min(1).max(200).optional(), amount: money.optional(), costCode: z.string().trim().max(60).nullable().optional() })

type Member = { id: string; status: string; quantity: number; price: number | null; cost: number | null; priceDifference: number }

/** The arithmetic above, on rows already read: what the allowance stands at, and what one more approval would charge. */
export function allowanceMath(amount: number, members: Member[]) {
  const approved = members.filter((m) => m.status === 'approved' || m.status === 'ordered' || m.status === 'received')
  const chosen = round2(approved.reduce((s, m) => s + (m.price ?? 0) * (m.quantity || 0), 0))
  const open = members.length - approved.length
  const raised = round2(approved.reduce((s, m) => s + (Number(m.priceDifference) || 0), 0))
  const standing = (total: number, stillOpen: number) => round2(stillOpen > 0 ? Math.max(0, total - amount) : total - amount)
  /** What approving `id` at `price` (each) would charge now: the change order's amount. */
  const chargeFor = (id: string, price: number) => {
    const m = members.find((x) => x.id === id)
    const already = approved.some((x) => x.id === id)
    const total = round2(chosen - (already ? (m?.price ?? 0) * (m?.quantity || 0) : 0) + price * (m?.quantity || 0))
    const stillOpen = open - (already ? 0 : 1)
    const raisedOthers = round2(raised - (already ? Number(m?.priceDifference) || 0 : 0))
    return round2(standing(total, stillOpen) - raisedOthers)
  }
  return { chosen, open, raised, remaining: round2(amount - chosen), over: round2(Math.max(0, chosen - amount)), standing: standing(chosen, open), chargeFor }
}

export function createAllowances(d: CrmDeps) {
  const { db } = d

  const on = (companyId: string) => d.features.isFeatureEnabled(companyId, SHARED_ALLOWANCES)

  async function members(companyId: string, allowanceId: string): Promise<Member[]> {
    const rows = await db.select({
      id: projectSelection.id, status: projectSelection.status, quantity: projectSelection.quantity,
      priceDifference: projectSelection.priceDifference, price: selectionOption.price, cost: selectionOption.cost,
    }).from(projectSelection).leftJoin(selectionOption, eq(selectionOption.id, projectSelection.selectedOptionId))
      .where(and(eq(projectSelection.companyId, companyId), eq(projectSelection.allowanceId, allowanceId)))
    return rows.map((r: any) => ({ id: r.id, status: r.status, quantity: Number(r.quantity ?? 1), price: r.price == null ? null : Number(r.price), cost: r.cost == null ? null : Number(r.cost), priceDifference: Number(r.priceDifference) || 0 }))
  }

  async function find(companyId: string, id: string) {
    return (await db.select().from(projectAllowance).where(and(eq(projectAllowance.id, id), eq(projectAllowance.companyId, companyId))).limit(1))[0] as any
  }

  /**
   * What approving (or choosing) a selection under a shared allowance charges, at the option's price; null when the selection
   * is under none, or the feature is off — the caller then prices it against its own allowance, as before.
   */
  async function chargeFor(companyId: string, selection: { id: string; allowanceId?: string | null }, price: number): Promise<number | null> {
    if (!selection.allowanceId || !(await on(companyId))) return null
    const a = await find(companyId, selection.allowanceId)
    if (!a) return null
    return allowanceMath(Number(a.amount), await members(companyId, a.id)).chargeFor(selection.id, price)
  }

  /** The project's shared allowances with where each stands, for the screen and the summary. */
  async function forProject(companyId: string, projectId: string) {
    const rows = await db.select().from(projectAllowance)
      .where(and(eq(projectAllowance.companyId, companyId), eq(projectAllowance.projectId, projectId)))
      .orderBy(asc(projectAllowance.sortOrder), asc(projectAllowance.createdAt), asc(projectAllowance.id)) as any[]
    const out = []
    for (const a of rows) {
      const m = await members(companyId, a.id)
      const s = allowanceMath(Number(a.amount), m)
      out.push({
        id: a.id, name: a.name, amount: Number(a.amount), costCode: a.costCode, selectionIds: m.map((x) => x.id),
        chosen: s.chosen, remaining: s.remaining, over: s.over, raised: s.raised, openSelections: s.open,
      })
    }
    return out
  }

  function routes() {
    const { requirePermission } = d.permissions
    const app = new Hono<AppEnv>()
    // Off: the routes are not there, as the other gated routes answer.
    // Scoped to these paths: mounted at '/' under /api/selections, a '*' here would gate every selections route.
    const gate = async (c: any, next: any) => {
      if (!(await on((c.get('user') as any).companyId))) return fail(c, 404, 'Not found')
      await next()
    }
    app.use('/project/:projectId/allowances', gate)
    app.use('/allowances/:id', gate)
    app.use('/:id/allowance', gate)
    const ownProject = async (companyId: string, projectId: string) =>
      (await db.select({ id: project.id }).from(project).where(and(eq(project.id, projectId), eq(project.companyId, companyId))).limit(1))[0]

    app.get('/project/:projectId/allowances', async (c) => {
      const me = c.get('user') as any
      if (!(await ownProject(me.companyId, c.req.param('projectId')))) return fail(c, 404, 'Project not found')
      return listAll(c, await forProject(me.companyId, c.req.param('projectId')))
    })

    app.post('/project/:projectId/allowances', requirePermission('selections:create'), async (c) => {
      const me = c.get('user') as any
      const projectId = c.req.param('projectId')
      if (!(await ownProject(me.companyId, projectId))) return fail(c, 404, 'Project not found')
      const parsed = createBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return invalid(c, parsed.error)
      const ids = parsed.data.selectionIds || []
      if (ids.length) {
        const sel = await db.select({ id: projectSelection.id, status: projectSelection.status, projectId: projectSelection.projectId, name: projectSelection.name })
          .from(projectSelection).where(and(eq(projectSelection.companyId, me.companyId), inArray(projectSelection.id, ids))) as any[]
        if (sel.length !== new Set(ids).size || sel.some((s) => s.projectId !== projectId)) return fail(c, 400, 'Every selection must be on this project')
        const locked = sel.find((s) => s.status !== 'pending' && s.status !== 'selected')
        if (locked) return fail(c, 400, `"${locked.name}" is already approved; an approved selection keeps the allowance it was priced against`)
      }
      const made = await db.transaction(async (tx: any) => {
        const [a] = await tx.insert(projectAllowance).values({ companyId: me.companyId, projectId, name: parsed.data.name, amount: String(parsed.data.amount), costCode: parsed.data.costCode || null }).returning()
        if (ids.length) await tx.update(projectSelection).set({ allowanceId: a.id }).where(and(eq(projectSelection.companyId, me.companyId), inArray(projectSelection.id, ids)))
        return a
      })
      return one(c, (await forProject(me.companyId, projectId)).find((a) => a.id === made.id) ?? {}, 201)
    })

    app.put('/allowances/:id', requirePermission('selections:update'), async (c) => {
      const me = c.get('user') as any
      const a = await find(me.companyId, c.req.param('id'))
      if (!a) return fail(c, 404, 'Allowance not found')
      const parsed = editBody.safeParse(await c.req.json().catch(() => ({})))
      if (!parsed.success) return invalid(c, parsed.error)
      if (parsed.data.amount !== undefined && Number(parsed.data.amount) !== Number(a.amount)) {
        const m = await members(me.companyId, a.id)
        if (m.some((x) => x.status !== 'pending' && x.status !== 'selected')) return fail(c, 400, 'A selection under this allowance is already approved and charged against its amount. Raise a change order for the difference instead.')
      }
      await db.update(projectAllowance).set({
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.amount !== undefined ? { amount: String(parsed.data.amount) } : {}),
        ...(parsed.data.costCode !== undefined ? { costCode: parsed.data.costCode || null } : {}),
      }).where(eq(projectAllowance.id, a.id))
      return one(c, (await forProject(me.companyId, a.projectId)).find((x) => x.id === a.id) ?? {})
    })

    app.delete('/allowances/:id', requirePermission('selections:delete'), async (c) => {
      const me = c.get('user') as any
      const a = await find(me.companyId, c.req.param('id'))
      if (!a) return fail(c, 404, 'Allowance not found')
      const m = await members(me.companyId, a.id)
      if (m.some((x) => x.status !== 'pending' && x.status !== 'selected')) return fail(c, 400, 'A selection under this allowance is already approved, so it stays.')
      await db.delete(projectAllowance).where(eq(projectAllowance.id, a.id))
      return one(c, { deleted: true })
    })

    app.put('/:id/allowance', requirePermission('selections:update'), async (c) => {
      const me = c.get('user') as any
      const body = await c.req.json().catch(() => ({}))
      const allowanceId = body?.allowanceId ? String(body.allowanceId) : null
      const [s] = await db.select().from(projectSelection).where(and(eq(projectSelection.id, c.req.param('id')), eq(projectSelection.companyId, me.companyId))).limit(1) as any[]
      if (!s) return fail(c, 404, 'Selection not found')
      if (s.status !== 'pending' && s.status !== 'selected') return fail(c, 400, `"${s.name}" is already approved; it keeps the allowance it was priced against`)
      if (allowanceId) {
        const a = await find(me.companyId, allowanceId)
        if (!a || a.projectId !== s.projectId) return fail(c, 400, 'That allowance is not on this selection’s project')
      }
      const [row] = await db.update(projectSelection).set({ allowanceId }).where(eq(projectSelection.id, s.id)).returning()
      return one(c, row)
    })

    return app
  }

  return { on, chargeFor, forProject, routes }
}

export type Allowances = ReturnType<typeof createAllowances>
