// Default markup by kind of line with live margin, and pictures on quote lines — the screens (contractor parity item 3).
// Server half: markup-images.test.ts. happy-dom, not a headless browser: it renders the React and reads the text; it lays nothing
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
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const { LineItemsEditor } = await import(P + 'invoicing/ui.tsx') as any
const { applyDefaultMarkup, lineMargin, quoteMargin } = await import(P + 'invoicing/markup.ts') as any
const { MarginSummary } = await import(P + 'invoicing/MarginSummary.tsx') as any
const { QuotesPage } = await import(P + 'invoicing/QuotesPage.tsx') as any
const { QuoteDetailPage } = await import(P + 'invoicing/QuoteDetailPage.tsx') as any
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { PortalLinkProvider } = await import(P + 'portal/PortalContext.tsx') as any
const { PortalQuoteDetail } = await import(P + 'portal/PortalQuotes.tsx') as any
const h = React.createElement as any

const DEFAULTS = { labor: 25, material: 20, part: null, service: 15, other: null }
const text = () => document.body.textContent || ''
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const q = (sel: string) => [...document.querySelectorAll(sel)] as any[]
const setValue = async (el: any, value: string) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new win.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  await settle()
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
function Harness({ initial, props, onState }: { initial: any[]; props: any; onState: (x: any[]) => void }) {
  const [items, setItems] = React.useState(initial)
  onState(items)
  return h(LineItemsEditor, { items, onChange: setItems, ...props })
}
async function mountEditor(initial: any[], estimating: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  let state: any[] = initial
  await act(async () => { root.render(h(MemoryRouter, null, h(Harness, { initial, props: { pricebook: { items: [], canSeeCost: true, loaded: true }, estimating }, onState: (x: any[]) => { state = x } }))) })
  await settle()
  return { root, items: () => state }
}
const BLANK = { description: 'Tile', quantity: 1, unitPrice: 0 }

describe('the arithmetic', () => {
  test('a cost and a kind with no price typed take the kind\'s usual markup, and the price it makes', () => {
    const next = applyDefaultMarkup({ ...BLANK }, { ...BLANK, type: 'material', unitCost: 100 }, DEFAULTS)
    expect([next.markupPct, next.unitPrice]).toEqual([20, 120])
  })
  test('nothing is filled in without a cost, without a kind, for a kind with no default, or with no defaults at all', () => {
    expect(applyDefaultMarkup(BLANK, { ...BLANK, type: 'material' }, DEFAULTS).unitPrice).toBe(0)
    expect(applyDefaultMarkup(BLANK, { ...BLANK, unitCost: 100 }, DEFAULTS).unitPrice).toBe(0)
    expect(applyDefaultMarkup(BLANK, { ...BLANK, type: 'part', unitCost: 100 }, DEFAULTS).unitPrice).toBe(0)
    expect(applyDefaultMarkup(BLANK, { ...BLANK, type: 'material', unitCost: 100 }, null).unitPrice).toBe(0)
  })
  test('a price typed by hand, or a markup the person changed, is never overwritten', () => {
    const typed = applyDefaultMarkup(BLANK, { ...BLANK, unitPrice: 99, type: 'material', unitCost: 50 }, DEFAULTS)
    expect(typed.unitPrice).toBe(99); expect(typed.markupPct).toBeUndefined()
    const edited = { ...BLANK, type: 'material', unitCost: 100, markupPct: 40, unitPrice: 140 }
    expect(applyDefaultMarkup(edited, { ...edited, type: 'labor' }, DEFAULTS)).toMatchObject({ markupPct: 40, unitPrice: 140 })
  })
  test('changing the kind on a line still at the old kind\'s usual markup moves it to the new kind\'s', () => {
    const was = { ...BLANK, type: 'material', unitCost: 100, markupPct: 20, unitPrice: 120 }
    expect(applyDefaultMarkup(was, { ...was, type: 'labor' }, DEFAULTS)).toMatchObject({ markupPct: 25, unitPrice: 125 })
  })
  test('margin is the share of the price we keep: a 25% markup is a 20% margin; none until there is a cost and a price', () => {
    expect(lineMargin({ unitCost: 80, unitPrice: 100 })).toBe(20)
    expect(lineMargin({ unitCost: 100, unitPrice: 120 })).toBe(16.7)
    expect(lineMargin({ unitPrice: 100 })).toBeNull()
    expect(lineMargin({ unitCost: 10, unitPrice: 0 })).toBeNull()
  })
  test('the quote\'s margin counts the costed lines and says how many have no cost', () => {
    const m = quoteMargin([{ description: 'a', quantity: 2, unitCost: 40, unitPrice: 50 }, { description: 'b', quantity: 1, unitCost: 100, unitPrice: 150 }, { description: 'c', quantity: 1, unitPrice: 300 }, { description: '', quantity: 1, unitPrice: 0 }])
    expect(m).toEqual({ cost: 180, price: 250, profit: 70, margin: 28, uncosted: 1 })
  })
})

