// The Lead Inbox's Lost and site-visit controls, the pipeline strip, and the quotes awaiting a reply — the screens (contractor
// parity item 4). Server half: lead-pipeline.test.ts. happy-dom, not a headless browser: it renders the React and reads the
// text; it lays nothing out and runs no CSS.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/leads' })
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
const { LeadInboxPage } = await import(P + 'leads/LeadInboxPage.tsx') as any
const { setCompanyTimeZone } = await import(P + 'time/companyClock.ts') as any
const { api: webApi } = await import('../web/src/shared.ts') as any
const { LeadPipelineStrip, QuotesAwaitingReply } = await import('../web/src/crm/pages/LeadPipelineStrip.tsx') as any
const h = React.createElement as any

const REASONS = [{ id: 'price', label: 'Our price was too high' }, { id: 'other', label: 'Something else (say what)' }]
const LEADS = [
  { id: 'l1', sourcePlatform: 'website', homeownerName: 'Ann Able', status: 'new', receivedAt: new Date().toISOString(), phone: '715-555-0100' },
  { id: 'l2', sourcePlatform: 'website', homeownerName: 'Bob Baker', status: 'lost', lostReason: 'price', lostNote: 'Cheaper bid', lostAt: new Date().toISOString(), receivedAt: new Date().toISOString() },
  { id: 'l3', sourcePlatform: 'website', homeownerName: 'Cy Cole', status: 'contacted', siteVisitAt: '2026-11-11T01:30:00.000Z', receivedAt: new Date().toISOString() },
]

function fakeApi() {
  const calls: Array<[string, string, any?]> = []
  const api = {
    get: async (url: string) => {
      calls.push(['get', url])
      if (url === '/api/leads') return { data: LEADS, pagination: { page: 1, pages: 1, limit: 25, total: LEADS.length } }
      if (url === '/api/lead-lost/reasons') return { data: REASONS }
      return { stats: [], totals: { total: 0, new: 0, contacted: 0, converted: 0, dismissed: 0 } }
    },
    post: async (url: string, body?: any) => { calls.push(['post', url, body]); return {} },
    put: async (url: string, body?: any) => { calls.push(['put', url, body]); return {} },
    delete: async (url: string, id?: string) => { calls.push(['delete', url, id]); return {} },
  }
  return { api, calls }
}
const toast = { success() {}, error() {}, info() {} }
const text = () => document.body.textContent || ''
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const q = (sel: string) => [...document.querySelectorAll(sel)] as any[]
const btn = (label: string) => q('button').find((b) => b.textContent.trim() === label)
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const setValue = async (el: any, value: string) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new win.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  await settle()
}
const auth = (features: string[], granted: string[] | 'all' = 'all') => ({
  user: { id: 'u1', role: 'owner' }, company: {}, can: (p: string) => granted === 'all' || granted.includes(p), hasFeature: (f: string) => features.includes(f),
})
async function mount(node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(node) })
  await settle()
  return root
}
const inbox = (api: any, config: any, perms: string[]) =>
  h(MemoryRouter, null, h(PermissionsProvider, { role: 'manager', permissions: perms }, h(LeadInboxPage, { api, toast, config: { ownPermission: true, ...config } })))
const open = async (name: string) => { await click(q('div').find((d) => d.style?.cursor === 'pointer' && d.textContent.includes(name))) }
const ALL = ['leads:read', 'leads:update', 'contacts:create', 'schedule:create', 'schedule:update']

