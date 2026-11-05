// The owner's "needs you today" and the crew member's "my day" panels, the screens (contractor parity item 5). Server half:
// owner-crew-dashboards.test.ts. happy-dom, not a headless browser: it renders the React and reads the text; it lays nothing out
// and runs no CSS.
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
const { api: webApi } = await import('../web/src/shared.ts') as any
const { OwnerDashboard, CrewDashboard } = await import('../web/src/crm/pages/HomePanels.tsx') as any
const h = React.createElement as any

const OWNER = {
  attention: [
    { id: 'quotes_waiting', label: 'Quotes with no answer for 7 days or more', count: 2, amount: 3000, href: '/crm/quotes' },
    { id: 'bills_due', label: 'Bills past due or due in the next 7 days', count: 0, amount: 0, href: '/crm/bills' },
    { id: 'over_budget', label: 'Projects over their budget', count: 1, amount: 150, detail: ['Kitchen remodel'], href: '/crm/projects' },
  ],
  crewToday: [
    { person: { id: 'u1', name: 'Carl Crew' }, jobs: [{ id: 'j1', number: 'JOB-1', title: 'Frame garage', status: 'in_progress', scheduledTime: '08:00' }] },
    { person: null, jobs: [{ id: 'j2', number: 'JOB-2', title: 'Paint trim', status: 'scheduled', scheduledTime: null }] },
  ],
}
const CREW = {
  today: [{ id: 'j1', number: 'JOB-1', title: 'Frame garage', status: 'in_progress', scheduledTime: '07:30', address: '12 Elm St', city: 'Eau Claire', customer: 'Ann Able' }],
  next: [{ id: 'j3', number: 'JOB-3', title: 'Hang drywall', status: 'scheduled', scheduledTime: null, address: null, city: null, customer: null, day: '2026-11-03' }],
  nextCount: 3, hours: { today: 2, week: 11.5 }, tasks: { open: 2, next: [{ id: 't1', title: 'Order trim' }, { id: 't2', title: 'Call inspector' }] },
}

const text = () => document.body.textContent || ''
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const q = (sel: string) => [...document.querySelectorAll(sel)] as any[]
const auth = (features: string[], granted: string[]) => ({ user: { id: 'u1', role: 'owner' }, company: {}, can: (p: string) => granted.includes(p), hasFeature: (f: string) => features.includes(f) })
async function mount(features: string[], granted: string[], node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(h(MemoryRouter, null, h(AuthContext.Provider, { value: auth(features, granted) }, node))) })
  await settle()
  return root
}
const asks = () => { const calls: string[] = []; return { calls, get: async (u: string) => { calls.push(u); return u === '/api/owner-dashboard' ? OWNER : CREW } } }

describe('the owner\'s panel', () => {
  test('lists what needs attention (leaving out what is at zero) with its money and links, and who is on which job', async () => {
    const a = asks(); webApi.get = a.get
    const root = await mount(['owner_dashboard'], ['dashboard:read', 'jobs:read-all'], h(OwnerDashboard))
    expect(a.calls).toEqual(['/api/owner-dashboard'])
    expect(q('[data-attention]').map((li) => li.getAttribute('data-attention'))).toEqual(['quotes_waiting', 'over_budget'])
    const quotes = q('[data-attention="quotes_waiting"]')[0]
    expect(quotes.textContent).toContain('2 — Quotes with no answer for 7 days or more'); expect(quotes.textContent).toContain('$3,000')
    expect(quotes.querySelector('a').getAttribute('href')).toBe('/crm/quotes')
    expect(q('[data-attention="over_budget"]')[0].textContent).toContain('Kitchen remodel')
    const people = q('[data-person]')
    expect(people.map((p) => p.getAttribute('data-person'))).toEqual(['u1', 'nobody'])
    expect(people[0].textContent).toContain('Carl Crew'); expect(people[0].textContent).toContain('JOB-1 · Frame garage'); expect(people[0].textContent).toContain('08:00')
    expect(people[1].textContent).toContain('Nobody yet'); expect(people[1].textContent).toContain('JOB-2 · Paint trim')
    act(() => root.unmount())
  }, 30_000)

  test('says so when nothing is waiting, and when no job is scheduled today', async () => {
    webApi.get = async () => ({ attention: [{ id: 'quotes_waiting', label: 'x', count: 0, href: '/' }], crewToday: [] })
    const root = await mount(['owner_dashboard'], ['dashboard:read', 'jobs:read-all'], h(OwnerDashboard))
    expect(text()).toContain('Nothing is waiting on you.'); expect(text()).toContain('No jobs are scheduled for today.')
    act(() => root.unmount())
  }, 30_000)

  test('renders nothing, and asks the server nothing, without the feature, without jobs:read-all, or without dashboard:read', async () => {
    for (const [features, granted] of [[[], ['dashboard:read', 'jobs:read-all']], [['owner_dashboard'], ['dashboard:read']], [['owner_dashboard'], ['jobs:read-all']]] as const) {
      const a = asks(); webApi.get = a.get
      const root = await mount([...features], [...granted], h(OwnerDashboard))
      expect(q('[data-testid="owner-dashboard"]')).toHaveLength(0)
      expect(a.calls).toEqual([])
      act(() => root.unmount())
    }
  }, 30_000)
})

