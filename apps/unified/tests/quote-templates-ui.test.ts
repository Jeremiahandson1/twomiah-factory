// Quote templates, "create similar" and the follow-up settings, the screens (contractor parity item 2). Server half:
// quote-templates-followup.test.ts. happy-dom, not a headless browser: it renders the React and reads the text; it lays nothing
// out and runs no CSS.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/quotes' })
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
const { QuotesPage } = await import(P + 'invoicing/QuotesPage.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { api: webApi } = await import('../web/src/shared.ts') as any
const QuoteFollowUpPage = (await import('../web/src/crm/pages/QuoteFollowUpPage.tsx') as any).default
const h = React.createElement as any

const QUOTE = {
  id: 'q1', number: 'Q-00001', name: 'Deck rebuild', status: 'sent', contactId: 'c1', projectId: null, total: '1600', taxRate: '5', discount: '0', notes: 'Internal note', terms: 'Net 15',
  depositType: 'percent', depositValue: '10', expiryDate: '2026-12-01T00:00:00.000Z', jobId: 'old-job', contact: { name: 'Ann Able' },
  lineItems: [
    { id: 'l1', description: 'Demo old deck', quantity: '1', unitPrice: '1000', unitCost: '800', markupPct: '25', section: 'Demolition', costCode: '02-Demo', type: 'labor' },
    { id: 'l2', description: 'Composite boards', quantity: '10', unitPrice: '60', section: 'Decking' },
  ],
}
const TEMPLATE_BODY = { name: 'Standard deck', notes: '', terms: 'Net 30', customerMessage: '', taxRate: 5, depositType: null, depositValue: 0, lineItems: [{ description: 'Deck boards', quantity: 20, unitPrice: 60, section: 'Decking' }] }

function fakeApi() {
  const calls: Array<[string, string, any?]> = []
  const api = {
    get: async (url: string) => {
      calls.push(['get', url])
      if (url === '/api/quotes') return { data: [QUOTE], pagination: { total: 1, pages: 1, page: 1, limit: 25 } }
      if (url === '/api/quotes/q1') return QUOTE
      if (url === '/api/quote-templates') return { data: [{ id: 't1', name: 'Standard deck', lineCount: 1, total: 1200 }] }
      if (url === '/api/quote-templates/t1') return { id: 't1', name: 'Standard deck', body: TEMPLATE_BODY }
      if (url === '/api/contacts') return { data: [{ id: 'c1', name: 'Ann Able', type: 'client' }] }
      return { data: [] }
    },
    post: async (url: string, body?: any) => { calls.push(['post', url, body]); return { id: 'new' } },
    put: async (url: string, body?: any) => { calls.push(['put', url, body]); return {} },
    delete: async (url: string, id?: string) => { calls.push(['delete', url, id]); return {} },
  }
  return { api, calls }
}
const toast = { success() {}, error() {}, info() {} }
const text = () => document.body.textContent || ''
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const auth = (features: string[]) => ({ user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) })
async function mount(node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(node) })
  await settle()
  return root
}
const quotesPage = (api: any, features: string[], perms?: string[]) => {
  const page = h(MemoryRouter, null, h(QuotesPage, { api, toast, settings: { defaultTaxRate: 5 } }))
  const withPerms = perms ? h(PermissionsProvider, { role: 'viewer', permissions: perms }, page) : page
  return h(AuthContext.Provider, { value: auth(features) }, withPerms)
}
const click = async (el: any) => { await act(async () => { el.click() }); await settle() }
const byText = (sel: string, label: string) => [...document.querySelectorAll(sel)].find((x: any) => (x.textContent || '').includes(label)) as any
async function openRowMenu() {
  await click(document.querySelector('[data-row-actions]'))
  return [...document.querySelectorAll('[role="menuitem"]')].map((x: any) => (x.textContent || '').trim())
}