describe('Lost, on the Lead Inbox', () => {
  test('with lost on: a Lost filter, and on a new enquiry a Lost button that asks for a reason before it sends one', async () => {
    const f = fakeApi()
    const root = await mount(inbox(f.api, { lost: true }, ALL))
    expect(q('select option').map((o) => o.textContent)).toContain('Lost')
    await open('Ann Able')
    await click(btn('Lost'))
    expect(btn('Mark lost').disabled).toBe(true)
    await setValue(q('select[aria-label="Reason"]')[0], 'price')
    expect(btn('Mark lost').disabled).toBe(false)
    await click(btn('Mark lost'))
    expect(f.calls.filter((c) => c[0] === 'post')).toEqual([['post', '/api/lead-lost/l1', { reason: 'price' }]])
    act(() => root.unmount())
  }, 30_000)

  test('"Something else" needs a note before Mark lost is allowed, and the note is sent', async () => {
    const f = fakeApi()
    const root = await mount(inbox(f.api, { lost: true }, ALL))
    await open('Ann Able')
    await click(btn('Lost'))
    await setValue(q('select[aria-label="Reason"]')[0], 'other')
    expect(btn('Mark lost').disabled).toBe(true)
    await setValue(q('input[aria-label="Note"]')[0], 'Moved away')
    await click(btn('Mark lost'))
    expect(f.calls.find((c) => c[0] === 'post')).toEqual(['post', '/api/lead-lost/l1', { reason: 'other', note: 'Moved away' }])
    act(() => root.unmount())
  }, 30_000)

  test('a lost enquiry shows why, offers Reopen (not Convert, Dismiss or Lost), and Reopen calls the lost route', async () => {
    const f = fakeApi()
    const root = await mount(inbox(f.api, { lost: true }, ALL))
    await open('Bob Baker')
    expect(q('[data-testid="lead-lost-reason"]')[0].textContent).toContain('Our price was too high')
    expect(q('[data-testid="lead-lost-reason"]')[0].textContent).toContain('Cheaper bid')
    expect(btn('Convert to Contact')).toBeUndefined()
    expect(btn('Dismiss')).toBeUndefined()
    expect(btn('Lost')).toBeUndefined()
    await click(btn('Reopen'))
    expect(f.calls.filter((c) => c[0] === 'delete')).toEqual([['delete', '/api/lead-lost', 'l2']])
    act(() => root.unmount())
  }, 30_000)

  test('without the feature, or without leads:update: no Lost button, no Lost filter', async () => {
    for (const [config, perms] of [[{}, ALL], [{ lost: true }, ['leads:read']]] as const) {
      const f = fakeApi()
      const root = await mount(inbox(f.api, { ...config }, [...perms]))
      await open('Ann Able')
      expect(btn('Lost')).toBeUndefined()
      if (!(config as any).lost) expect(q('select option').map((o) => o.textContent)).not.toContain('Lost')
      act(() => root.unmount())
    }
  }, 30_000)
})

describe('Site visits, on the Lead Inbox', () => {
  test('Book site visit sends the day and time on the COMPANY\'s clock, with the length and notes', async () => {
    setCompanyTimeZone('Pacific/Honolulu')
    const f = fakeApi()
    const root = await mount(inbox(f.api, { siteVisit: true }, ALL))
    await open('Ann Able')
    await click(btn('Book site visit'))
    expect(btn('Book visit').disabled).toBe(true)
    await setValue(q('input[type="datetime-local"]')[0], '2026-11-10T15:30')
    await setValue(q('input[aria-label="Length in minutes"]')[0], '90')
    await setValue(q('input[aria-label="Visit notes"]')[0], 'Bring the tape')
    await click(btn('Book visit'))
    // 3:30pm in Honolulu on 10 Nov (UTC−10) is 01:30 UTC on the 11th — not the browser's zone (these tests run on Chicago's).
    expect(f.calls.find((c) => c[0] === 'post')).toEqual(['post', '/api/lead-site-visit/l1', { start: '2026-11-11T01:30:00.000Z', minutes: 90, notes: 'Bring the tape' }])
    act(() => root.unmount())
    setCompanyTimeZone(undefined)
  }, 30_000)

  test('an enquiry with a visit shows it, offers Move and Cancel, and Cancel calls the visit route', async () => {
    setCompanyTimeZone('Pacific/Honolulu')
    const f = fakeApi()
    const root = await mount(inbox(f.api, { siteVisit: true }, ALL))
    await open('Cy Cole')
    expect(q('[data-testid="lead-site-visit"]')[0].textContent).toContain('Nov 10'); expect(q('[data-testid="lead-site-visit"]')[0].textContent).toContain('3:30 PM')
    expect(btn('Book site visit')).toBeUndefined()
    expect(btn('Move site visit')).toBeTruthy()
    await click(btn('Cancel site visit'))
    expect(f.calls.filter((c) => c[0] === 'delete')).toEqual([['delete', '/api/lead-site-visit', 'l3']])
    act(() => root.unmount())
    setCompanyTimeZone(undefined)
  }, 30_000)

  test('needs schedule:create to book and schedule:update to cancel, as the server does; nothing without the feature', async () => {
    const cases: Array<[any, string[], string | undefined, string | undefined]> = [
      [{ siteVisit: true }, ['leads:read', 'leads:update'], undefined, undefined],
      [{ siteVisit: true }, ['leads:read', 'leads:update', 'schedule:create'], 'Book site visit', undefined],
      [{ siteVisit: true }, ['leads:read', 'schedule:create', 'schedule:update'], undefined, undefined],
      [{}, ALL, undefined, undefined],
    ]
    for (const [config, perms, book] of cases) {
      const f = fakeApi()
      const root = await mount(inbox(f.api, config, perms))
      await open('Ann Able')
      expect(!!btn('Book site visit')).toBe(!!book)
      act(() => root.unmount())
    }
    const f = fakeApi()
    const root = await mount(inbox(f.api, { siteVisit: true }, ['leads:read', 'leads:update', 'schedule:create']))
    await open('Cy Cole')
    expect(btn('Cancel site visit')).toBeUndefined() // no schedule:update
    act(() => root.unmount())
  }, 30_000)
})

