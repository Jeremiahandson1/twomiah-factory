// Roofing parity row 10, the screens in a DOM (the server's half is roof-insurance-supplements.test.ts):
//   · a supplement on the claim page offers the company's own statuses that sit under its fixed status, and saves the choice;
//   · a seat that may not update only reads the status, and nothing is drawn when the company has none;
//   · the follow-ups page draws every claim's supplements in two columns, requested and in progress, with the company's status
//     beside the fixed one and no amount for a seat without the books;
//   · the company's set-up card is there for settings:update only, and adding a status posts it.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/insurance-follow-ups' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const W = '../web/src/'
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const { api } = await import(W + 'api.ts') as any
const Extras = await import(W + 'crm/pages/roof/insurance/InsuranceExtras.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label)
const typeInto = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value)
    el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await settle()
}

type Call = { method: string; path: string; body?: any }
const STATUSES = [
  { id: 's1', name: 'Under review', baseStatus: 'submitted', sortOrder: 0, archived: false, supplements: 1 },
  { id: 's2', name: 'Need more information', baseStatus: 'draft', sortOrder: 1, archived: false, supplements: 0 },
  { id: 's3', name: 'Old status', baseStatus: 'submitted', sortOrder: 2, archived: true, supplements: 0 },
]
const TRACKED = [
  { id: 'a', supplementNumber: 'SUP-001', status: 'draft', column: 'requested', reason: 'Decking', customStatusId: null, customStatus: null, customStatusArchived: false, claimId: 'c1', jobId: 'j1', claimNumber: 'CLM-1', insuranceCompany: 'Buckeye Mutual', address: '1 Oak St', totalAmount: '300.00', daysOpen: 0 },
  { id: 'b', supplementNumber: 'SUP-002', status: 'submitted', column: 'in_progress', reason: 'Flashing', customStatusId: 's1', customStatus: 'Under review', customStatusArchived: false, claimId: 'c2', jobId: 'j2', claimNumber: 'CLM-2', insuranceCompany: 'Lake State', address: '2 Elm St', totalAmount: '800.00', daysOpen: 3 },
]

async function mount(element: any, permissions: string[], routes: Record<string, any> = {}, opts: { hasFeature?: (f: string) => boolean; at?: string } = {}) {
  const calls: Call[] = []
  const real = { get: api.get, post: api.post, put: api.put, delete: api.delete }
  api.get = async (url: string) => { calls.push({ method: 'GET', path: url }); const k = url.split('?')[0]; if (url in routes) return routes[url]; if (k in routes) return routes[k]; throw new Error('no route ' + url) }
  api.post = async (url: string, body?: any) => { calls.push({ method: 'POST', path: url, body }); return routes[`POST ${url}`] ?? {} }
  api.put = async (url: string, body?: any) => { calls.push({ method: 'PUT', path: url, body }); return routes[`PUT ${url}`] ?? {} }
  api.delete = async (url: string) => { calls.push({ method: 'DELETE', path: url }); return {} }
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'manager' }, company: {}, hasFeature: opts.hasFeature ?? (() => true) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(PermissionsProvider, { role: 'manager', permissions }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: [opts.at ?? '/'] }, element)))))) })
  await settle()
  return { root, calls, undo: () => Object.assign(api, real) }
}
const Control = (props: any) => h(Extras.SupplementStatusControl, { supplementId: 'sup1', fixedStatus: 'submitted', customStatusId: null, statuses: STATUSES, onChanged: () => {}, ...props })

