// Roofing parity row 11, the screens in a DOM (the server's half is roof-permits.test.ts):
//   · the fee typed in dollars is sent as whole cents, read from the digits ($0.29 is 29, not 28);
//   · a job's permits card lists the permits with their status and days, adds and moves one, and offers each seat only what it may;
//   · a seat that does not read cost is not shown, and cannot type, a fee;
//   · the board puts every permit in the column of its status, flags the expired, and narrows by status.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/permits' })
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
const model = await import(W + 'crm/pages/roof/jobs/permitModel.ts') as any
const Card = (await import(W + 'crm/pages/roof/jobs/JobPermits.tsx') as any).default
const Board = (await import(W + 'crm/pages/roof/jobs/PermitsPage.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label)
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value)
    el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await settle()
}
const labelled = (label: string) => Array.from(document.querySelectorAll('label')).find((l) => (l.textContent || '').trim().startsWith(label))?.querySelector('input,textarea,select') as HTMLInputElement

type Call = { method: string; path: string; body?: any; params?: any }
async function mount(element: any, permissions: string[], routes: Record<string, any>, opts: { hasFeature?: (f: string) => boolean; at?: string } = {}) {
  const calls: Call[] = []
  const real = { get: api.get, post: api.post, put: api.put, delete: api.delete }
  api.get = async (url: string, params?: any) => { calls.push({ method: 'GET', path: url, params }); if (url in routes) return typeof routes[url] === 'function' ? routes[url]() : routes[url]; throw new Error('no route ' + url) }
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

describe('a fee typed in dollars', () => {
  test('is whole cents, read from the digits', () => {
    const c = model.centsFromText
    expect([c('125'), c('125.5'), c('$1,250.00'), c('0.29'), c('0.1'), c('19.99'), c(' 7 '), c('')]).toEqual([12500, 12550, 125000, 29, 10, 1999, 700, null])
    for (const bad of ['abc', '12.345', '-5', '1e3', '12.', '.5', '99999999']) expect([bad, c(bad)]).toEqual([bad, undefined])
    expect([model.textFromCents(12550), model.textFromCents(29), model.textFromCents(null)]).toEqual(['125.50', '0.29', ''])
  })
})

const PERMITS = [
  { id: 'p1', jobId: 'j1', status: 'issued', permitType: 'Building', jurisdiction: 'City of Eau Claire', permitNumber: '24-0113', feeCents: 12550, feePaidOn: '2026-10-20', appliedOn: '2026-10-21', issuedOn: '2026-11-02', expiresOn: '2027-04-20', expired: false, notes: 'Posted in the window' },
  { id: 'p2', jobId: 'j1', status: 'needed', permitType: 'Electrical', jurisdiction: null, permitNumber: null, feeCents: null, expired: false },
]

describe('the permits card on a job', () => {
  test('lists the permits with status, fee and days, and moves one along', async () => {
    const { root, calls, undo } = await mount(h(Card, { jobId: 'j1' }), ['jobs:read', 'jobs:update', 'jobs:create', 'jobs:delete', 'margin:read'], { '/api/permits': { data: PERMITS } })
    expect(calls[0]).toMatchObject({ path: '/api/permits', params: { jobId: 'j1' } })
    const t = text()
    expect(t).toContain('Building · 24-0113')
    expect(t).toContain('Issued')
    expect(t).toContain('City of Eau Claire')
    expect(t).toContain('fee $125.50 paid 10/20/2026')
    expect(t).toContain('applied 10/21/2026')
    expect(t).toContain('issued 11/2/2026')
    expect(t).toContain('expires 4/20/2027')
    expect(t).toContain('Posted in the window')
    // The next step for each: an issued permit is finaled next, a needed one is applied for.
    await click(button('Mark finaled'))
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/api/permits/p1/status', body: { status: 'finaled' } })
    await click(button('Mark applied for'))
    expect(calls.filter((c) => c.method === 'POST')[1]).toMatchObject({ path: '/api/permits/p2/status', body: { status: 'applied' } })
    root.unmount(); undo()
  })

  test('adding a permit sends the fee as cents and the expiry day; the Save button is off while the fee is not an amount', async () => {
    const { root, calls, undo } = await mount(h(Card, { jobId: 'j1' }), ['jobs:read', 'jobs:update', 'jobs:create', 'margin:read'], { '/api/permits': { data: [] } })
    expect(text()).toContain('No permits on this job.')
    await click(button('Add permit'))
    await typeInto(labelled('Permit type'), 'Re-roof')
    await typeInto(labelled('Issued by'), 'Town of Union')
    await typeInto(labelled('Permit number'), 'R-77')
    await typeInto(labelled('Fee ($)'), '125.5x')
    expect(text()).toContain('Enter dollars and cents')
    expect((button('Save permit') as HTMLButtonElement).disabled).toBe(true)
    await typeInto(labelled('Fee ($)'), '125.50')
    await typeInto(labelled('Expires on'), '2027-05-01')
    await click(button('Save permit'))
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/api/permits', body: { jobId: 'j1', permitType: 'Re-roof', jurisdiction: 'Town of Union', permitNumber: 'R-77', feeCents: 12550, expiresOn: '2027-05-01' },
    })
    root.unmount(); undo()
  })

  test('a seat that does not read cost is shown no fee, offered no fee box, and sends none', async () => {
    const hidden = PERMITS.map(({ feeCents: _f, feePaidOn: _p, ...r }) => ({ ...r, moneyWithheld: true }))
    const { root, calls, undo } = await mount(h(Card, { jobId: 'j1' }), ['jobs:read', 'jobs:update', 'jobs:create'], { '/api/permits': { data: hidden } })
    expect(text()).not.toContain('$125.50')
    expect(text()).not.toContain('fee')
    await click(button('Add permit'))
    expect(labelled('Fee ($)')).toBeUndefined()
    await typeInto(labelled('Permit number'), 'N-1')
    await click(button('Save permit'))
    expect('feeCents' in calls.find((c) => c.method === 'POST')!.body).toBe(false)
    root.unmount(); undo()
  })

  test('offers each seat only what it may: a read-only seat sees the permits and no controls, and no empty card for one with nothing to add', async () => {
    const a = await mount(h(Card, { jobId: 'j1' }), ['jobs:read'], { '/api/permits': { data: PERMITS } })
    expect(text()).toContain('Building · 24-0113')
    for (const label of ['Add permit', 'Mark finaled', 'Mark applied for']) expect([label, button(label)]).toEqual([label, undefined])
    expect(document.querySelector('button[aria-label^="Edit"]')).toBeNull()
    expect(document.querySelector('button[aria-label^="Remove"]')).toBeNull()
    a.root.unmount(); a.undo()
    const b = await mount(h(Card, { jobId: 'j1' }), ['jobs:read'], { '/api/permits': { data: [] } })
    expect(document.querySelector('[data-testid="job-permits"]')).toBeNull()
    b.root.unmount(); b.undo()
  })

  test('removing asks first, then deletes', async () => {
    const { root, calls, undo } = await mount(h(Card, { jobId: 'j1' }), ['jobs:read', 'jobs:delete'], { '/api/permits': { data: [PERMITS[0]] } })
    await click(document.querySelector('button[aria-label="Remove Building"]'))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await click(button('Remove'))
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/api/permits/p1')
    root.unmount(); undo()
  })
})

