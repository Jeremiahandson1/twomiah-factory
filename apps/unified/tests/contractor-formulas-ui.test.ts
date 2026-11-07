// Contractor parity row 9, the screens in a DOM (quote_formulas, not ready): the line editor takes a name and quantity / price
// formulas, works them out as they are typed, locks the number a formula sets, and says a formula's problem on its line; the
// parameters panel edits the quote's parameters and shows the job's. The browser's formula engine is the server's, copied (each
// package is vendored on its own): the two files must stay the same. Server half: contractor-formulas.test.ts. (happy-dom.)
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/quotes' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const P = '../../../packages/tenant-ui/src/'
const { LineItemsEditor } = await import(P + 'invoicing/ui.tsx') as any
const { ParametersPanel, applyLineFormulas } = await import(P + 'invoicing/formulasUi.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const setValue = async (el: any, value: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) })
  await settle()
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const all = (sel: string) => [...document.querySelectorAll(sel)] as any[]

function Harness({ initial, props, onState }: { initial: any[]; props: any; onState: (x: any[]) => void }) {
  const [items, setItems] = React.useState(initial)
  onState(items)
  return h(LineItemsEditor, { items, onChange: setItems, ...props })
}
async function mount(node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(node) })
  await settle()
  return root
}
const PARAMS = [{ key: 'deck_sqft', value: 300 }]

describe('the two copies of the engine', () => {
  test('the browser’s formulas.ts is the server’s, character for character', () => {
    const a = readFileSync(new URL('../../../packages/tenant-backend/src/invoicing/formulas.ts', import.meta.url), 'utf8')
    const b = readFileSync(new URL('../../../packages/tenant-ui/src/invoicing/formulas.ts', import.meta.url), 'utf8')
    expect(b).toBe(a)
  })
})

describe('the line editor', () => {
  test('with formulas on: typing a formula sets the quantity, which is then locked; lines read each other; a mistake is said on its line', async () => {
    let state: any[] = []
    const root = await mount(h(Harness, { initial: [{ description: 'Boards', quantity: 1, unitPrice: 18 }, { description: 'Screws', quantity: 1, unitPrice: 42 }], props: { estimating: { formulas: { parameters: PARAMS } } }, onState: (x: any[]) => { state = x } }))
    expect(all('[data-testid="line-formulas"]').length).toBe(2)
    await setValue(all('input[aria-label="Line name for formulas"]')[0], 'boards')
    await setValue(all('input[aria-label="Quantity formula"]')[0], 'ceil(deck_sqft / 5.5)')
    await setValue(all('input[aria-label="Quantity formula"]')[1], 'ceil(boards * 20 / 350)')
    expect(state.map((l) => l.quantity)).toEqual([55, 4])
    expect(all('input[aria-label="Quantity"]').map((i) => i.disabled)).toEqual([true, true])
    await setValue(all('input[aria-label="Quantity formula"]')[1], 'nails * 2')
    expect(document.querySelector('[data-testid="formula-error"]')!.textContent).toBe('Nothing is called "nails": no parameter or line has that name')
    root.unmount()
  })

  test('off: no formula fields, and the quantity is typed', async () => {
    const root = await mount(h(Harness, { initial: [{ description: 'Boards', quantity: 3, unitPrice: 18 }], props: { estimating: {} }, onState: () => {} }))
    expect(all('[data-testid="line-formulas"]').length).toBe(0)
    expect(all('input[aria-label="Quantity"]')[0].disabled).toBe(false)
    root.unmount()
  })

  test('applyLineFormulas: new parameters move every formula line; a text line has none', () => {
    const lines = [{ description: 'Boards', quantity: 1, unitPrice: 18, quantityFormula: 'deck_sqft / 10' }, { description: 'Note', quantity: 1, unitPrice: 0, type: 'text', quantityFormula: 'nope' }]
    const r = applyLineFormulas(lines, [{ key: 'deck_sqft', value: 440 }])
    expect([r.items[0].quantity, r.errors]).toEqual([44, {}])
  })
})

describe('the parameters panel', () => {
  test('shows the job’s, edits the quote’s own, adds and removes', async () => {
    let got: any = null
    const root = await mount(h(ParametersPanel, { parameters: [{ key: 'deck_sqft', value: 300, unit: 'sq ft' }], fromProject: [{ key: 'deck_sqft', value: 250 }, { key: 'pitch', value: 6 }], onChange: (p: any) => { got = p } }))
    expect(document.querySelector('[data-testid="project-parameters"]')!.textContent).toContain('pitch = 6')
    // the job's deck_sqft is crossed out: the quote gives its own
    expect(document.querySelector('[data-testid="project-parameters"] .line-through')!.textContent).toContain('deck_sqft = 250')
    await setValue(document.querySelector('input[aria-label="Value of deck_sqft"]'), '320')
    expect(got).toEqual([{ key: 'deck_sqft', value: 320, unit: 'sq ft' }])
    await click([...document.querySelectorAll('button')].find((b: any) => b.textContent === '+ Add parameter'))
    expect(got).toEqual([{ key: 'deck_sqft', value: 300, unit: 'sq ft' }, { key: '', value: 0 }])
    await click(document.querySelector('button[aria-label="Remove deck_sqft"]'))
    expect(got).toEqual([])
    root.unmount()
  })
})
