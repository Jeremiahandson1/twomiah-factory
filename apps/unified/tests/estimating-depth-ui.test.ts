// The quote line editor and the quote's tables, in a DOM (brief item 5): a multi-line description, sections with
// subtotals, a markup that prices a line from its cost (per line and per section), an Allowance tick only where asked,
// the empty-pricebook hint, and the grouped tables — while a quote without the estimating switch draws as it always did.
// (happy-dom: no headless browser is installed on this machine.)
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
const P = '../../../packages/tenant-ui/src/invoicing/'
const { LineItemsEditor } = await import(P + 'ui.tsx') as any
const { SectionedRows } = await import(P + 'sections.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

function Harness({ initial, props, onState }: { initial: any[]; props: any; onState: (x: any[]) => void }) {
  const [items, setItems] = React.useState(initial)
  onState(items)
  return h(LineItemsEditor, { items, onChange: setItems, ...props })
}
async function mount(initial: any[], props: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  let state: any[] = initial
  await act(async () => { root.render(h(MemoryRouter, null, h(Harness, { initial, props, onState: (x: any[]) => { state = x } }))) })
  await settle()
  return { root, items: () => state }
}
const BOOK = { items: [{ id: 'p1', name: 'Framing lumber', price: 60, cost: 50, type: 'material' }], canSeeCost: true, loaded: true }
const setValue = async (el: any, value: string) => {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new win.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  await settle()
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const q = (sel: string) => [...document.querySelectorAll(sel)] as any[]
const btn = (label: string) => q('button').find((b) => b.textContent.trim() === label)

describe('the estimating editor', () => {
  const on = { pricebook: BOOK, estimating: { allowances: true, costCodes: true } }

  test('a description can run to several lines', async () => {
    const m = await mount([{ description: '', quantity: 1, unitPrice: 0 }], on)
    const box = q('textarea[aria-label="Description"]')[0]
    expect(box).toBeTruthy()
    await setValue(box, 'Demo cabinets\nHaul away')
    expect(m.items()[0].description).toBe('Demo cabinets\nHaul away')
  }, 30_000)

  test('a markup prices the line from its cost, a typed price takes the markup off, and it needs a cost first', async () => {
    const m = await mount([{ description: 'Lumber', quantity: 10, unitPrice: 0 }], on)
    const markup = () => q('input[aria-label="Markup percent"]')[0]
    expect(markup().disabled).toBe(true)                       // no cost yet: nothing to mark up
    await setValue(q('input[aria-label="Our cost per unit"]')[0], '50')
    expect(markup().disabled).toBe(false)
    await setValue(markup(), '20')
    expect(m.items()[0]).toMatchObject({ unitCost: 50, markupPct: 20, unitPrice: 60 })
    expect(text()).toContain('$600.00')                         // 10 × 60
    await setValue(q('input[aria-label="Our cost per unit"]')[0], '60')   // the cost moves, the price follows
    expect(m.items()[0].unitPrice).toBe(72)
    await setValue(q('input[aria-label="Unit price"]')[0], '80')           // a price typed over it wins
    expect(m.items()[0]).toMatchObject({ unitPrice: 80, markupPct: undefined })
  }, 30_000)

  test('sections: Add section starts one, each has a subtotal, a markup for all, and renaming moves its lines', async () => {
    const m = await mount([
      { description: 'Lumber', quantity: 2, unitPrice: 100, unitCost: 80, section: 'Framing' },
      { description: 'Studs', quantity: 1, unitPrice: 50, unitCost: 40, section: 'Framing' },
      { description: 'Tile', quantity: 1, unitPrice: 300, section: 'Finishes' },
    ], on)
    expect(text()).toContain('Framing · $250.00')
    expect(text()).toContain('Finishes · $300.00')
    await click(btn('+ Add section'))
    expect(m.items().at(-1)).toMatchObject({ description: '', section: 'Section 3' })
    expect(q('input[aria-label="Section name"]')).toHaveLength(3)

    await setValue(q('input[aria-label="Markup for every costed line in Framing"]')[0], '25')
    expect(m.items().slice(0, 2).map((l) => l.unitPrice)).toEqual([100, 50])     // 80×1.25, 40×1.25
    expect(m.items()[2].unitPrice).toBe(300)                                      // not in the section: untouched

    await setValue(q('input[aria-label="Section name"]')[0], 'Rough framing')
    expect(m.items().slice(0, 2).map((l) => l.section)).toEqual(['Rough framing', 'Rough framing'])
    expect(text()).toContain('Rough framing · $250.00')
  }, 30_000)

  test('the Allowance tick and the cost code are there only where asked for', async () => {
    const withBoth = await mount([{ description: 'Tile', quantity: 1, unitPrice: 100 }], on)
    expect(q('input[aria-label="Allowance line"]')).toHaveLength(1)
    expect(q('input[aria-label="Cost code"]')).toHaveLength(1)
    await click(q('input[aria-label="Allowance line"]')[0])
    expect(withBoth.items()[0].allowance).toBe(true)
    await mount([{ description: 'Tile', quantity: 1, unitPrice: 100 }], { pricebook: BOOK, estimating: {} })
    expect(q('input[aria-label="Allowance line"]')).toHaveLength(0)
    expect(q('input[aria-label="Cost code"]')).toHaveLength(0)
  }, 30_000)

  test('without the estimating switch the editor is what it was: a one-line box, no sections, no markup column', async () => {
    await mount([{ description: 'Gutter clean', quantity: 1, unitPrice: 100 }], { pricebook: BOOK })
    expect(q('textarea')).toHaveLength(0)
    expect(q('input[aria-label="Markup percent"]')).toHaveLength(0)
    expect(btn('+ Add section')).toBeUndefined()
    expect(text()).not.toContain('Markup %')
  }, 30_000)
})

describe('the pricebook picker', () => {
  test('an empty pricebook says so; a full one shows the picker; one still loading says nothing', async () => {
    await mount([{ description: '', quantity: 1, unitPrice: 0 }], { pricebook: { items: [], canSeeCost: true, loaded: true } })
    expect(text()).toContain('Your pricebook is empty')
    expect(q('select[aria-label="Add a line from the pricebook"]')).toHaveLength(0)
    await mount([{ description: '', quantity: 1, unitPrice: 0 }], { pricebook: BOOK })
    expect(text()).not.toContain('Your pricebook is empty')
    expect(q('select[aria-label="Add a line from the pricebook"]')).toHaveLength(1)
    await mount([{ description: '', quantity: 1, unitPrice: 0 }], { pricebook: { items: [], canSeeCost: true } })
    expect(text()).not.toContain('Your pricebook is empty')
  }, 30_000)
})

describe('a quote’s table, grouped', () => {
  const table = (lines: any[]) => h('table', null, h('tbody', null, h(SectionedRows, { lines, colSpan: 4, row: (l: any, i: number) => h('tr', { key: i }, h('td', null, l.description), h('td', null, ''), h('td', null, ''), h('td', null, String(l.total))) })))
  async function draw(lines: any[]) {
    document.body.innerHTML = ''
    const el = document.createElement('div'); document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => { root.render(table(lines)) })
    return root
  }
  test('sections get a heading and a subtotal; an unticked optional line is shown but not counted', async () => {
    await draw([
      { description: 'Demo', total: 1000, section: 'Demolition' },
      { description: 'Framing', total: 600, section: 'Framing' },
      { description: 'Deck (optional)', total: 900, section: 'Framing', optional: true, selected: false },
    ])
    expect(text()).toContain('Demolition')
    expect(text()).toContain('Demolition subtotal$1,000.00')
    expect(text()).toContain('Framing subtotal$600.00')
  })
  test('a plain quote has no headings and no subtotals', async () => {
    await draw([{ description: 'Gutter clean', total: 100 }, { description: 'Downspout', total: 40 }])
    expect(text()).toBe('Gutter clean100Downspout40')
  })
})