describe('the line editor', () => {
  test('entering a cost on a Material line fills the markup and the price and shows the margin; changing the kind follows', async () => {
    const m = await mountEditor([{ ...BLANK }], { markupDefaults: DEFAULTS })
    await setValue(q('select[aria-label="Line kind"]')[0], 'material')
    expect(m.items()[0].unitPrice).toBe(0)
    await setValue(q('input[aria-label="Our cost per unit"]')[0], '100')
    expect([m.items()[0].markupPct, m.items()[0].unitPrice]).toEqual([20, 120])
    expect((q('input[aria-label="Markup percent"]')[0]).value).toBe('20')
    expect(q('[data-testid="line-margin"]')[0].textContent).toBe('margin 16.7%')
    await setValue(q('select[aria-label="Line kind"]')[0], 'labor')
    expect([m.items()[0].markupPct, m.items()[0].unitPrice]).toEqual([25, 125])
    act(() => m.root.unmount())
  }, 30_000)

  test('a price typed first is kept when a cost and kind follow; no margin shown without the feature', async () => {
    const m = await mountEditor([{ ...BLANK }], { markupDefaults: DEFAULTS })
    await setValue(q('input[aria-label="Unit price"]')[0], '99')
    await setValue(q('select[aria-label="Line kind"]')[0], 'material')
    await setValue(q('input[aria-label="Our cost per unit"]')[0], '50')
    expect(m.items()[0]).toMatchObject({ unitPrice: 99 })
    expect(m.items()[0].markupPct).toBeUndefined()
    act(() => m.root.unmount())
    const off = await mountEditor([{ ...BLANK }], {})
    await setValue(q('select[aria-label="Line kind"]')[0], 'material')
    await setValue(q('input[aria-label="Our cost per unit"]')[0], '100')
    expect(off.items()[0].unitPrice).toBe(0)
    expect(q('[data-testid="line-margin"]')).toHaveLength(0)
    act(() => off.root.unmount())
  }, 30_000)

  test('Add picture uploads the file and puts its address on the line; Remove takes it off; a failed upload says so', async () => {
    const uploads: File[] = []
    const m = await mountEditor([{ ...BLANK }], { images: { upload: async (f: File) => { uploads.push(f); return '/media/site/tile.jpg' } } })
    const input = q('input[type="file"]')[0]
    const file = new win.File(['x'], 'tile.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle()
    expect(uploads.length).toBe(1)
    expect(m.items()[0].imageUrl).toBe('/media/site/tile.jpg')
    expect(q('[data-testid="line-picture"]')).toHaveLength(1)
    await click(q('button[aria-label="Remove picture"]')[0])
    expect(m.items()[0].imageUrl).toBeUndefined()
    act(() => m.root.unmount())

    const bad = await mountEditor([{ ...BLANK }], { images: { upload: async () => { throw new Error('That photo is too large (8 MB at most).') } } })
    const input2 = q('input[type="file"]')[0]
    Object.defineProperty(input2, 'files', { value: [file], configurable: true })
    await act(async () => { input2.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle()
    expect(text()).toContain('That photo is too large (8 MB at most).')
    expect(bad.items()[0].imageUrl).toBeUndefined()
    act(() => bad.root.unmount())
  }, 30_000)

  test('without the pictures feature there is no Add picture control', async () => {
    const m = await mountEditor([{ ...BLANK }], {})
    expect(q('input[type="file"]')).toHaveLength(0)
    act(() => m.root.unmount())
  })

  test('the margin summary shows cost, profit and margin, and the count of lines left out', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('div'); document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(h(MarginSummary, { lines: [{ description: 'a', quantity: 2, unitCost: 40, unitPrice: 50 }, { description: 'c', quantity: 1, unitPrice: 300 }] })) })
    expect(text()).toContain('Cost $80.00'); expect(text()).toContain('Profit $20.00'); expect(text()).toContain('Margin 20%')
    expect(text()).toContain('1 line has no cost entered')
    act(() => root.unmount())
  })
})

