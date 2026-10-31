// The Lead Inbox screen, in a DOM (brief item 3): Spam and Not spam, filters labelled with counts, what "New" is made of,
// and Convert-and-start offering only what the trade passes in — then opening that screen with the new contact chosen.
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
const { MemoryRouter, useLocation } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const { LeadInboxPage } = await import(P + 'leads/LeadInboxPage.tsx') as any
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

const row = (id: string, status: string, extra: any = {}) => ({ id, sourcePlatform: 'website', homeownerName: `Lead ${id}`, status, receivedAt: new Date().toISOString(), ...extra })
function fakeApi(rows: any[], extras: any = {}) {
  const calls: { m: string; url: string; body?: any }[] = []
  return {
    calls,
    get: async (url: string) => {
      calls.push({ m: 'GET', url })
      if (url === '/api/leads/stats') return { stats: [], totals: { total: 4, new: 2, contacted: 1, converted: 1, dismissed: 0, spam: 1 }, counts: { new: 2, contacted: 1, converted: 1, dismissed: 0, spam: 1 }, waiting: { total: 5, inbox: 2, contacts: 3 }, ...extras }
      return { data: rows, pagination: { pages: 1 } }
    },
    post: async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return { contact: { id: 'c-new', name: 'Lead' }, matched: false } },
    put: async (url: string, body?: any) => { calls.push({ m: 'PUT', url, body }); return {} },
    delete: async () => ({}),
  }
}
function Where() { return h('span', { 'data-where': '' }, useLocation().pathname + useLocation().search) }

async function mount(api: any, config: any, permissions?: string[]) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const page = h(LeadInboxPage, { api, config, toast: { success: () => {}, error: () => {} } })
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/crm/leads'] }, permissions ? h(PermissionsProvider, { role: 'manager', permissions }, page) : page, h(Where))) })
  await settle()
  return root
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const buttons = () => [...document.querySelectorAll('button')].map((b: any) => b.textContent.trim())
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim().startsWith(label)) as any
const open = async (name: string) => { await click([...document.querySelectorAll('div')].find((d: any) => d.textContent.includes(name) && d.style?.cursor === 'pointer')) }
const where = () => document.querySelector('[data-where]')?.textContent

describe('the inbox', () => {
  test('labels its filters with how many there are, and says what New is made of', async () => {
    const root = await mount(fakeApi([row('1', 'new')]), { ownPermission: true, spam: true })
    const options = [...document.querySelectorAll('option')].map((o: any) => o.textContent)
    expect(options).toContain('New (2)')
    expect(options).toContain('Contacted (1)')
    expect(options).toContain('Spam (1)')
    expect(text()).toContain('5 new leads — 2 enquiries in this inbox and 3 contacts added as leads')
    root.unmount()
  })

  test('without the Spam status (a template) there is no Spam filter, no counts and no explanation', async () => {
    const root = await mount(fakeApi([row('1', 'new')], { counts: undefined, waiting: undefined }), { ownPermission: true })
    const options = [...document.querySelectorAll('option')].map((o: any) => o.textContent)
    expect(options).toContain('New')
    expect(options).not.toContain('Spam')
    expect(text()).not.toContain('new leads —')
    root.unmount()
  })

  test('Spam files an enquiry; on a spam one the button is Not spam, which brings it back to New', async () => {
    const api = fakeApi([row('1', 'new'), row('2', 'spam')])
    const root = await mount(api, { ownPermission: true, spam: true })
    await open('Lead 1')
    await click(button('Spam'))
    expect(api.calls.find((c) => c.m === 'PUT')).toMatchObject({ url: '/api/leads/1/status', body: { status: 'spam' } })
    await open('Lead 2')
    await click(button('Not spam'))
    expect(api.calls.filter((c) => c.m === 'PUT').at(-1)).toMatchObject({ url: '/api/leads/2/status', body: { status: 'new' } })
    root.unmount()
  })

  test('a seat that may not work leads sees neither Spam nor Convert', async () => {
    const root = await mount(fakeApi([row('1', 'new')]), { ownPermission: true, spam: true, startAfterConvert: [{ id: 'job', label: 'Start a job', to: (id: string) => `/crm/jobs?contactId=${id}` }] }, ['leads:read'])
    await open('Lead 1')
    expect(buttons().some((b) => b.startsWith('Spam'))).toBe(false)
    expect(buttons().some((b) => b.startsWith('Convert'))).toBe(false)
    root.unmount()
  })
})

