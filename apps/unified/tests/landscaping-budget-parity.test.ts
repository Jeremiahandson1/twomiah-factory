// Landscaping parity row 27 — the operating budget → overhead recovery → markup (LMN; data/companyBudget.ts,
// crm/landscaping/companyBudget.ts; company_budget, not ready). Fails without the change: none of it existed.
//   · LMN's worked example: $25 wage + 29% burden = $32.25; at 204% overhead → $98.04; at 10% profit → $107.84;
//   · the three recovery methods (MORS, FLH, SORS) from one budget;
//   · a draft changes, the active budget is locked, a year has one active budget, a copy makes a new draft;
//   · the active budget's markups fill the quote form's markup defaults (one markup model, not two);
//   · a crew seat is refused; off, every path is shut.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { laborUnitCost, sellPrice, budgetRates, combinedMarkup, type BudgetInput } from '../server/data/companyBudget.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId: string
let owner: string
let crew: string
const as = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const post = (token: string, path: string, json: any = {}) => as(token, path, { method: 'POST', json })
const put = (token: string, path: string, json: any = {}) => as(token, path, { method: 'PUT', json })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices', ...list] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

const BASE: Omit<BudgetInput, 'method' | 'lines'> = { profitPct: 10, laborBurdenPct: 25, overheadBurdenPct: 10, overtimePct: 0, overtimeMultiplier: 1.5, unbillablePct: 0, materialsMarkupPct: 10, equipmentMarkupPct: 25, subsMarkupPct: 5 }
const LINES: BudgetInput['lines'] = [
  { section: 'sales', name: 'Maintenance', amount: 600_000 },
  { section: 'labor', name: 'Crew', count: 5, hours: 2000, wage: 20 }, // 10,000 h × $20 × 1.25 = $250,000
  { section: 'equipment', name: 'Mowers', amount: 40_000 },
  { section: 'materials', name: 'Mulch', amount: 60_000 },
  { section: 'subs', name: 'Tree work', amount: 20_000 },
  { section: 'overhead', name: 'Rent', amount: 79_000 },
  { section: 'overhead_wage', name: 'Owner', amount: 70_000 }, // × 1.10 = 77,000 → overhead 156,000
]

describe('the arithmetic', () => {
  test('LMN’s worked example: $25 + 29% = $32.25 → $98.04 at 204% overhead → $107.84 at 10% profit', () => {
    const hour = laborUnitCost(25, { overtimePct: 0, overtimeMultiplier: 1.5, unbillablePct: 0, laborBurdenPct: 29 })
    expect(hour).toBe(32.25)
    expect(sellPrice(hour, 204, 0)).toBe(98.04)
    expect(sellPrice(hour, 204, 10)).toBe(107.84)
    // Overtime and unbillable time raise the cost of a billable hour.
    expect(laborUnitCost(20, { overtimePct: 10, overtimeMultiplier: 1.5, unbillablePct: 20, laborBurdenPct: 0 })).toBe(26.25) // 20 × 1.05 ÷ 0.8
  })

  test('the three methods from one budget', () => {
    const mors = budgetRates({ ...BASE, method: 'mors', lines: LINES })
    expect([mors.fieldLabor, mors.directCost, mors.overhead, mors.netProfit]).toEqual([250_000, 370_000, 156_000, 74_000])
    expect(mors.overheadRatio).toBe(26)
    expect(mors.billableHours).toBe(10_000)
    expect(mors.revenuePerManHour).toBe(60)
    // Recovered on materials, equipment and subs: 6,000 + 10,000 + 1,000; the rest (139,000) on $250,000 of labour = 55.6%.
    expect(mors.overheadMarkup).toEqual({ labor: 55.6, materials: 10, equipment: 25, subs: 5 })
    expect(mors.markupDefaults.labor).toBe(combinedMarkup(55.6, 10))
    expect(mors.markupDefaults).toMatchObject({ material: 21, part: 21, other: 37.5, service: 15.5 })

    const sors = budgetRates({ ...BASE, method: 'sors', lines: LINES })
    expect(sors.overheadMarkup.labor).toBe(42.2) // 156,000 ÷ 370,000
    expect(new Set(Object.values(sors.markupDefaults)).size).toBe(1)

    const flh = budgetRates({ ...BASE, method: 'flh', lines: LINES })
    expect(flh.flhPerHour).toBe(15.6) // 156,000 ÷ 10,000 h
    expect(flh.avgLaborHour).toBe(25)
    expect(flh.overheadMarkup.labor).toBe(62.4) // 15.60 on a $25 hour
    expect(flh.markupDefaults.material).toBe(10) // profit only
  })

  test('overhead with no field labour to carry it is said, not hidden', () => {
    const r = budgetRates({ ...BASE, method: 'mors', lines: LINES.filter((l) => l.section !== 'labor') })
    expect(r.unrecovered).toBeGreaterThan(0)
  })
})

