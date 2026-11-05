// Actual cost by cost code, the screens (contractor parity item 1). Server half: cost-by-code.test.ts.
// happy-dom, not a headless browser: it renders the React and reads the text; it does not lay anything out or run CSS.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

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
const { ExpensesPage } = await import(P + 'people/ExpensesPage.tsx') as any
const { TimePage } = await import(P + 'people/TimePage.tsx') as any
const h = React.createElement as any

const BUDGET = {
  projectName: 'Kitchen remodel', byCode: true, jobCount: 1,
  lines: [
    { costCode: '02-Demo', estimatedCost: 800, estimatedPrice: 1000, uncostedLines: 0, actualCost: 500, overBy: 0, profit: 200, margin: 20 },
    { costCode: '06-Framing', estimatedCost: 820, estimatedPrice: 1080, uncostedLines: 0, actualCost: 1000, overBy: 180, profit: 80, margin: 7.4 },
  ],
  unbudgeted: [{ costCode: 'Uncoded', actualCost: 100 }],
  totalCost: 1620, totalPrice: 2080, uncostedLines: 0, actualCost: 1600, remainingCost: 20, totalProfit: 180,
}
const seat = (features: string[]) => ({ user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) })
const text = () => document.body.textContent || ''
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function mount(page: any, auth: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, page)) })
  await settle()
  return root
}
const toast = { success() {}, error() {}, info() {} }
const listApi = (budget: any = BUDGET) => ({
  get: async (url: string) => {
    if (url === '/api/job-costing/summary') return { jobs: [], totals: null, count: 0 }
    if (url === '/api/projects') return { data: [{ id: 'p1', number: 'PRJ-00001', name: 'Kitchen remodel' }] }
    if (url.startsWith('/api/job-costing/budget/')) return budget
    if (url === '/api/expenses/categories') return { data: ['materials', 'other'] }
    if (url === '/api/time/active') return null
    return { data: [], pagination: { total: 0, pages: 1 } }
  },
  post: async () => ({}), put: async () => ({}), delete: async () => ({}),
})
async function pick(id: string) {
  const sel = document.querySelector('select[aria-label="Project"]') as any
  sel.value = id
  await act(async () => { sel.dispatchEvent(new win.Event('change', { bubbles: true })) })
  await settle()
}
const click = async (label: string) => {
  const b = [...document.querySelectorAll('button')].find((x: any) => (x.textContent || '').includes(label)) as any
  expect(b).toBeTruthy()
  await act(async () => { b.click() }); await settle()
}

describe('the budget panel', () => {
  test('with cost_by_code: actual cost and expected profit per line, what is over, and cost with no line', async () => {
    const root = await mount(h(JobCostingPage, { api: listApi(), config: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' } }), seat(['job_costing', 'job_budgets', 'cost_by_code']))
    await pick('p1')
    const t = text()
    expect(t).toContain('Actual cost'); expect(t).toContain('Expected profit')
    expect(t).toContain('$200.00 (20%)')   // demo: under budget → the budget's profit
    expect(t).toContain('$80.00 (7.4%)')   // framing: ran over, so the profit it will really make
    expect(t).toContain('Uncoded'); expect(t).toContain('(not on the budget)'); expect(t).toContain('-$100.00')
    expect(t).toContain('Expected profit on the whole project'); expect(t).toContain('$180.00')
    act(() => root.unmount())
  })

  test('without it (the route sends no actuals): the panel is the budget alone, as before', async () => {
    const plain = { ...BUDGET, byCode: undefined, unbudgeted: undefined, lines: BUDGET.lines.map((l) => ({ costCode: l.costCode, estimatedCost: l.estimatedCost, estimatedPrice: l.estimatedPrice, uncostedLines: 0 })) }
    const root = await mount(h(JobCostingPage, { api: listApi(plain), config: { jobsLabel: 'Jobs', costingLabel: 'Job Costing' } }), seat(['job_costing', 'job_budgets']))
    await pick('p1')
    expect(text()).toContain('02-Demo')
    expect(text()).not.toContain('Expected profit'); expect(text()).not.toContain('(not on the budget)')
    act(() => root.unmount())
  })
})

describe('the Cost code box on the forms', () => {
  test('Expenses and Time show it with cost_by_code, and not without', async () => {
    for (const [page, button] of [[h(ExpensesPage, { api: listApi(), toast }), 'Add Expense'], [h(TimePage, { api: listApi(), toast }), 'Log Time']] as const) {
      for (const [features, shown] of [[['projects', 'cost_by_code'], true], [['projects'], false]] as const) {
        const root = await mount(page, seat([...features]))
        await click(button)
        expect(text().includes('Cost code (optional)')).toBe(shown)
        act(() => root.unmount())
      }
    }
  })
})
