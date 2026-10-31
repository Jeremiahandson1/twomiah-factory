// The roofer's material screens, in a DOM (happy-dom: no headless browser here, so none of this has been seen in a real
// browser): the material list builder reads a job's measured lengths and says where they came from, lets the roofer pick which
// report, and takes an EagleView / HOVER / GAF report keyed in.
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
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const MaterialListBuilder = (await import(W + 'crm/pages/roof/field/MaterialListBuilder.tsx') as any).default
const MaterialsPage = (await import(W + 'crm/pages/roof/field/MaterialsPage.tsx') as any).default
const MaterialOrderForm = (await import(W + 'crm/pages/roof/field/MaterialOrderForm.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
const setSelect = async (el: any, value: string) => { await act(async () => { el.value = value; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }

async function mount(node: any, opts: { features?: string[]; permissions?: string[] } = {}) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const features = opts.features ?? ['roof_material_list', 'materials']
  const permissions = opts.permissions ?? ['*']
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(PermissionsProvider, { role: 'manager', permissions }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: ['/crm/jobs/j1'] }, node)))))) })
  await settle()
  return root
}

const LINE = { code: 'shingles', description: 'Shingles', qty: 99, unit: 'bundle', basis: '30 squares × 3 bundles' }
const BUILT = (over: any = {}) => ({
  jobId: 'j1', jobNumber: 'ROOF-1', address: '12 Gable Ln', squares: 30, squaresSource: 'job', orderedSquares: 33,
  lengths: { eaveFt: 150, rakeFt: 100, ridgeFt: 60, valleyFt: 20 }, estimated: [], lines: [LINE], warnings: [], assumptions: { wastePercent: 10, ventType: 'box' },
  lengthSources: { eaveFt: 'roof_report', rakeFt: 'roof_report', ridgeFt: 'roof_report', valleyFt: 'roof_report' },
  lengthsReport: { id: 'r1', kind: 'roof_report', label: 'Roof report, 12 Gable Ln', provider: null, createdAt: '2026-10-01T00:00:00Z' },
  reportChoices: [{ id: 'r1', kind: 'roof_report', label: 'Roof report, 12 Gable Ln', provider: null, createdAt: '2026-10-01T00:00:00Z' }, { id: 'r2', kind: 'provider_report', label: 'EagleView report 4471', provider: 'eagleview', createdAt: '2026-09-01T00:00:00Z' }],
  ...over,
})

function stub(built: (url: string, params: any) => any) {
  const calls: { m: string; url: string; body?: any; params?: any }[] = []
  const real = { get: api.get, post: api.post }
  api.get = async (url: string, params?: any) => {
    calls.push({ m: 'GET', url, params })
    if (url === '/api/material-list/assumptions') return { labels: { wastePercent: { label: 'Waste', unit: '%', help: '' } } }
    return built(url, params)
  }
  api.post = async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return {} }
  return { calls, undo: () => Object.assign(api, real) }
}

describe('the material list builder: measured lengths', () => {
  test('it says the lengths are measured and from which report, offers the job\'s reports, and re-reads the list from the one picked', async () => {
    const s = stub(() => BUILT())
    try {
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }))
      expect(document.querySelector('[data-testid="lengths-source"]')!.textContent).toContain('are measured: Roof report, 12 Gable Ln')
      const sel = document.getElementById('ml-report') as any
      expect([...sel.options].map((o: any) => o.textContent)).toEqual(["The job's newest report", 'Roof report, 12 Gable Ln', 'EagleView report 4471', 'None — estimate from the squares'])
      // Its measured length shows in the box as the figure in use (not as an estimate).
      expect((document.getElementById('ml-eaveFt') as any).placeholder).toBe('150')
      await setSelect(sel, 'r2')
      expect(s.calls.filter((c) => c.m === 'GET' && c.url === '/api/material-list/jobs/j1').pop()!.params.reportId).toBe('r2')
      await setSelect(sel, 'none')
      expect(s.calls.filter((c) => c.m === 'GET' && c.url === '/api/material-list/jobs/j1').pop()!.params.lengthsFrom).toBe('none')
    } finally { s.undo() }
  })

  test('with no report it says the lengths are estimated and offers no picker', async () => {
    const s = stub(() => BUILT({ lengthsReport: null, reportChoices: [], estimated: ['eaveFt'], lengths: { eaveFt: 88, rakeFt: 50, ridgeFt: 30, valleyFt: 0 }, lengthSources: { eaveFt: 'estimated', rakeFt: 'typed', ridgeFt: 'typed', valleyFt: 'none' } }))
    try {
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }))
      expect(text()).toContain('estimated from the squares unless you type them')
      expect(document.getElementById('ml-report')).toBeNull()
      expect((document.getElementById('ml-eaveFt') as any).placeholder).toBe('~88')
    } finally { s.undo() }
  })

  test('a report keyed in from EagleView, HOVER or GAF is posted to the job; a seat that may not measure is not offered it', async () => {
    const s = stub(() => BUILT())
    try {
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }))
      await click(button('I have an EagleView, HOVER or GAF report'))
      await setSelect(document.getElementById('pi-provider'), 'hover')
      await setInput(document.getElementById('pi-number'), '88')
      await setInput(document.getElementById('pi-squares'), '31.5')
      await setInput(document.getElementById('pi-eaveFt'), '160')
      await setInput(document.getElementById('pi-hipFt'), '30')
      await click(button('Add the report to this job'))
      const posted = s.calls.find((c) => c.m === 'POST')!
      expect(posted.url).toBe('/api/material-list/jobs/j1/provider-report')
      expect(posted.body).toEqual({ provider: 'hover', reportNumber: '88', squares: 31.5, eaveFt: 160, rakeFt: 0, ridgeFt: 0, hipFt: 30, valleyFt: 0 })
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }), { permissions: ['inventory:create', 'jobs:read'] })
      expect(button('I have an EagleView, HOVER or GAF report')).toBeUndefined()
    } finally { s.undo() }
  })
})

