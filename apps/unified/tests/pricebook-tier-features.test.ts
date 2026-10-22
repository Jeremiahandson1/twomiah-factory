// The pricebook's tier editor, typed into key by key in a browser-like window (2026-10-22 live test: the presentation
// page showed "Designershingles"). The Included box was split and trimmed on every keystroke, so the space after a word
// was gone before the next letter. The presentation page (server/crm/office/pricebookPresent.ts) prints what was saved;
// the fault was here (packages/tenant-ui/src/pricebook/PricebookPage.tsx TiersModal).
import { test, expect, beforeAll } from 'bun:test'
import { Window } from 'happy-dom'

let win: any
beforeAll(() => {
  win = new Window({ url: 'https://tenant.test/crm/pricebook' })
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'getComputedStyle', 'MutationObserver']) {
    ;(globalThis as any)[k] = k === 'window' ? win : win[k]
  }
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

test('"Designer shingles, Ice shield" typed a key at a time is saved as two items, spaces kept', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React as any
  const { TiersModal } = await import('../../../packages/tenant-ui/src/pricebook/PricebookPage.tsx')
  const saved: any[] = []
  const api = {
    get: async () => [],
    put: async (_p: string, body: any) => { saved.push(body); return body },
    post: async () => ({}), delete: async () => ({}),
  }
  const presets = [{ tier: 'best', name: 'Best', description: '', recommended: true }]
  const host = win.document.createElement('div')
  win.document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(TiersModal as any, { api, toast: { success() {}, error() {} }, item: { id: 'i1', name: 'Roof' }, presets, title: 'Tiers', onClose() {}, onSaved() {} }))
  })
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!
  const typeInto = async (el: any, text: string) => {
    for (const ch of text) {
      await act(async () => { setter.call(el, el.value + ch); el.dispatchEvent(new win.Event('input', { bubbles: true })) })
    }
  }
  const box = (ph: string) => win.document.querySelector(`input[placeholder="${ph}"]`)
  await typeInto(box('Option name'), 'Premium')
  await typeInto(box('Price'), '9500')
  await typeInto(box('Included (comma separated)'), 'Designer shingles, Ice shield')
  expect(box('Included (comma separated)').value).toBe('Designer shingles, Ice shield')
  const save = [...win.document.querySelectorAll('button')].find((b: any) => b.textContent === 'Save options')
  await act(async () => { save.click() })
  expect(saved.length).toBe(1)
  expect(saved[0].options[0].features).toEqual(['Designer shingles', 'Ice shield'])
  await act(async () => root.unmount())
})