describe('the permit board', () => {
  const ROWS = [
    { ...PERMITS[0], jobNumber: 'ROOF-1', address: '1 Oak St', homeowner: 'Dana Okafor', expired: true },
    { ...PERMITS[1], jobNumber: 'ROOF-1', address: '1 Oak St', homeowner: 'Dana Okafor' },
    { id: 'p3', jobId: 'j2', status: 'applied', permitType: 'Building', jurisdiction: 'Town of Union', permitNumber: 'U-9', feeCents: 8000, expired: false, appliedOn: '2026-10-30', jobNumber: 'ROOF-2', address: '2 Elm St', homeowner: 'Lee Marsh' },
    { id: 'p4', jobId: 'j3', status: 'rejected', permitType: 'Building', permitNumber: 'R-1', expired: false, jobNumber: 'ROOF-3', address: '3 Pine St', homeowner: null },
  ]
  test('puts each permit in the column of its status, with its job, office and fee, and flags the expired', async () => {
    const { root, undo } = await mount(h(Board), ['jobs:read'], { '/api/permits': { data: ROWS } })
    const col = (s: string) => document.querySelector(`[data-testid="column-${s}"]`)!.textContent || ''
    expect(col('issued')).toContain('Issued (1)')
    expect(col('issued')).toContain('1 Oak St')
    expect(col('issued')).toContain('24-0113')
    expect(col('issued')).toContain('Fee $125.50, paid 10/20/2026')
    expect(col('issued')).toContain('Expired')
    expect(col('needed')).toContain('Needed (1)')
    expect(col('needed')).toContain('Electrical')
    expect(col('applied')).toContain('Applied for (1)')
    expect(col('applied')).toContain('2 Elm St')
    expect(col('applied')).toContain('Town of Union · Lee Marsh')
    expect(col('finaled')).toContain('Finaled (0)')
    expect(col('rejected')).toContain('3 Pine St')
    // A card goes to its job.
    expect(document.querySelector('[data-testid="column-applied"] a')?.getAttribute('href')).toBe('/crm/jobs/j2')
    root.unmount(); undo()
  })

  test('narrows to one status, or to the expired', async () => {
    const { root, undo } = await mount(h(Board), ['jobs:read'], { '/api/permits': { data: ROWS } })
    const select = document.querySelector('select[aria-label="Show permits"]') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['All permits (4)', 'Needed (1)', 'Applied for (1)', 'Issued (1)', 'Finaled (0)', 'Rejected (1)', 'Expired (1)'])
    await typeInto(select, 'applied')
    expect(text()).toContain('2 Elm St')
    expect(text()).not.toContain('1 Oak St')
    await typeInto(select, 'expired')
    expect(text()).toContain('1 Oak St')
    expect(text()).not.toContain('2 Elm St')
    root.unmount(); undo()
  })

  test('a seat without the books’ cost sees the board with no fees; a seat that cannot see jobs is told so; an empty board says how to fill it', async () => {
    const hidden = ROWS.map(({ feeCents: _f, ...r }) => ({ ...r, moneyWithheld: true }))
    const a = await mount(h(Board), ['jobs:read'], { '/api/permits': { data: hidden } })
    expect(text()).toContain('3 Pine St')
    expect(text()).not.toContain('Fee $')
    a.root.unmount(); a.undo()
    const b = await mount(h(Board), ['contacts:read'], {})
    expect(text()).toContain('Permits are for people who can see jobs')
    b.root.unmount(); b.undo()
    const c = await mount(h(Board), ['jobs:read'], { '/api/permits': { data: [] } })
    expect(text()).toContain('No permits yet. Add one from a job’s page')
    c.root.unmount(); c.undo()
  })
})