describe('the status picker on a supplement of the claim page', () => {
  test('offers only the company’s statuses that sit under the supplement’s fixed status, and saves the choice', async () => {
    const { root, calls, undo } = await mount(h(Control), ['insurance:update'])
    const select = document.querySelector('select[aria-label="Your status for this supplement"]') as HTMLSelectElement
    expect(select).toBeTruthy()
    // Under "submitted": Under review. Not the one under draft, not the archived one.
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['None', 'Under review'])
    await typeInto(select, 's1')
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/insurance-extras/supplements/sup1/custom-status', body: { statusId: 's1' } })
    root.unmount(); undo()
  })

  test('choosing None takes it off; a supplement that carries an archived status still names it', async () => {
    const { root, calls, undo } = await mount(h(Control, { customStatusId: 's3' }), ['insurance:update'])
    const select = document.querySelector('select[aria-label="Your status for this supplement"]') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['None', 'Old status (archived)', 'Under review'])
    expect(select.value).toBe('s3')
    await typeInto(select, '')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ statusId: null })
    root.unmount(); undo()
  })

  test('a seat that may not update only reads it; nothing is drawn when there is none to offer or show', async () => {
    const a = await mount(h(Control, { customStatusId: 's1' }), ['insurance:read'])
    expect(document.querySelector('select')).toBeNull()
    expect(text()).toContain('Under review')
    a.root.unmount(); a.undo()
    const b = await mount(h(Control, { statuses: [] }), ['insurance:update'])
    expect(document.querySelector('[data-testid="supplement-custom-status"]')).toBeNull()
    b.root.unmount(); b.undo()
    const c = await mount(h(Control, { fixedStatus: 'approved' }), ['insurance:update'])
    expect(document.querySelector('[data-testid="supplement-custom-status"]')).toBeNull()
    c.root.unmount(); c.undo()
  })
})

const ROUTES = {
  '/api/insurance-extras/depreciation': { data: [] },
  '/api/insurance-extras/mortgage-checks?open=1': { data: [] },
  '/api/insurance-extras/supplement-statuses': { data: STATUSES },
  '/api/insurance-extras/supplements': { data: TRACKED },
}

describe('the follow-ups page: supplements in two columns', () => {
  test('requested on the left, in progress on the right, each with its claim, the fixed status and the company’s status', async () => {
    const { root, undo } = await mount(h(Extras.default), ['insurance:read', 'invoices:read'], ROUTES)
    const requested = document.querySelector('[data-testid="column-requested"]')!.textContent || ''
    const progress = document.querySelector('[data-testid="column-in_progress"]')!.textContent || ''
    expect(requested).toContain('Requested (1)')
    expect(requested).toContain('SUP-001')
    expect(requested).toContain('1 Oak St')
    expect(requested).toContain('$300.00')
    expect(requested).not.toContain('SUP-002')
    expect(progress).toContain('In progress (1)')
    expect(progress).toContain('SUP-002 · 2 Elm St')
    expect(progress).toContain('Lake State · claim CLM-2 · 3 days')
    expect(progress).toContain('Submitted')
    expect(progress).toContain('Under review')
    expect(text()).toContain('Supplements in progress (2)')
    root.unmount(); undo()
  })

  test('a seat without the books sees the supplements and no amounts', async () => {
    const hidden = TRACKED.map(({ totalAmount: _t, ...r }) => ({ ...r, moneyWithheld: true }))
    const { root, undo } = await mount(h(Extras.default), ['insurance:read'], { ...ROUTES, '/api/insurance-extras/supplements': { data: hidden } })
    expect(text()).toContain('SUP-002')
    expect(text()).not.toContain('$300.00')
    expect(text()).not.toContain('$800.00')
    expect(text()).toContain('hidden')
    root.unmount(); undo()
  })

  test('narrowing to one of the company’s statuses, and asking for the decided ones, re-reads the list with that', async () => {
    const { root, calls, undo } = await mount(h(Extras.default), ['insurance:read'], { ...ROUTES, '/api/insurance-extras/supplements?statusId=s1': { data: [TRACKED[1]] } })
    await typeInto(document.querySelector('select[aria-label="Show one of your statuses"]') as HTMLSelectElement, 's1')
    expect(calls.some((c) => c.path === '/api/insurance-extras/supplements?statusId=s1')).toBe(true)
    expect(document.querySelector('[data-testid="column-requested"]')!.textContent).toContain('Requested (0)')
    root.unmount(); undo()
  })
})