describe('Quotes', () => {
  const auth = (features: string[]) => ({ user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) })
  function fakeApi() {
    const calls: string[] = []
    return {
      calls,
      api: {
        get: async (url: string) => { calls.push(url); return url === '/api/markup-defaults' ? DEFAULTS : { data: [], pagination: { total: 0, pages: 1, page: 1, limit: 25 } } },
        post: async () => ({}), put: async () => ({}), delete: async () => ({}), upload: async () => ({ url: '/media/x.jpg' }),
      },
    }
  }
  async function mountQuotes(features: string[], perms?: string[]) {
    const f = fakeApi()
    document.body.innerHTML = ''
    const el = document.createElement('div'); document.body.appendChild(el)
    const root = createRoot(el)
    const page = h(MemoryRouter, null, h(QuotesPage, { api: f.api, toast: { success() {}, error() {} }, settings: {}, config: { quoteSections: true, pricebook: true } }))
    const withPerms = perms ? h(PermissionsProvider, { role: 'viewer', permissions: perms }, page) : page
    await act(async () => { root.render(h(AuthContext.Provider, { value: auth(features) }, withPerms)) })
    await settle()
    return { root, calls: f.calls }
  }
  test('with markup_defaults the form reads the defaults; without the feature, or without margin:read, it does not ask', async () => {
    const on = await mountQuotes(['quotes', 'markup_defaults'])
    expect(on.calls).toContain('/api/markup-defaults')
    act(() => on.root.unmount())
    const off = await mountQuotes(['quotes'])
    expect(off.calls).not.toContain('/api/markup-defaults')
    act(() => off.root.unmount())
    const noCost = await mountQuotes(['quotes', 'markup_defaults'], ['quotes:read', 'quotes:create'])
    expect(noCost.calls).not.toContain('/api/markup-defaults')
    act(() => noCost.root.unmount())
  })
})

describe('the picture where it is read', () => {
  test('the office quote page shows a line\'s picture', async () => {
    const quote = { id: 'q1', number: 'Q-00001', name: 'Bath', status: 'draft', total: '120', subtotal: '120', taxRate: '0', taxAmount: '0', discount: '0', createdAt: '2026-11-01T00:00:00Z',
      lineItems: [{ id: 'l1', description: 'Floor tile', quantity: '10', unitPrice: '12', total: '120', imageUrl: 'https://cdn.example.com/tile.jpg' }, { id: 'l2', description: 'Grout', quantity: '1', unitPrice: '0', total: '0' }] }
    document.body.innerHTML = ''
    const el = document.createElement('div'); document.body.appendChild(el)
    const root = createRoot(el)
    const api = { get: async () => quote, post: async () => ({}), put: async () => ({}), delete: async () => ({}) }
    await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/crm/quotes/q1'] }, h(Routes, null, h(Route, { path: '/crm/quotes/:id', element: h(QuoteDetailPage, { api, toast: { success() {}, error() {} }, settings: {} }) })))) })
    await settle()
    const pics = q('[data-testid="line-picture"]')
    expect(pics).toHaveLength(1)
    expect(pics[0].getAttribute('src')).toBe('https://cdn.example.com/tile.jpg')
    act(() => root.unmount())
  })

  test('the customer\'s quote page shows it too', async () => {
    const quote = { id: 'q1', number: 'Q-00001', name: 'Bath', status: 'sent', total: '120', subtotal: '120', taxRate: '0', taxAmount: '0', discount: '0',
      lineItems: [{ id: 'l1', description: 'Floor tile', quantity: '10', unitPrice: '12', total: '120', imageUrl: '/media/site/tile.jpg' }], company: { name: 'Hall Builders' } }
    const realFetch = globalThis.fetch
    ;(globalThis as any).fetch = async (url: string) => {
      const body = String(url).endsWith('/quotes/q1') ? quote : { contact: { name: 'Ann' }, company: { name: 'Hall Builders' }, document: { kind: 'quote', id: 'q1' } }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    try {
      document.body.innerHTML = ''
      const el = document.createElement('div'); document.body.appendChild(el)
      const root = createRoot(el)
      await act(async () => { root.render(h(MemoryRouter, null, h(PortalLinkProvider, { token: 'tok' }, h(PortalQuoteDetail, { quoteId: 'q1' })))) })
      await settle()
      const pics = q('[data-testid="line-picture"]')
      expect(pics).toHaveLength(1)
      expect(pics[0].getAttribute('src')).toBe('/media/site/tile.jpg')
      act(() => root.unmount())
    } finally { ;(globalThis as any).fetch = realFetch }
  })
})
