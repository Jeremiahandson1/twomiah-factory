// The home screens, in a DOM (brief item 2): the strip draws only what the server sent, says in words while it loads,
// and the jobs dashboard shows the overdue figure and today's board for a builder.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/dashboard' })
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
const { MoneyStrip } = await import(P + 'reporting/MoneyStrip.tsx') as any
const { JobsDashboardPage } = await import(P + 'reporting/JobsDashboardPage.tsx') as any
const contractor: any = (await import('../verticals/contractor/settings.ts')).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

async function mount(node: any, features: string[] = ['invoices', 'lead_inbox']) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(MemoryRouter, { initialEntries: ['/crm/dashboard'] }, node))) })
  await settle()
  return root
}
const tile = (id: string) => document.querySelector(`[data-tile=${id}]`)?.textContent

describe('MoneyStrip', () => {
  test('says what it is loading, in words, while the numbers are on the way', async () => {
    const root = await mount(h(MoneyStrip, { api: { get: () => new Promise(() => {}) } }))
    expect(text()).toContain('Loading your numbers…')
    root.unmount()
  })

  test('draws cash in, owed, past due and waiting leads from what the server sent', async () => {
    const api = { get: async () => ({ money: { cashInWeek: 100, cashInMonth: 250.5, owed: 1150, owedCount: 2, overdue: 750, overdueCount: 1 }, leads: { unanswered: 3 } }) }
    const root = await mount(h(MoneyStrip, { api }))
    expect(tile('cashWeek')).toBe('$100.00')
    expect(tile('cashMonth')).toBe('$250.50')
    expect(tile('owed')).toBe('$1,150.00')
    expect(text()).toContain('2 open invoices')
    expect(tile('overdue')).toBe('$750.00')
    expect(tile('leads')).toBe('3')
    root.unmount()
  })

  test('a seat the server sent no money to sees no money tiles — not a $0.00', async () => {
    const root = await mount(h(MoneyStrip, { api: { get: async () => ({ leads: { unanswered: 0 } }) } }))
    expect(tile('cashWeek')).toBeUndefined()
    expect(tile('owed')).toBeUndefined()
    expect(tile('leads')).toBe('0')
    root.unmount()
  })

  test('a page that shows past-due itself can leave that tile out; with nothing to show, nothing is drawn; a failed fetch draws nothing', async () => {
    let root = await mount(h(MoneyStrip, { api: { get: async () => ({ money: { cashInWeek: 0, cashInMonth: 0, owed: 0, owedCount: 0, overdue: 0, overdueCount: 0 } }) }, hide: ['overdue'] }))
    expect(tile('overdue')).toBeUndefined()
    expect(tile('owed')).toBe('$0.00')
    root.unmount()
    root = await mount(h(MoneyStrip, { api: { get: async () => ({}) } }))
    expect(document.querySelector('[data-money-strip]')).toBeNull()
    root.unmount()
    root = await mount(h(MoneyStrip, { api: { get: async () => { throw new Error('no') } } }))
    expect(document.querySelector('[data-money-strip]')).toBeNull()
    root.unmount()
  })
})

describe("a builder's jobs dashboard", () => {
  const stats = {
    newLeads: 1, jobs: { today: 2, dispatchedToday: 1, inProgressToday: 1, completedToday: 0 }, quotes: { pending: 1 },
    invoices: { outstanding: 2, outstandingValue: 1150, overdue: 1, overdueValue: 750 },
  }
  const api = { get: async (url: string) => (url.includes('stats') ? stats : {}) }

  test('shows the overdue figure and the board of today, with the contractor settings', async () => {
    const cfg = contractor.screens.dashboard
    expect(cfg.todayBoard).toBe(true)
    expect(cfg.overdueTile).toBe(true)
    const root = await mount(h(JobsDashboardPage, { api, user: { firstName: 'Olive' }, company: { name: 'Test Builders' }, config: cfg }), ['invoices', 'quotes', 'projects'])
    expect(text()).toContain('Overdue (1)')
    expect(text()).toContain('$750.00')
    expect(text()).toContain("Today's board")
    root.unmount()
  })

  test('a template that sets neither keeps its dashboard as it was', async () => {
    const root = await mount(h(JobsDashboardPage, { api, config: { jobsLabel: 'Jobs' } }), ['invoices', 'quotes', 'projects'])
    expect(text()).not.toContain('Overdue')
    expect(text()).not.toContain("Today's board")
    root.unmount()
  })
})