describe('the order carries its delivery', () => {
  test('the list builder posts the delivery date, PO number, address and point of contact with the order', async () => {
    const s = stub(() => BUILT())
    try {
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }))
      await setInput(document.getElementById('ml-supplier'), 'ABC Supply')
      await setInput(document.getElementById('ml-delivery'), '2026-11-05')
      await setInput(document.getElementById('ml-po'), 'PO-9')
      await setInput(document.getElementById('ml-contact'), 'Sam')
      await setInput(document.getElementById('ml-contact-phone'), '715-555-0188')
      await setInput(document.getElementById('ml-contact-email'), 'sam@crew.example')
      expect((document.getElementById('ml-address') as any).placeholder).toBe('12 Gable Ln')
      await click(button('Create material order'))
      const posted = s.calls.find((c) => c.m === 'POST' && c.url.endsWith('/order'))!
      expect(posted.body).toMatchObject({ supplier: 'ABC Supply', deliveryDate: '2026-11-05', poNumber: 'PO-9', contactName: 'Sam', contactPhone: '715-555-0188', contactEmail: 'sam@crew.example' })
      expect(posted.body.deliveryAddress).toBeUndefined() // left blank: the server uses the job's address
    } finally { s.undo() }
  })

  test('the plain order form posts them too', async () => {
    const s = stub(() => ({ data: [] }))
    try {
      await mount(h(MaterialOrderForm, { jobId: 'j1', jobAddress: '12 Gable Ln', onClose: () => {}, onSaved: () => {} }))
      await setInput(document.getElementById('mo-supplier'), 'ABC Supply')
      await setInput(document.getElementById('mo-po'), 'PO-3')
      await setInput(document.getElementById('mo-contact'), 'Sam')
      await setInput(document.getElementById('mo-contact-email'), 'sam@crew.example')
      await setInput(document.getElementById('mo-desc-0'), 'Shingles')
      await setInput(document.getElementById('mo-qty-0'), '5')
      await click(button('Save order'))
      const posted = s.calls.find((c) => c.m === 'POST')!
      expect(posted.url).toBe('/api/materials')
      expect(posted.body).toMatchObject({ poNumber: 'PO-3', contactName: 'Sam', contactEmail: 'sam@crew.example', deliveryAddress: '12 Gable Ln' })
    } finally { s.undo() }
  })
})