describe('the budget screen’s routes', () => {
  beforeAll(async () => {
    t = await bootTenant({ vertical: 'landscaping' })
    const s = await seedOwner(t)
    companyId = s.company.id
    await setFeatures(['company_budget', 'markup_defaults'])
    owner = await login('owner@test.example', s.password)
    const password = 'Correct-horse-1'
    await t.db.insert(t.schema.user).values({ companyId, email: 'crew@test.example', firstName: 'Cam', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') } as any)
    crew = await login('crew@test.example', password)
  })

  test('a draft is made and changed; the rates come back; bad figures are refused', async () => {
    const made = await post(owner, '/api/budgets', { year: 2027 })
    expect(made.status).toBe(201)
    const b = await made.json()
    expect(b.status).toBe('draft')
    expect((await put(owner, `/api/budgets/${b.id}`, { method: 'xyz' })).status).toBe(400)
    expect((await put(owner, `/api/budgets/${b.id}`, { lines: [{ section: 'nope', name: 'x' }] })).status).toBe(400)
    expect((await put(owner, `/api/budgets/${b.id}`, { unbillablePct: 95 })).status).toBe(400)
    const saved = await (await put(owner, `/api/budgets/${b.id}`, { ...BASE, method: 'mors', lines: LINES })).json()
    expect(saved.rates.overheadMarkup.labor).toBe(55.6)
    const list = await (await as(owner, '/api/budgets')).json()
    expect(list.data[0]).toMatchObject({ id: b.id, year: 2027, status: 'draft', netProfit: 74_000 })
  })

  test('make active locks it; a year has one active budget; a copy is a new draft; only a draft is deleted', async () => {
    const [b] = (await (await as(owner, '/api/budgets')).json()).data
    expect((await post(owner, `/api/budgets/${b.id}/apply-markups`)).status).toBe(409) // not active yet
    const act = await (await post(owner, `/api/budgets/${b.id}/activate`)).json()
    expect(act.status).toBe('active')
    expect((await put(owner, `/api/budgets/${b.id}`, { profitPct: 20 })).status).toBe(409)
    expect((await as(owner, `/api/budgets/${b.id}`, { method: 'DELETE' })).status).toBe(409)

    const copy = await (await post(owner, '/api/budgets', { year: 2027, copyFrom: b.id, name: 'Revised' })).json()
    expect(copy.status).toBe('draft')
    expect(copy.rates.overheadMarkup.labor).toBe(55.6) // the lines came with it
    await post(owner, `/api/budgets/${copy.id}/activate`)
    const rows = (await (await as(owner, '/api/budgets')).json()).data
    expect(rows.filter((r: any) => r.year === 2027 && r.status === 'active').map((r: any) => r.id)).toEqual([copy.id])
    expect(rows.find((r: any) => r.id === b.id).status).toBe('archived')

    const spare = await (await post(owner, '/api/budgets', { year: 2028 })).json()
    expect((await as(owner, `/api/budgets/${spare.id}`, { method: 'DELETE' })).status).toBe(200)
  })

  test('the active budget’s markups fill the markup defaults the quote form reads', async () => {
    const active = (await (await as(owner, '/api/budgets')).json()).data.find((r: any) => r.status === 'active')
    const res = await post(owner, `/api/budgets/${active.id}/apply-markups`)
    expect(res.status).toBe(200)
    expect((await res.json()).markupDefaultsOn).toBe(true)
    const defaults = await (await as(owner, '/api/markup-defaults')).json()
    // The budget fills the kinds it has a markup for; Subcontractor (a kind since e4ba6e1bc, contractor live test 11/07) reads as none set.
    expect(defaults).toEqual({ labor: combinedMarkup(55.6, 10), material: 21, part: 21, service: 15.5, subcontractor: null, other: 37.5 })
  })

  test('a crew seat is refused; off, every path is shut; the switch is hidden and landscaping’s', async () => {
    expect((await as(crew, '/api/budgets')).status).toBe(403)
    expect((await post(crew, '/api/budgets', { year: 2029 })).status).toBe(403)
    await setFeatures([])
    try {
      expect((await as(owner, '/api/budgets')).status).toBe(404)
    } finally { await setFeatures(['company_budget', 'markup_defaults']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'company_budget') as any
    expect(f?.hidden).toBeFalsy()
    expect(f?.templates).toEqual(['crm-landscaping'])
    expect((FEATURE_REGISTRY.find((x: any) => x.id === 'markup_defaults') as any)?.templates).toContain('crm-landscaping')
  })
})
