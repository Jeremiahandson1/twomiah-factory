// The "Profit in QuickBooks" card on a roofing job, in a DOM (roofing parity row 5; the server's half is roof-job-books.test.ts): the
// books' income, cost and profit beside this app's, the warning when the customer's books are shared with other jobs, a plain
// sentence when QuickBooks cannot be read (and no figures), and the owner's way to choose the job's own QuickBooks customer.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/jobs/j1' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const W = '../web/src/'
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { api } = await import(W + 'api.ts') as any
const Card = (await import(W + 'crm/pages/roof/jobs/JobBooks.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label)

type Call = { method: string; path: string; body?: any }
async function mountCard(books: any, permissions: string[], extra: Record<string, any> = {}) {
  const calls: Call[] = []
  const real = { get: api.get, put: api.put }
  api.get = async (url: string, params?: any) => {
    calls.push({ method: 'GET', path: url, body: params })
    if (url === '/api/job-books/j1') return typeof books === 'function' ? books() : books
    if (extra[`GET ${url}`]) return extra[`GET ${url}`]
    throw new Error('no route ' + url)
  }
  api.put = async (url: string, body?: any) => { calls.push({ method: 'PUT', path: url, body }); return extra[`PUT ${url}`] ?? {} }
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, hasFeature: () => true }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(PermissionsProvider, { role: 'owner', permissions }, h(ToastProvider, null, h(MemoryRouter, null, h(Card, { jobId: 'j1' })))))) })
  await settle()
  return { root, calls, undo: () => Object.assign(api, real) }
}
const OK = {
  state: 'ok', scope: 'customer', otherJobs: 2, customer: { id: 'C1', name: 'Lee Marsh' }, from: '2026-09-01', to: '2026-10-31',
  income: 10000, costOfGoods: 5000, expenses: 1500, otherNet: 0, cost: 6500, profit: 3500, margin: 35,
  app: { revenue: 10000, cost: 4800, profit: 5200 }, difference: -1700,
}

describe('the Profit in QuickBooks card', () => {
  test('draws the books’ figures beside the app’s, and warns that the customer’s books are shared with other jobs', async () => {
    const { root, undo } = await mountCard(OK, ['reports:read'])
    expect(text()).toContain('Profit in QuickBooks')
    expect(text()).toContain('Lee Marsh')
    expect(text()).toContain('$10,000.00')
    expect(text()).toContain('$5,000.00')
    expect(text()).toContain('$3,500.00')
    expect(text()).toContain('(35%)')
    expect(text()).toContain('Profit in this app, before commissions')
    expect(text()).toContain('$5,200.00')
    expect(text()).toContain('less')
    expect(text()).toContain('2 other jobs for this contact share them')
    // Only a seat that may update reports can choose the customer.
    expect(button('Choose the QuickBooks customer')).toBeUndefined()
    root.unmount(); undo()
  })

  test('when QuickBooks cannot be read it says so in words and draws no figures', async () => {
    const { root, undo } = await mountCard({ state: 'not_connected', message: 'QuickBooks is not connected. Connect it under Settings, Integrations.' }, ['reports:read'])
    expect(text()).toContain('QuickBooks is not connected')
    expect(text()).not.toContain('Income')
    expect(text()).not.toContain('$')
    root.unmount(); undo()
  })

  test('the owner searches QuickBooks, chooses the job’s own customer, and the card reads again', async () => {
    let chosen = false
    const { root, calls, undo } = await mountCard(() => (chosen ? { ...OK, scope: 'job', otherJobs: 0, customer: { id: 'C2', name: 'Lee Marsh - 2 Elm' } } : { state: 'no_customer', message: 'This job is not under a QuickBooks customer yet.' }),
      ['reports:read', 'reports:update'], {
        'GET /api/job-books/customers': { data: [{ id: 'C2', name: 'Lee Marsh - 2 Elm' }] },
        'PUT /api/job-books/j1/customer': { qbCustomerId: 'C2' },
      })
    expect(text()).toContain('not under a QuickBooks customer')
    await click(button('Choose the QuickBooks customer'))
    const input = document.querySelector('input[aria-label="Search QuickBooks customers"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, 'marsh')
      input.dispatchEvent(new win.Event('input', { bubbles: true })); input.dispatchEvent(new win.Event('change', { bubbles: true }))
    })
    await settle()
    await click(button('Search'))
    expect(calls.find((c) => c.path === '/api/job-books/customers')?.body).toEqual({ q: 'marsh' })
    chosen = true
    await click(button('Lee Marsh - 2 Elm'))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/api/job-books/j1/customer', body: { qbCustomerId: 'C2' } })
    expect(text()).toContain('Lee Marsh - 2 Elm')
    expect(text()).not.toContain('share them')
    root.unmount(); undo()
  })
})
