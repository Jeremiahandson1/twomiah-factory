// /api/budgets — the company's operating budget, its overhead recovery and the markups it gives (landscaping parity row 27; LMN;
// feature company_budget, not ready). data/companyBudget.ts has the arithmetic.
//
//   GET    /                      the budgets, newest year first, each with its headline rates      margin:read
//   POST   /                      a new draft { year, name, copyFrom? }                               company:update
//   GET    /:id                   one budget with every rate                                         margin:read
//   PUT    /:id                   change a DRAFT (an active budget is locked: copy it)               company:update
//   POST   /:id/activate          the year's active budget, locked; the year's old one archived      company:update
//   POST   /:id/apply-markups     the active budget's markups into the quote form's markup defaults  company:update
//   DELETE /:id                   a draft only                                                        company:update
//
// The budget is the owner's planning figures — wages, overhead, the owner's own salary — so reading it asks margin:read (the
// permission the quote route strips line cost on; a crew seat has none), and changing it asks company:update (owner and admins).
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { companyBudget } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { budgetRates, budgetInput, budgetProblem, listBudgets, getBudget, activateBudget, applyBudgetMarkups, BUDGET_FEATURE } from '../../data/companyBudget.ts'

const FIELDS = ['name', 'method', 'profitPct', 'laborBurdenPct', 'overheadBurdenPct', 'overtimePct', 'overtimeMultiplier', 'unbillablePct', 'materialsMarkupPct', 'equipmentMarkupPct', 'subsMarkupPct'] as const
const DECIMALS = new Set(['profitPct', 'laborBurdenPct', 'overheadBurdenPct', 'overtimePct', 'overtimeMultiplier', 'unbillablePct', 'materialsMarkupPct', 'equipmentMarkupPct', 'subsMarkupPct'])

export function createCompanyBudgetRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const gate = async (c: any) => (await d.features.isFeatureEnabled(c.get('user').companyId, BUDGET_FEATURE).catch(() => false)) ? null : fail(c, 404, 'Not found')
  const shown = (row: any) => ({ ...row, rates: budgetRates(budgetInput(row)) })
  /** The fields of a body, ready for the table. */
  const patchOf = (b: any) => {
    const set: Record<string, unknown> = {}
    for (const k of FIELDS) if (b[k] !== undefined) set[k] = DECIMALS.has(k) ? String(Number(b[k])) : k === 'name' ? String(b[k]).trim() : b[k]
    if (b.lines !== undefined) set.lines = budgetInput({ lines: b.lines }).lines
    return set
  }

  app.get('/', requirePermission('margin:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const rows = await listBudgets(db, c.get('user').companyId)
    return listAll(c, rows.map((r: any) => {
      const x = budgetRates(budgetInput(r))
      return { id: r.id, year: r.year, name: r.name, status: r.status, method: r.method, activatedAt: r.activatedAt, sales: x.sales, overhead: x.overhead, netProfit: x.netProfit, markupDefaults: x.markupDefaults }
    }))
  })

  app.post('/', requirePermission('company:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    const year = Number(b?.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail(c, 400, 'Pick the year this budget is for.', undefined, { year: 'A year, like 2027' })
    let base: Record<string, unknown> = {}
    if (b?.copyFrom) {
      const from = await getBudget(db, u.companyId, String(b.copyFrom))
      if (!from) return fail(c, 404, 'The budget to copy was not found')
      const { id: _i, companyId: _c, status: _s, activatedAt: _a, activatedById: _ab, createdAt: _cr, updatedAt: _u, year: _y, name: _n, ...rest } = from
      base = rest
    }
    const problem = budgetProblem(b)
    if (problem) return fail(c, 400, problem.problem, undefined, { [problem.field]: problem.problem })
    const [row] = await db.insert(companyBudget).values({ ...base, ...patchOf(b), companyId: u.companyId, year, name: typeof b?.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 120) : `${year} budget`, status: 'draft' }).returning()
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'company_budget', entityId: row.id, entityName: row.name, userId: u.userId, companyId: u.companyId })
    return one(c, shown(row), 201)
  })

  app.get('/:id', requirePermission('margin:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const row = await getBudget(db, c.get('user').companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Budget not found')
    return one(c, shown(row))
  })

  app.put('/:id', requirePermission('company:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getBudget(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Budget not found')
    if (row.status !== 'draft') return fail(c, 409, row.status === 'active' ? 'The active budget is locked. Copy it to a new draft to change it.' : 'An archived budget cannot change. Copy it to a new draft.')
    const b: any = await c.req.json().catch(() => ({}))
    const problem = budgetProblem(b)
    if (problem) return fail(c, 400, problem.problem, undefined, { [problem.field]: problem.problem })
    const [out] = await db.update(companyBudget).set({ ...patchOf(b), updatedAt: new Date() }).where(eq(companyBudget.id, row.id)).returning()
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'company_budget', entityId: row.id, entityName: out.name, userId: u.userId, companyId: u.companyId })
    return one(c, shown(out))
  })

  app.post('/:id/activate', requirePermission('company:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getBudget(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Budget not found')
    if (row.status === 'active') return one(c, shown(row))
    if (row.status === 'archived') return fail(c, 409, 'An archived budget cannot be made active again. Copy it to a new draft.')
    const out = await activateBudget(db, u.companyId, row.id, u.userId)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'company_budget', entityId: row.id, entityName: `${row.name} made active`, userId: u.userId, companyId: u.companyId })
    return one(c, shown(out))
  })

  app.post('/:id/apply-markups', requirePermission('company:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getBudget(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Budget not found')
    if (row.status !== 'active') return fail(c, 409, 'Make the budget active first: quotes are priced from the active budget only.')
    const rates = budgetRates(budgetInput(row))
    const out = await applyBudgetMarkups(db, u.companyId, rates.markupDefaults)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: u.companyId, metadata: { markupDefaults: out, fromBudget: row.id }, req: c })
    return one(c, { markupDefaults: out.after, markupDefaultsOn: await d.features.isFeatureEnabled(u.companyId, 'markup_defaults').catch(() => false) })
  })

  app.delete('/:id', requirePermission('company:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await getBudget(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Budget not found')
    if (row.status !== 'draft') return fail(c, 409, 'Only a draft can be deleted; the active and archived budgets are kept.')
    await db.delete(companyBudget).where(eq(companyBudget.id, row.id))
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'company_budget', entityId: row.id, entityName: row.name, userId: u.userId, companyId: u.companyId })
    return one(c, { id: row.id, deleted: true })
  })

  return app
}