describe('the company’s set-up card', () => {
  test('is there for settings:update only', async () => {
    const without = await mount(h(Extras.default), ['insurance:read'], ROUTES)
    expect(document.querySelector('[data-testid="supplement-status-setup"]')).toBeNull()
    without.root.unmount(); without.undo()
    const withIt = await mount(h(Extras.default), ['insurance:read', 'settings:update'], ROUTES)
    const card = document.querySelector('[data-testid="supplement-status-setup"]')!.textContent || ''
    expect(card).toContain('Your supplement statuses')
    expect(card).toContain('Under review under Submitted · 1 supplement')
    expect(card).toContain('Old status under Submitted · 0 supplements · archived')
    // One carried by a supplement cannot be deleted from here (archive instead); one that is not can.
    expect(document.querySelector('button[aria-label="Delete Under review"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Delete Need more information"]')).toBeTruthy()
    withIt.root.unmount(); withIt.undo()
  })

  test('adding a status posts its name and what it sits under; reordering posts the whole order', async () => {
    const { root, calls, undo } = await mount(h(Extras.default), ['insurance:read', 'settings:update'], ROUTES)
    const name = document.querySelector('input[placeholder="Under review"]') as HTMLInputElement
    await typeInto(name, 'Pending re-inspection')
    const sits = Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.textContent === 'Denied')) as HTMLSelectElement
    await typeInto(sits, 'submitted')
    await click(button('Add status'))
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/insurance-extras/supplement-statuses', body: { name: 'Pending re-inspection', baseStatus: 'submitted' } })
    await click(document.querySelector('button[aria-label="Move Under review down"]'))
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: '/api/insurance-extras/supplement-statuses/order', body: { ids: ['s2', 's1', 's3'] } })
    root.unmount(); undo()
  })
})

describe('the claim page', () => {
  const CLAIM = { id: 'c1', jobId: 'j1', claimNumber: 'CLM-1', insuranceCompany: 'Buckeye Mutual', claimStatus: 'filed' }
  const SUPS = [
    { id: 'sup-sub', supplementNumber: 'SUP-001', status: 'submitted', reason: 'Decking', lineItems: [], totalAmount: '500.00', customStatusId: 's1' },
    { id: 'sup-draft', supplementNumber: 'SUP-002', status: 'draft', reason: 'Flashing', lineItems: [], totalAmount: '200.00', customStatusId: null },
  ]
  const routes = {
    '/api/insurance/claims/j1': CLAIM,
    '/api/insurance/claims/c1/activity': { data: [], pagination: {} },
    '/api/insurance/claims/c1/supplements': { data: SUPS, pagination: {} },
    '/api/insurance-extras/claims/c1/depreciation': { state: 'none_held' },
    '/api/insurance-extras/mortgage-checks?claimId=c1': { data: [] },
    '/api/insurance-extras/supplement-statuses': { data: STATUSES },
  }
  const page = async (hasFeature: (f: string) => boolean) => {
    const Claim = (await import(W + 'crm/pages/roof/insurance/InsuranceClaimPage.tsx') as any).default
    return mount(h(Routes, null, h(Route, { path: '/crm/jobs/:id/insurance', element: h(Claim) })), ['insurance:read', 'insurance:create', 'insurance:update'], routes, { hasFeature, at: '/crm/jobs/j1/insurance' })
  }

  test('each supplement offers the company’s statuses for its fixed status, with Insurance Follow-ups on', async () => {
    const { root, calls, undo } = await page(() => true)
    const selects = Array.from(document.querySelectorAll('select[aria-label="Your status for this supplement"]')) as HTMLSelectElement[]
    expect(selects).toHaveLength(2)
    // The submitted one carries "Under review"; the draft one is offered the status that sits under draft.
    expect(selects[0].value).toBe('s1')
    expect(Array.from(selects[1].options).map((o) => o.textContent)).toEqual(['None', 'Need more information'])
    // The fixed four are still drawn and acted on as before.
    expect(text()).toContain('SUP-001')
    expect(text()).toContain('Submit to Carrier')
    expect(calls.some((c) => c.path === '/api/insurance-extras/supplement-statuses')).toBe(true)
    root.unmount(); undo()
  })

  test('with Insurance Follow-ups off, nothing about company statuses is drawn or asked for', async () => {
    const { root, calls, undo } = await page((f) => f !== 'insurance_extras')
    expect(text()).toContain('SUP-001')
    expect(document.querySelector('[data-testid="supplement-custom-status"]')).toBeNull()
    expect(calls.some((c) => c.path.startsWith('/api/insurance-extras'))).toBe(false)
    root.unmount(); undo()
  })
})
