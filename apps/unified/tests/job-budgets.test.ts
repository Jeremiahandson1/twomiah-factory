// Project budgets under Job Costing (brief item 5, the screen that was missing): the route is its own (not ready) feature
// `job_budgets` and still needs reports:read; the panel under Job Costing shows only with both, lists a project's budget by cost
// code beside what it has cost, says so when there is no budget yet, and leaves the page as it was when it is off.
// Server half: the real app. Screen half: happy-dom (no headless browser here).
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Window } from 'happy-dom'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const win: any = new Window({ url: 'https://crm.example.com/crm/job-costing' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const P = '../../../packages/tenant-ui/src/'
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { JobCostingPage } = await import(P + 'reporting/JobCostingPage.tsx') as any
const h = React.createElement as any
const json = async (r: Response) => (await r.json()) as any

describe('the feature', () => {
  test('is registered, not ready, and offered to the general contractor only', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'job_budgets')
    expect(f).toBeTruthy()
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
  })
})

describe('the server', () => {
  async function boot(features: string[]) {
    const t = await bootTenant({ vertical: 'contractor' })
    const s = await seedOwner(t)
    await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
    const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
    const owner = as(await login('owner@test.example', s.password))
    await ins(t.schema.user, { companyId: s.company.id, email: 'field@test.example', firstName: 'Field', lastName: 'Seat', role: 'field', passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    const field = as(await login('field@test.example', 'Correct-horse-1'))
    const customer = await ins(t.schema.contact, { companyId: s.company.id, type: 'client', name: 'Ann Able' })
    const project = await ins(t.schema.project, { companyId: s.company.id, number: 'PRJ-00001', name: 'Kitchen remodel', contactId: customer.id })
    await ins(t.schema.projectBudgetLine, { companyId: s.company.id, projectId: project.id, costCode: '06-Framing', estimatedCost: '820', estimatedPrice: '1080', uncostedLines: 0 })
    return { owner, field, project }
  }

  test('off: the budget route is not there; on: the owner reads it; on: a seat without reports:read is refused', async () => {
    const off = await boot(['projects', 'job_costing'])
    expect((await off.owner(`/api/job-costing/budget/${off.project.id}`)).status).toBe(404)
    const on = await boot(['projects', 'job_costing', 'job_budgets'])
    const r = await on.owner(`/api/job-costing/budget/${on.project.id}`)
    expect(r.status).toBe(200)
    expect((await json(r)).lines.map((l: any) => [l.costCode, l.estimatedCost])).toEqual([['06-Framing', 820]])
    expect((await on.field(`/api/job-costing/budget/${on.project.id}`)).status).toBe(403)
  }, 120_000)
})

const BUDGET = { projectName: 'Kitchen remodel', lines: [{ costCode: '02-Demo', estimatedCost: 800, estimatedPrice: 1000, uncostedLines: 0 }, { costCode: '06-Framing', estimatedCost: 820, estimatedPrice: 1080, uncostedLines: 1 }], totalCost: 1620, totalPrice: 2080, uncostedLines: 1, actualCost: 1900, remainingCost: -280, jobCount: 2 }

function fakeApi(budget: any = BUDGET) {
  const calls: string[] = []
  const api = {
    get: async (url: string) => {
      calls.push(url)
      if (url === '/api/job-costing/summary') return { jobs: [], totals: null, count: 0 }
      if (url === '/api/projects') return { data: [{ id: 'p1', number: 'PRJ-00001', name: 'Kitchen remodel' }] }
      if (url.startsWith('/api/job-costing/budget/')) return budget
      return []
    },
  }
  return { api, calls }
}
async function mount(api: any, auth: any | null) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const page = h(JobCostingPage, { api, config: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' } })
  await act(async () => { root.render(auth ? h(AuthContext.Provider, { value: auth }, page) : page) })
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return root
}
const seat = (features: string[], can: (p: string) => boolean = () => true) => ({ user: { id: 'u1', role: 'owner' }, company: {}, can, hasFeature: (f: string) => features.includes(f) })
const text = () => document.body.textContent || ''
async function pick(id: string) {
  const sel = document.querySelector('select[aria-label="Project"]') as any
  sel.value = id
  await act(async () => { sel.dispatchEvent(new win.Event('change', { bubbles: true })) })
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('the Job Costing screen', () => {
  test('with the feature and reports:read: pick a project, see its cost codes, spent so far and what is over', async () => {
    const f = fakeApi()
    const root = await mount(f.api, seat(['job_costing', 'job_budgets']))
    expect(text()).toContain('Project budgets')
    await pick('p1')
    expect(f.calls).toContain('/api/job-costing/budget/p1')
    const t = text()
    expect(t).toContain('02-Demo'); expect(t).toContain('06-Framing')
    expect(t).toContain('Over budget by')
    expect(t).toContain('$280.00')
    expect(t).toContain('1 quote line has no cost entered')
    act(() => root.unmount())
  })

  test('a project with no approved quote says so, in words', async () => {
    const f = fakeApi({ projectName: 'Kitchen remodel', lines: [], totalCost: 0, totalPrice: 0, uncostedLines: 0, actualCost: 0, remainingCost: 0, jobCount: 0 })
    const root = await mount(f.api, seat(['job_costing', 'job_budgets']))
    await pick('p1')
    expect(text()).toContain('No budget yet. When a quote on Kitchen remodel is approved, its cost codes appear here.')
    act(() => root.unmount())
  })

  test('without the feature, or without reports:read: no panel, and nothing asked for', async () => {
    for (const auth of [seat(['job_costing']), seat(['job_costing', 'job_budgets'], (p) => p !== 'reports:read')]) {
      const f = fakeApi()
      const root = await mount(f.api, auth)
      expect(text()).not.toContain('Project budgets')
      expect(f.calls.filter((c) => c === '/api/projects' || c.startsWith('/api/job-costing/budget'))).toEqual([])
      act(() => root.unmount())
    }
  })

  test('a page with no auth provider (an older template) draws as it did', async () => {
    const f = fakeApi()
    const root = await mount(f.api, null)
    expect(text()).toContain('Job Costing')
    expect(text()).not.toContain('Project budgets')
    act(() => root.unmount())
  })
})