const withAuth = (features: string[], granted: string[] | 'all', node: any) => h(MemoryRouter, null, h(AuthContext.Provider, { value: auth(features, granted) }, node))
const STAGES = [
  { id: 'new', label: 'New', count: 3 }, { id: 'contacted', label: 'Contacted', count: 2 }, { id: 'site_visit', label: 'Site visit booked', count: 1 },
  { id: 'quotes_out', label: 'Quotes out', count: 4, value: 12500 }, { id: 'won', label: 'Won', count: 2, value: 8000 }, { id: 'lost', label: 'Lost', count: 1 },
]
const WAITING = [
  { id: 'q2', number: 'Q-2', name: 'Deck', status: 'viewed', total: 2000, contactName: 'Ann Able', daysWaiting: 9, viewed: true, followUpsSent: 2, expired: false },
  { id: 'q1', number: 'Q-1', name: 'Fence', status: 'sent', total: 1000, contactName: null, daysWaiting: 0, viewed: false, followUpsSent: 0, expired: true },
]

describe('the pipeline strip', () => {
  test('shows each step with its count, and money on the quote steps', async () => {
    const calls: string[] = []
    webApi.get = async (u: string) => { calls.push(u); return { stages: STAGES, days: 30 } }
    const root = await mount(withAuth(['lead_pipeline'], 'all', h(LeadPipelineStrip)))
    expect(calls).toEqual(['/api/lead-pipeline'])
    const steps = q('[data-stage]').map((li) => [li.getAttribute('data-stage'), li.textContent])
    expect(steps.map((s) => s[0])).toEqual(['new', 'contacted', 'site_visit', 'quotes_out', 'won', 'lost'])
    expect(steps[3][1]).toContain('Quotes out'); expect(steps[3][1]).toContain('4'); expect(steps[3][1]).toContain('$12,500')
    expect(steps[0][1]).not.toContain('$')
    expect(text()).toContain('last 30 days')
    act(() => root.unmount())
  }, 30_000)

  test('renders nothing, and asks the server nothing, without the feature or without leads:read', async () => {
    for (const [features, granted] of [[[], 'all'], [['lead_pipeline'], ['quotes:read']]] as const) {
      const calls: string[] = []
      webApi.get = async (u: string) => { calls.push(u); return { stages: STAGES, days: 30 } }
      const root = await mount(withAuth([...features], granted as any, h(LeadPipelineStrip)))
      expect(q('[data-testid="lead-pipeline-strip"]')).toHaveLength(0)
      expect(calls).toEqual([])
      act(() => root.unmount())
    }
  }, 30_000)
})

describe('quotes awaiting a reply', () => {
  test('lists each quote, longest first as the server sent them, with days, opened or not, nudges and expiry', async () => {
    webApi.get = async () => ({ data: WAITING })
    const root = await mount(withAuth(['lead_pipeline'], 'all', h(QuotesAwaitingReply)))
    const t = q('[data-testid="quotes-awaiting-reply"] li').map((li) => li.textContent)
    expect(text()).toContain('Quotes awaiting a reply — 2, $3,000')
    expect(t[0]).toContain('Q-2 · Ann Able'); expect(t[0]).toContain('waiting 9 days'); expect(t[0]).toContain('opened'); expect(t[0]).toContain('nudged 2×')
    expect(t[1]).toContain('Q-1 · Fence'); expect(t[1]).toContain('sent today'); expect(t[1]).toContain('not opened'); expect(t[1]).toContain('expired')
    expect(q('[data-testid="quotes-awaiting-reply"] a')[0].getAttribute('href')).toBe('/crm/quotes/q2')
    act(() => root.unmount())
  }, 30_000)

  test('says so when every quote has an answer; absent without the feature or quotes:read', async () => {
    webApi.get = async () => ({ data: [] })
    let root = await mount(withAuth(['lead_pipeline'], 'all', h(QuotesAwaitingReply)))
    expect(text()).toContain('Every quote you sent has an answer.')
    act(() => root.unmount())
    for (const [features, granted] of [[[], 'all'], [['lead_pipeline'], ['leads:read']]] as const) {
      root = await mount(withAuth([...features], granted as any, h(QuotesAwaitingReply)))
      expect(q('[data-testid="quotes-awaiting-reply"]')).toHaveLength(0)
      act(() => root.unmount())
    }
  }, 30_000)
})