describe('Quotes', () => {
  test('with quote_templates: the row offers Create similar and Save as template, and the header offers From a template', async () => {
    const f = fakeApi()
    const root = await mount(quotesPage(f.api, ['quotes', 'quote_templates']))
    expect(text()).toContain('From a template')
    const items = await openRowMenu()
    expect(items).toContain('Create similar'); expect(items).toContain('Save as template')
    act(() => root.unmount())
  })

  test('without the feature, or for a seat that cannot create quotes: none of the three', async () => {
    for (const [features, perms] of [[['quotes'], undefined], [['quotes', 'quote_templates'], ['quotes:read']]] as const) {
      const f = fakeApi()
      const root = await mount(quotesPage(f.api, [...features], perms ? [...perms] : undefined))
      expect(text()).not.toContain('From a template')
      const items = await openRowMenu().catch(() => [] as string[])
      expect(items).not.toContain('Create similar'); expect(items).not.toContain('Save as template')
      act(() => root.unmount())
    }
  })

  test('Create similar fills the New Quote form from the old quote — customer and lines kept, the old job and expiry not — and saves nothing yet', async () => {
    const f = fakeApi()
    const root = await mount(quotesPage(f.api, ['quotes', 'quote_templates']))
    await openRowMenu()
    await click(byText('[role="menuitem"]', 'Create similar'))
    expect(f.calls).toContainEqual(['get', '/api/quotes/q1'])
    expect(f.calls.filter((c) => c[0] === 'post')).toEqual([])
    expect(text()).toContain('New Quote')
    const values = [...document.querySelectorAll('input,textarea')].map((x: any) => x.value)
    expect(values).toContain('Deck rebuild')
    expect(values).toContain('Demo old deck'); expect(values).toContain('Composite boards')
    expect(values.some((v: string) => v.includes('2026-12-01'))).toBe(false)
    act(() => root.unmount())
  })

  test('saving the copy is the ordinary create: one POST /api/quotes with the lines and their cost fields, and no id, number or job from the old quote', async () => {
    const f = fakeApi()
    const root = await mount(quotesPage(f.api, ['quotes', 'quote_templates']))
    await openRowMenu()
    await click(byText('[role="menuitem"]', 'Create similar'))
    await click(byText('button', 'Create') || byText('button', 'Save'))
    const posts = f.calls.filter((c) => c[0] === 'post' && c[1] === '/api/quotes')
    expect(posts.length).toBe(1)
    const body = posts[0][2]
    expect(body.contactId).toBe('c1')
    expect(body.lineItems.map((l: any) => [l.description, l.section, l.costCode, l.markupPct, l.unitCost])).toEqual([['Demo old deck', 'Demolition', '02-Demo', 25, 800], ['Composite boards', 'Decking', undefined, undefined, undefined]])
    expect(JSON.stringify(body)).not.toContain('old-job'); expect(body.id).toBeUndefined(); expect(body.number).toBeUndefined()
    act(() => root.unmount())
  })

  test('From a template lists the templates; Use fills the form with its lines and no customer', async () => {
    const f = fakeApi()
    const root = await mount(quotesPage(f.api, ['quotes', 'quote_templates']))
    await click(byText('button', 'From a template'))
    expect(text()).toContain('Standard deck'); expect(text()).toContain('1 line')
    await click(byText('button', 'Use'))
    expect(f.calls).toContainEqual(['get', '/api/quote-templates/t1'])
    expect(f.calls.filter((c) => c[0] === 'post')).toEqual([])
    const values = [...document.querySelectorAll('input,textarea')].map((x: any) => x.value)
    expect(values).toContain('Deck boards'); expect(values).toContain('Net 30')
    expect((document.querySelector('select') && [...document.querySelectorAll('select')].some((s: any) => s.value === 'c1'))).toBe(false)
    act(() => root.unmount())
  })

  test('Save as template asks for a name and posts the quote id and the name', async () => {
    const f = fakeApi()
    const root = await mount(quotesPage(f.api, ['quotes', 'quote_templates']))
    await openRowMenu()
    await click(byText('[role="menuitem"]', 'Save as template'))
    const name = [...document.querySelectorAll('input')].find((x: any) => x.value === 'Deck rebuild') as any
    expect(name).toBeTruthy()
    await click(byText('button', 'Save template'))
    expect(f.calls).toContainEqual(['post', '/api/quote-templates', { quoteId: 'q1', name: 'Deck rebuild' }])
    act(() => root.unmount())
  })
})

describe('Settings › Quote Follow-up', () => {
  test('shows the rules, and Save sends exactly what is on screen', async () => {
    const calls: any[] = []
    webApi.get = async (u: string) => { calls.push(['get', u]); return { enabled: false, afterDays: [3, 7], sendFromHour: 8 } }
    webApi.put = async (u: string, b: any) => { calls.push(['put', u, b]); return { ...b, sendFromHour: 8 } }
    const root = await mount(h(MemoryRouter, null, h(ToastProvider, null, h(QuoteFollowUpPage))))
    expect(calls).toContainEqual(['get', '/api/quote-followup/settings'])
    expect(text()).toContain('Quote Follow-up'); expect(text()).toContain('from 8am')
    const box = document.querySelector('input[type="checkbox"]') as any
    expect(box.checked).toBe(false)
    await click(box)
    const first = document.querySelector('input[aria-label="Follow-up 1, days after sending"]') as any
    expect(first.value).toBe('3')
    await click(byText('button', 'Save'))
    expect(calls).toContainEqual(['put', '/api/quote-followup/settings', { enabled: true, afterDays: [3, 7] }])
    act(() => root.unmount())
  })
})