describe('the job page', () => {
  const JOB = { id: 'j1', number: 'ROOF-1', title: '1 Oak St', address: '1 Oak St', status: 'signed', jobType: 'retail', photos: [], notes: [], quotes: [], invoices: [], contact: { name: 'Dana Okafor' } }
  const routes = { '/api/jobs/j1': JOB, '/api/jobs/j1/timeline': { data: [] }, '/api/crews': { data: [] }, '/api/measurements/job/j1': { data: [] }, '/api/permits': { data: PERMITS } }
  const page = async (hasFeature: (f: string) => boolean) => {
    const Detail = (await import(W + 'crm/pages/roof/jobs/JobDetailPage.tsx') as any).default
    return mount(h(Routes, null, h(Route, { path: '/crm/jobs/:id', element: h(Detail) })), ['jobs:read', 'jobs:update', 'jobs:create', 'margin:read', 'invoices:read'], routes, { hasFeature, at: '/crm/jobs/j1' })
  }
  test('shows the permits card on the job with Permits on, and asks for nothing about permits with it off', async () => {
    const on = await page(() => true)
    expect(document.querySelector('[data-testid="job-permits"]')).not.toBeNull()
    expect(text()).toContain('Building · 24-0113')
    expect(on.calls.some((c) => c.path === '/api/permits' && c.params?.jobId === 'j1')).toBe(true)
    on.root.unmount(); on.undo()
    const off = await page((f) => f !== 'roof_permits')
    expect(text()).toContain('ROOF-1')
    expect(document.querySelector('[data-testid="job-permits"]')).toBeNull()
    expect(off.calls.some((c) => c.path === '/api/permits')).toBe(false)
    off.root.unmount(); off.undo()
  })
})
