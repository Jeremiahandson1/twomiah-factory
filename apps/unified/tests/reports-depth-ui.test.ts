// The Reports page (brief item 8), in a DOM: while it loads it says what is loading over grey cards instead of a lone spinner; with
// the features it adds "Who owes you", "Work in progress" and the job-profit list, each fetching its own numbers; without them, or for
// a seat that cannot read reports, none of the three is drawn or asked for. (happy-dom: no headless browser here.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/reports' })
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
const { ReportsPage } = await import(P + 'reporting/ReportsPage.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

const SUMMARY = { period: '30', revenue: { collected: 1000, invoiced: 2000, outstanding: 1450, overdue: 1300, overdueCount: 4, collectionRate: 50 }, jobs: { total: 2, completed: 1, completionRate: 50 }, projects: { total: 1, active: 1, completed: 0, totalValue: 110000 }, quotes: { total: 1, approved: 1, conversionRate: 100 }, recentActivity: [] }
const AGING = { asOf: '2026-10-30', totals: { current: 150, days1to30: 200, days31to60: 200, days61to90: 500, over90: 400, total: 1450 }, invoiceCount: 6, customers: [{ contactId: 'c1', name: 'Ruiz Family', invoiceCount: 4, current: 100, days1to30: 200, days31to60: 200, days61to90: 0, over90: 400, total: 900 }] }
const WIP = { rows: [{ kind: 'project', id: 'p1', number: 'PRJ-0001', name: 'Ruiz addition', contractValue: 110000, approvedChanges: 10000, contractSource: 'quotes', billed: 35000, costToDate: 20000, percentComplete: 25, percentSource: 'cost', costsMissingOnBudget: false, earned: 27500, overUnder: 7500 }], totals: { contractValue: 110000, billed: 35000, costToDate: 20000, earned: 27500, overUnder: 7500 } }
const PROFIT = { jobs: [{ id: 'j1', number: 'JOB-0001', title: 'Framing', contact: 'Ruiz Family', invoicedRevenue: 10000, totalCost: 6000, profit: 4000, margin: 40 }, { id: 'j2', number: 'JOB-0002', title: 'Deck', contact: 'Lee', invoicedRevenue: 3000, totalCost: 3500, profit: -500, margin: -16.7 }], totals: { invoicedRevenue: 13000, totalCost: 9500, profit: 3500, margin: 26.9 } }

function fakeApi(opts: { hold?: boolean } = {}) {
  const calls: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  const api = {
    get: async (url: string) => {
      calls.push(url)
      if (opts.hold && url === '/api/reports/dashboard') await gate
      if (url === '/api/reports/dashboard') return SUMMARY
      if (url === '/api/receivables/aging') return AGING
      if (url === '/api/wip') return WIP
      if (url === '/api/job-costing/summary') return PROFIT
      return []
    },
  }
  return { api, calls, release }
}
async function mount(api: any, opts: { features?: string[]; can?: (p: string) => boolean } = {}) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const features = opts.features ?? []
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: opts.can ?? (() => true), hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(MemoryRouter, null, h(ReportsPage, { api, config: { jobsLabel: 'Jobs' } })))) })
  return root
}

describe('the Reports page while it loads', () => {
  test('says what is loading over grey cards, then the real page replaces it', async () => {
    const f = fakeApi({ hold: true })
    const root = await mount(f.api)
    await settle()
    const loading = document.querySelector('[data-page-loading]') as any
    expect(loading).toBeTruthy()
    expect(loading.getAttribute('role')).toBe('status')
    expect(text()).toContain('Loading your revenue, what is owed, and the work done')
    expect(document.querySelectorAll('.animate-pulse div').length).toBeGreaterThan(5)      // card-shaped blocks, not one spinner
    expect(text()).toContain('Reports & Analytics')                                         // the title stays
    await act(async () => { f.release() }); await settle()
    expect(document.querySelector('[data-page-loading]')).toBeNull()
    expect(text()).toContain('Revenue collected')
    root.unmount()
  }, 30_000)
})

describe('receivables aging, work in progress and job profit on the Reports page', () => {
  test('with the features: all three cards, with the numbers the server sent', async () => {
    const f = fakeApi()
    const root = await mount(f.api, { features: ['projects', 'ar_aging', 'wip_report', 'job_costing'] })
    await settle()
    const aging = document.querySelector('[data-report="receivables-aging"]') as any
    expect(aging.textContent).toContain('Who owes you')
    expect(aging.textContent).toContain('Ruiz Family')
    expect(aging.textContent).toContain('$1,450')
    for (const label of ['Current', '1–30', '31–60', '61–90', '90+']) expect(aging.textContent).toContain(label)
    const wip = document.querySelector('[data-report="wip"]') as any
    expect(wip.textContent).toContain('Ruiz addition')
    expect(wip.textContent).toContain('25%')
    expect(wip.textContent).toContain('$7,500.00 over')
    expect(wip.textContent).toContain('includes $10,000.00 of approved changes')
    const profit = document.querySelector('[data-report="job-profit"]') as any
    expect(profit.textContent).toContain('Framing')
    expect(profit.textContent.indexOf('Framing')).toBeLessThan(profit.textContent.indexOf('Deck'))   // most profitable first
    expect(profit.textContent).toContain('-16.7%')
    root.unmount()
  }, 30_000)

  test('without the features, or without reports:read, none is drawn and none is asked for', async () => {
    for (const opts of [{ features: [] as string[] }, { features: ['ar_aging', 'wip_report', 'job_costing'], can: (p: string) => p !== 'reports:read' }]) {
      const f = fakeApi()
      const root = await mount(f.api, opts)
      await settle()
      expect(document.querySelector('[data-report]')).toBeNull()
      expect(f.calls.some((c) => c === '/api/receivables/aging' || c === '/api/wip' || c === '/api/job-costing/summary')).toBe(false)
      expect(text()).toContain('Revenue collected')                                           // the page itself is as it was
      root.unmount()
    }
  }, 30_000)

  test('job profit needs Job Costing as well as the WIP feature (it reads that report)', async () => {
    const f = fakeApi()
    const root = await mount(f.api, { features: ['wip_report'] })
    await settle()
    expect(document.querySelector('[data-report="wip"]')).toBeTruthy()
    expect(document.querySelector('[data-report="job-profit"]')).toBeNull()
    expect(f.calls).not.toContain('/api/job-costing/summary')
    root.unmount()
  }, 30_000)
})
