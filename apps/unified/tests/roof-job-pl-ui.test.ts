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
const inputValue = async (el: Element | null | undefined, value: string) => {
  const input = el as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new win.Event('input', { bubbles: true })); input.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await settle()
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

describe('a crew’s lump-sum price (row 5)', () => {
  test('the job costing screen says the crew is costed from the work orders, and lists them', async () => {
    const { api } = fakeApi({
      '/api/job-costing/summary': SUMMARY, '/api/job-costing/by-category': { data: [] },
      '/api/job-costing/job/j1': { ...DETAIL, roof: { ...DETAIL.roof, crewBasis: 'lump_sum', crewCost: 2000, workOrderCost: 2000 }, workOrderDetail: [{ title: 'Tear off and re-roof', recipient: 'Ray', status: 'sent', cost: 2000 }] },
    })
    const root = await open(api)
    expect(text()).toContain('price on its work orders')
    expect(text()).toContain('Tear off and re-roof')
    expect(text()).toContain('$2,000.00')
    root.unmount()
  })

  const W = '../web/src/'
  async function mountOrders(permissions: string[]) {
    const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
    const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
    const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
    const { MemoryRouter } = await import('react-router-dom')
    const { api } = await import(W + 'api.ts') as any
    const Orders = (await import(W + 'crm/pages/roof/field/JobWorkOrders.tsx') as any).default
    const calls: Call[] = []
    const real = { get: api.get, post: api.post }
    api.get = async (url: string, params?: any) => {
      calls.push({ method: 'GET', path: url, body: params })
      if (url === '/api/work-orders') return { data: [{ id: 'w1', title: 'Tear off', status: 'sent', recipientName: 'Ray', recipientPhone: '715', materialLines: [], photoIds: [], completionPhotoIds: [], ...(permissions.includes('margin:read') ? { price: 2000 } : {}) }] }
      return { data: [] }
    }
    api.post = async (url: string, body?: any) => { calls.push({ method: 'POST', path: url, body }); return { id: 'w2' } }
    document.body.innerHTML = ''
    const el = document.createElement('div'); document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(h(PermissionsProvider, { role: 'manager', permissions }, h(ConfirmProvider, null, h(ToastProvider, null, h(MemoryRouter, null, h(Orders, { jobId: 'j1' })))))) })
    await settle()
    return { root, calls, undo: () => Object.assign(api, real) }
  }

  test('a seat that reads what the shop pays sees the price, sets it on the form and sends it', async () => {
    const { root, calls, undo } = await mountOrders(['jobs:dispatch', 'margin:read'])
    expect(text()).toContain('Price $2,000.00')
    await click(Array.from(document.querySelectorAll('button')).find((b) => /New work order/.test(b.textContent || '')))
    const price = document.querySelector('#wo-price') as HTMLInputElement
    expect(price).toBeTruthy()
    await inputValue(price, '2500')
    await inputValue(document.querySelector('#wo-title'), 'Re-roof')
    await inputValue(document.querySelector('#wo-name'), 'Ray')
    await inputValue(document.querySelector('#wo-phone'), '715-555-0199')
    await click(Array.from(document.querySelectorAll('button')).find((b) => /Save work order/.test(b.textContent || '')))
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/work-orders')?.body).toMatchObject({ jobId: 'j1', title: 'Re-roof', price: 2500 })
    root.unmount(); undo()
  })

  test('a seat without margin:read sees no price and no field for it, and sends none', async () => {
    const { root, calls, undo } = await mountOrders(['jobs:dispatch'])
    expect(text()).not.toContain('Price $')
    await click(Array.from(document.querySelectorAll('button')).find((b) => /New work order/.test(b.textContent || '')))
    expect(document.querySelector('#wo-price')).toBeNull()
    await inputValue(document.querySelector('#wo-title'), 'Re-roof')
    await inputValue(document.querySelector('#wo-name'), 'Ray')
    await inputValue(document.querySelector('#wo-phone'), '715-555-0199')
    await click(Array.from(document.querySelectorAll('button')).find((b) => /Save work order/.test(b.textContent || '')))
    const body = calls.find((c) => c.method === 'POST' && c.path === '/api/work-orders')?.body
    expect(body).toBeTruthy()
    expect('price' in body).toBe(false)
    root.unmount(); undo()
  })
})