describe('the Materials dashboard', () => {
  const ORDER = { id: 'm1', jobId: 'j1', jobNumber: 'ROOF-0005', supplier: 'abc_supply', status: 'sent', poNumber: 'PO-1001', deliveryAddress: '12 Gable Ln', orderDate: '2026-11-01T00:00:00Z', deliveryDate: '2026-11-05T00:00:00Z', totalCost: '400.00' }
  const page = () => ({ data: [ORDER], pagination: { page: 1, limit: 25, total: 1, pages: 1 } })

  test('Roofr\'s columns are there — status, PO number, job, address, supplier, order date, delivery, amount — and each header sorts on the server', async () => {
    const s = stub(() => page())
    s.calls.length = 0
    try {
      await mount(h(MaterialsPage), { permissions: ['margin:read', 'inventory:read'] })
      const heads = [...document.querySelectorAll('th')].map((th: any) => th.textContent.trim().replace(/[▲▼]/g, '').trim())
      expect(heads).toEqual(['Status', 'PO #', 'Job #', 'Address', 'Supplier', 'Order Date', 'Delivery', 'Amount'])
      const row = document.querySelector('tbody tr')!.textContent!
      for (const want of ['PO-1001', 'ROOF-0005', '12 Gable Ln', 'ABC Supply', '$400']) expect(row).toContain(want)
      const last = () => s.calls.filter((c) => c.url === '/api/materials').pop()!.params
      expect([last().sort, last().dir]).toEqual([undefined, undefined])
      await click(document.querySelector('[data-testid="sort-delivery"]'))
      expect([last().sort, last().dir]).toEqual(['delivery', 'asc'])
      expect(document.querySelector('[data-testid="sort-delivery"]')!.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
      await click(document.querySelector('[data-testid="sort-delivery"]'))
      expect([last().sort, last().dir]).toEqual(['delivery', 'desc'])
      await click(document.querySelector('[data-testid="sort-supplier"]'))
      expect([last().sort, last().dir]).toEqual(['supplier', 'asc'])
      await click(document.querySelector('[data-testid="sort-supplier"]'))
      await click(document.querySelector('[data-testid="sort-supplier"]'))
      expect([last().sort, last().dir]).toEqual([undefined, undefined])
    } finally { s.undo() }
  })

  test('a seat that may not see what the business paid gets no Amount column to sort', async () => {
    const s = stub(() => ({ data: [{ ...ORDER, totalCost: undefined }], pagination: { page: 1, limit: 25, total: 1, pages: 1 } }))
    try {
      await mount(h(MaterialsPage), { permissions: ['inventory:read'] })
      expect([...document.querySelectorAll('th')].map((th: any) => th.textContent.trim().replace(/[▲▼]/g, '').trim())).not.toContain('Amount')
      expect(document.querySelector('[data-testid="sort-amount"]')).toBeNull()
      expect(document.querySelector('[data-testid="sort-status"]')).not.toBeNull() // …but the other headers still sort
    } finally { s.undo() }
  })
})

describe('a list from the signed quote', () => {
  const QUOTE = { id: 'q1', number: 'Q-0012', name: 'Roof', signed: true, signedAt: '2026-10-20T15:00:00Z', lines: [
    { code: 'quote-a', description: 'GAF Timberline HDZ shingles', qty: 99, unit: 'ea', basis: 'Quote Q-0012, material line 1' },
    { code: 'quote-b', description: 'Pipe boots', qty: 4, unit: 'ea', basis: 'Quote Q-0012, material line 2' },
  ] }
  test('the signed quote is offered; using it fills the lines from the quote and the order says where they came from', async () => {
    const s = stub((url) => (url.endsWith('/quote-lines') ? { quotes: [QUOTE] } : BUILT()))
    try {
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }))
      expect(document.querySelector('[data-testid="quote-source"]')!.textContent).toContain('signed quote with material lines')
      await click(button('Use quote Q-0012 (2 lines)'))
      expect(document.querySelector('[data-testid="quote-source"]')!.textContent).toContain('Material list from signed quote Q-0012.')
      expect((document.getElementById('ml-d-0') as any).value).toBe('GAF Timberline HDZ shingles')
      expect((document.getElementById('ml-q-1') as any).value).toBe('4')
      await setInput(document.getElementById('ml-supplier'), 'ABC Supply')
      await click(button('Create material order'))
      const posted = s.calls.find((c) => c.m === 'POST' && c.url.endsWith('/order'))!
      expect(posted.body.sourceNote).toBe('Material list from signed quote Q-0012.')
      expect(posted.body.squares).toBeUndefined()
      expect(posted.body.lines.map((l: any) => l.description)).toEqual(['GAF Timberline HDZ shingles', 'Pipe boots'])
    } finally { s.undo() }
  })

  test('with no signed quote with material lines, nothing is offered', async () => {
    const s = stub((url) => (url.endsWith('/quote-lines') ? { quotes: [{ ...QUOTE, lines: [] }] } : BUILT()))
    try {
      await mount(h(MaterialListBuilder, { jobId: 'j1', onClose: () => {}, onSaved: () => {} }))
      expect(document.querySelector('[data-testid="quote-source"]')).toBeNull()
    } finally { s.undo() }
  })
})
