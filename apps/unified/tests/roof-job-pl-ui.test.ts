// The Job Costing screen for a roofer, in a DOM (roofing parity row 5): the commissions a job's people earned are a cost shown beside
// the roof's other figures, with who earned what for a seat that reads commissions; the worksheet approval and a crew's lump-sum
// price are added to this file as those pieces land.
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
const { JobCostingPage } = await import(P + 'reporting/JobCostingPage.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

type Call = { method: string; path: string; body?: any }
function fakeApi(routes: Record<string, any>) {
  const calls: Call[] = []
  const answer = (method: string) => async (path: string, body?: any) => {
    calls.push({ method, path, body })
    const hit = routes[`${method} ${path}`] ?? routes[path]
    if (hit === undefined) throw new Error(`no route ${method} ${path}`)
    return typeof hit === 'function' ? hit(body) : hit
  }
  return { calls, api: { get: answer('GET'), post: answer('POST'), put: answer('PUT'), delete: answer('DELETE') } }
}
async function mount(api: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(h(JobCostingPage, { api, config: {} })) })
  await settle()
  return root
}
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }

export const SIDE = { revenue: 10000, laborCost: 0, materialCost: 4000, totalCost: 5140, profit: 4860, margin: 48.6 }
export const SUMMARY = {
  jobs: [{ id: 'j1', number: 'JOB-00001', title: 'Roof', status: 'collected', contact: 'Lee Marsh', estimatedRevenue: 10000, invoicedRevenue: 10000, totalCost: 5140, profit: 4860, margin: 48.6, laborHours: 0, isProfitable: true, variance: 4000 }],
  totals: { estimatedRevenue: 10000, invoicedRevenue: 10000, totalCost: 5140, profit: 4860, laborHours: 0, profitableCount: 1, margin: 48.6, profitablePercent: 100 },
  count: 1,
}
export const DETAIL = {
  job: { id: 'j1', number: 'JOB-00001', title: 'Roof', status: 'collected' },
  estimated: { ...SIDE, revenue: 10000, totalCost: 0, profit: 10000, margin: 100 },
  actual: { ...SIDE, commissionCost: 1140 },
  variance: { cost: 4000, labor: 0, material: 4000, hours: 0, costPercent: 0 },
  roof: { materialOrderCost: 4000, crewCost: 0, crewBasis: 'unknown', crewName: null, squares: 30, payPerSquare: null, commissionCost: 1140, supplements: { approved: 0, pending: 0, denied: 0, count: 0 } },
}
export const open = async (api: any) => {
  const root = await mount(api)
  await click(Array.from(document.querySelectorAll('tr')).find((r) => (r.textContent || '').includes('JOB-00001')))
  return root
}

describe('commissions on the job costing screen', () => {
  test('the roof card shows the commissions as a cost, with who earned what for a seat that reads commissions', async () => {
    const { api } = fakeApi({
      '/api/job-costing/summary': SUMMARY, '/api/job-costing/by-category': { data: [] },
      '/api/job-costing/job/j1': { ...DETAIL, commissionDetail: [{ person: 'Rita Seat', source: 'auto', status: 'pending', amount: 600 }, { person: 'Sam Seat', source: 'auto', status: 'pending', amount: 540 }] },
    })
    const root = await open(api)
    expect(text()).toContain('Commissions')
    expect(text()).toContain('$1,140.00')
    expect(text()).toContain('Rita Seat')
    expect(text()).toContain('after them')
    root.unmount()
  })

  test('a seat that does not read commissions sees the total and no names', async () => {
    const { api } = fakeApi({ '/api/job-costing/summary': SUMMARY, '/api/job-costing/by-category': { data: [] }, '/api/job-costing/job/j1': DETAIL })
    const root = await open(api)
    expect(text()).toContain('$1,140.00')
    expect(text()).not.toContain('Rita Seat')
    root.unmount()
  })
})