describe('the crew member\'s panel', () => {
  test('shows my jobs today with where to go, what is coming, my hours and my tasks', async () => {
    const a = asks(); webApi.get = a.get
    const root = await mount(['crew_dashboard', 'tech_mobile_view'], ['jobs:read'], h(CrewDashboard))
    expect(a.calls).toEqual(['/api/crew-dashboard'])
    const today = q('[data-testid="crew-today-jobs"] [data-job]')
    expect(today.map((j) => j.getAttribute('data-job'))).toEqual(['j1'])
    for (const needle of ['JOB-1 · Frame garage', '07:30', 'Ann Able', '12 Elm St, Eau Claire']) expect(today[0].textContent).toContain(needle)
    expect(today[0].querySelector('a').getAttribute('href')).toBe('/crm/jobs/j1')
    const next = q('[data-testid="crew-next-jobs"]')[0]
    expect(next.textContent).toContain('JOB-3 · Hang drywall'); expect(next.textContent).toContain('2026-11-03'); expect(next.textContent).toContain('and 2 more this week.')
    expect(q('[data-testid="crew-hours"]')[0].textContent).toContain('2 today, 11.5 this week')
    expect(q('[data-testid="crew-tasks"]')[0].textContent).toContain('2 open tasks: Order trim, Call inspector')
    expect(q('a').some((x) => x.getAttribute('href') === '/crm/tech')).toBe(true)
    act(() => root.unmount())
  }, 30_000)

  test('an empty day says so; hours, tasks and the Field View link are absent where the server sent none or the feature is off', async () => {
    webApi.get = async () => ({ today: [], next: [], nextCount: 0 })
    const root = await mount(['crew_dashboard'], ['jobs:read'], h(CrewDashboard))
    expect(text()).toContain('You have nothing scheduled today.')
    expect(q('[data-testid="crew-hours"]')).toHaveLength(0); expect(q('[data-testid="crew-tasks"]')).toHaveLength(0); expect(q('[data-testid="crew-next-jobs"]')).toHaveLength(0)
    expect(q('a')).toHaveLength(0)
    act(() => root.unmount())
  }, 30_000)

  test('renders nothing, and asks the server nothing, without the feature, without jobs:read, or for a seat that reads every job (the office has the owner\'s panel)', async () => {
    for (const [features, granted] of [[[], ['jobs:read']], [['crew_dashboard'], []], [['crew_dashboard'], ['jobs:read', 'jobs:read-all']]] as const) {
      const a = asks(); webApi.get = a.get
      const root = await mount([...features], [...granted], h(CrewDashboard))
      expect(q('[data-testid="crew-dashboard"]')).toHaveLength(0)
      expect(a.calls).toEqual([])
      act(() => root.unmount())
    }
  }, 30_000)
})
