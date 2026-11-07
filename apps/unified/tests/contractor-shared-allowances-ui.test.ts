// Contractor parity row 7 (part a), the screens in a DOM: the Selections page's Shared allowances panel (read and made only
// where the business has shared_allowances), a selection under one says so, and the project budget shows the revised side
// when the server sends it. (happy-dom: no headless browser here.) The server half is contractor-shared-allowances.test.ts.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/selections' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { ProjectBudgets } = await import(P + 'reporting/ProjectBudgets.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const SelectionsPage = (await import(W + 'crm/pages/SelectionsPage.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

const SELECTIONS = [
  { id: 's1', name: 'Faucet', status: 'approved', quantity: 1, unit: 'each', allowance: 0, priceDifference: 0, category: { name: 'Plumbing Fixtures' }, sharedAllowance: { id: 'a1', name: 'Plumbing fixtures', amount: 4000, remaining: 3100 } },
  { id: 's2', name: 'Tub', status: 'pending', quantity: 1, unit: 'each', allowance: 0, priceDifference: 0, category: { name: 'Plumbing Fixtures' }, sharedAllowance: { id: 'a1', name: 'Plumbing fixtures', amount: 4000, remaining: 3100 } },
  { id: 's3', name: 'Mirror', status: 'pending', quantity: 1, unit: 'each', allowance: 150, priceDifference: 0, category: { name: 'Hardware' } },
]
const ALLOWANCES = [{ id: 'a1', name: 'Plumbing fixtures', amount: 4000, costCode: '15-Plumbing', selectionIds: ['s1', 's2'], chosen: 900, remaining: 3100, over: 0, raised: 0, openSelections: 1 }]