describe('convert and start', () => {
  const start = [
    { id: 'job', label: 'Start a service call', to: (id: string) => `/crm/jobs?contactId=${id}` },
    { id: 'quote', label: 'Start a quote', to: (id: string) => `/crm/quotes?contactId=${id}` },
  ]

  test('offers exactly what the trade passed in, and nothing when it passed nothing', async () => {
    let root = await mount(fakeApi([row('1', 'new')]), { ownPermission: true, spam: true, startAfterConvert: start })
    await open('Lead 1')
    expect(buttons()).toContain('Convert and start a service call')
    expect(buttons()).toContain('Convert and start a quote')
    expect(buttons().some((b) => b.includes('project'))).toBe(false)
    root.unmount()
    root = await mount(fakeApi([row('1', 'new')]), { ownPermission: true, spam: true, startAfterConvert: [] })
    await open('Lead 1')
    expect(buttons().some((b) => b.startsWith('Convert and'))).toBe(false)
    expect(buttons()).toContain('Convert to Contact')
    root.unmount()
  })

  test('one click converts the enquiry and opens that screen with the new contact chosen', async () => {
    const api = fakeApi([row('1', 'new')])
    const root = await mount(api, { ownPermission: true, spam: true, startAfterConvert: start })
    await open('Lead 1')
    await click(button('Convert and start a quote'))
    expect(api.calls.find((c) => c.m === 'POST')).toMatchObject({ url: '/api/leads/1/convert' })
    expect(where()).toBe('/crm/quotes?contactId=c-new')
    root.unmount()
  })

  test('an enquiry already converted goes straight there — no second convert', async () => {
    const api = fakeApi([row('1', 'converted', { convertedContactId: 'c-old' })])
    const root = await mount(api, { ownPermission: true, spam: true, startAfterConvert: start })
    await open('Lead 1')
    await click(button('Start a service call'))
    expect(api.calls.some((c) => c.m === 'POST')).toBe(false)
    expect(where()).toBe('/crm/jobs?contactId=c-old')
    root.unmount()
  })

  test('a spam enquiry offers neither Convert nor Start', async () => {
    const root = await mount(fakeApi([row('1', 'spam')]), { ownPermission: true, spam: true, startAfterConvert: start })
    await open('Lead 1')
    expect(buttons().some((b) => b.startsWith('Convert'))).toBe(false)
    expect(buttons().some((b) => b.startsWith('Start'))).toBe(false)
    root.unmount()
  })
})

// ---------------------------------------------------------------- what each trade offers
import fs from 'node:fs'
import path from 'node:path'
import { getFeaturesForTemplate } from '../../../packages/tenant-backend/src/featureRegistry.ts'
import { leadStarts } from '../web/src/leadStarts.ts'

describe('what each trade can start from a lead', () => {
  const root = path.join(import.meta.dir, '../verticals')
  const all = fs.readdirSync(root).filter((v) => fs.existsSync(path.join(root, v, 'settings.ts')))
  const expected: Record<string, string[]> = {
    contractor: ['job', 'project', 'quote'], basic: ['job', 'quote'], fieldservice: ['job', 'quote'], landscaping: ['job', 'quote'],
    roof: ['quote'], rv: ['quote'], bar: [], restaurant: [], salon: [], vet: [], homecare: [], store: [],
  }
  for (const v of all) {
    test(`${v}: ${(expected[v] || []).join(', ') || 'nothing'}`, async () => {
      const s: any = (await import(path.join(root, v, 'settings.ts'))).default
      const offered = new Set(getFeaturesForTemplate(s.featureSet).map((d) => d.id))
      const starts = leadStarts(s.screens, (f) => offered.has(f), () => true)
      expect(starts.map((x) => x.id)).toEqual(expected[v])
      // Every start is something the trade is actually offered.
      for (const x of starts) expect(x.to('abc')).toContain('contactId=abc')
    })
  }

  test('a feature the business has off, or a permission the seat lacks, takes that start away', () => {
    const screens = { leads: { startWith: ['job', 'project', 'quote'] }, jobs: { labels: { singular: 'Service Call' } } }
    expect(leadStarts(screens, (f) => f !== 'projects', () => true).map((x) => x.id)).toEqual(['job', 'quote'])
    expect(leadStarts(screens, () => true, (p) => p !== 'quotes:create').map((x) => x.id)).toEqual(['job', 'project'])
    expect(leadStarts(screens, () => true, () => true)[0].label).toBe('Start a service call')
  })
})