function stub() {
  const calls: { m: string; url: string; body?: any }[] = []
  const real = { get: api.get, post: api.post, put: api.put }
  api.get = async (url: string) => {
    calls.push({ m: 'GET', url })
    if (url.endsWith('/summary')) return { total: 3, pending: 2, overdue: 0, totalAllowance: 4150, totalSelected: 900, netDifference: 0 }
    if (url.endsWith('/allowances')) return { data: ALLOWANCES }
    if (url.startsWith('/api/selections/project/')) return { data: SELECTIONS }
    return { data: [] }
  }
  api.post = async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return {} }
  api.put = async (url: string, body?: any) => { calls.push({ m: 'PUT', url, body }); return {} }
  return { calls, undo: () => Object.assign(api, real) }
}
async function mount(node: any, features: string[], permissions = ['selections:read', 'selections:create', 'selections:update', 'selections:delete']) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, null, h(PermissionsProvider, { role: 'manager', permissions }, node)))))) })
  await settle()
  return root
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }
const setSelect = async (el: any, value: string) => { await act(async () => { el.value = value; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }

describe('the Selections page', () => {
  test('on: the panel shows where the allowance stands, a selection under it says so, and a new one is made with the ticked selections', async () => {
    const s = stub()
    try {
      const root = await mount(h(SelectionsPage, { projectId: 'p1' }), ['selections', 'shared_allowances'])
      expect(s.calls.some((c) => c.url === '/api/selections/project/p1/allowances')).toBe(true)
      const panel = document.querySelector('[data-testid="shared-allowances"]') as any
      expect(panel.textContent).toContain('Plumbing fixtures')
      expect(panel.textContent).toMatch(/\$900\.00 chosen of \$4,000\.00/)
      expect(panel.textContent).toContain('1 still to approve')
      expect(text()).toMatch(/Under Plumbing fixtures: \$3,100\.00 of \$4,000\.00 left/)
      expect(text()).toMatch(/Allowance: \$150\.00/) // the mirror is on its own allowance

      // put the mirror under it
      await setSelect(panel.querySelector('select[aria-label="Add a selection to Plumbing fixtures"]'), 's3')
      expect(s.calls.find((c) => c.m === 'PUT')).toMatchObject({ url: '/api/selections/s3/allowance', body: { allowanceId: 'a1' } })

      await click(button('New shared allowance'))
      const inputs = [...document.querySelectorAll('[data-testid="shared-allowances"] input')] as any[]
      await setInput(inputs[0], 'Lighting')
      await setInput(inputs[1], '1200')
      // only selections still open can be ticked: the approved faucet is not offered
      const ticks = inputs.filter((i) => i.type === 'checkbox')
      expect(ticks.map((t) => t.parentElement.textContent)).toEqual(['Tub', 'Mirror'])
      await click(ticks[1])
      await click(button('Save allowance'))
      expect(s.calls.find((c) => c.m === 'POST')).toMatchObject({ url: '/api/selections/project/p1/allowances', body: { name: 'Lighting', amount: 1200, selectionIds: ['s3'] } })
      root.unmount()
    } finally { s.undo() }
  })

  test('a seat that may only read sees where it stands, and no controls', async () => {
    const s = stub()
    try {
      const root = await mount(h(SelectionsPage, { projectId: 'p1' }), ['selections', 'shared_allowances'], ['selections:read'])
      const panel = document.querySelector('[data-testid="shared-allowances"]') as any
      expect(panel.textContent).toContain('Plumbing fixtures')
      expect(button('New shared allowance')).toBeUndefined()
      expect(panel.querySelector('select')).toBeNull()
      expect([...panel.querySelectorAll('button')].map((b: any) => b.textContent.trim())).toEqual([])
      root.unmount()
    } finally { s.undo() }
  })

  test('off: no panel, and the allowances are not asked for', async () => {
    const s = stub()
    try {
      const root = await mount(h(SelectionsPage, { projectId: 'p1' }), ['selections'])
      expect(document.querySelector('[data-testid="shared-allowances"]')).toBeNull()
      expect(s.calls.some((c) => c.url.endsWith('/allowances'))).toBe(false)
      root.unmount()
    } finally { s.undo() }
  })
})

describe('the project budget', () => {
  const BUDGET = { projectName: 'Bath', lines: [{ costCode: '15-Plumbing', estimatedCost: 3000, estimatedPrice: 4000, uncostedLines: 0 }], totalCost: 3000, totalPrice: 4000, uncostedLines: 0, actualCost: 0, remainingCost: 3000, jobCount: 0 }
  const fake = (budget: any) => ({ get: async (url: string) => url === '/api/projects?limit=200' || url.startsWith('/api/projects') ? { data: [{ id: 'p1', name: 'Bath' }] } : budget })
  test('shows the revised side when the server sends it, and not otherwise', async () => {
    let root = await mount(h(ProjectBudgets, { api: fake({ ...BUDGET, revisions: [{ costCode: '15-Plumbing', costChange: 600, priceChange: 800, uncostedSelections: 0 }, { costCode: 'Change orders', costChange: 0, priceChange: 300, uncostedSelections: 0 }], revisedTotalCost: 3600, revisedTotalPrice: 5100 }) }), [])
    const pick = document.querySelector('select') as any
    if (pick) await setSelect(pick, 'p1')
    const rev = document.querySelector('[data-testid="revised-budget"]') as any
    expect(rev).toBeTruthy()
    expect(rev.textContent).toMatch(/15-Plumbing\+\$600\.00\+\$800\.00/)
    expect(rev.textContent).toMatch(/Revised cost\$3,600\.00/)
    expect(rev.textContent).toMatch(/Revised price\$5,100\.00/)
    root.unmount()
    root = await mount(h(ProjectBudgets, { api: fake(BUDGET) }), [])
    const pick2 = document.querySelector('select') as any
    if (pick2) await setSelect(pick2, 'p1')
    expect(document.querySelector('[data-testid="revised-budget"]')).toBeNull()
    expect(text()).toContain('15-Plumbing')
    root.unmount()
  })
})
