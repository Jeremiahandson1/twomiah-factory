// The Inspections page with checklists (brief item 7), in a DOM: a Checklist action and column and a Checklists button only where
// the business has the feature; start from a saved checklist; answer Pass / Fail / N/A; Fail wants words first and then says which
// punch-list item it made; a visit whose checklist already holds the failures can be failed with the list left empty; a read-only
// seat sees the answers but cannot change them. (happy-dom: no headless browser here.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/inspections' })
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
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const InspectionsPage = (await import(W + 'crm/pages/InspectionsPage.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

const VISIT = { id: 'i1', number: 'INS-0001', type: 'Framing', status: 'scheduled', scheduledDate: null, inspector: 'Dana', project: { id: 'p1', name: 'Ruiz addition' }, projectId: 'p1', checklist: { total: 3, answered: 1, failed: 1 } }
const TEMPLATES = [{ id: 't1', name: 'Framing walk-through', type: 'Framing', items: [{ id: 'a', label: 'Hangers' }, { id: 'b', label: 'Firestopping' }] }]

function stub(opts: { lines?: any[] } = {}) {
  const calls: { m: string; url: string; body?: any }[] = []
  let lines: any[] = opts.lines ?? []
  const real = { inspections: api.inspections, projects: api.projects, get: api.get, post: api.post, put: api.put }
  api.inspections = { ...api.inspections, list: async () => ({ data: [VISIT], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } }), fail: async (id: string, b: any) => { calls.push({ m: 'POST', url: `/api/inspections/${id}/fail`, body: b }); return {} } }
  api.projects = { ...api.projects, list: async () => ({ data: [] }) }
  api.get = async (url: string) => {
    calls.push({ m: 'GET', url })
    if (url === '/api/inspection-templates') return { data: TEMPLATES }
    if (url === '/api/inspection-checklists/i1') return { items: lines, photos: [] }
    return { data: [] }
  }
  api.post = async (url: string, body?: any) => {
    calls.push({ m: 'POST', url, body })
    if (url.endsWith('/start')) { lines = [{ id: 'l1', label: 'Hangers', result: 'pending', note: null, punchListItemId: null }, { id: 'l2', label: 'Firestopping', result: 'pending', note: null, punchListItemId: null }]; return {} }
    return {}
  }
  api.put = async (url: string, body?: any) => {
    calls.push({ m: 'PUT', url, body })
    const id = url.split('/').pop()
    lines = lines.map((l) => l.id === id ? { ...l, ...body, punchListItemId: body.result === 'fail' ? 'pl1' : null } : l)
    return body.result === 'fail' ? { item: {}, punchItem: { number: 'PL-004' } } : { item: {}, punchItem: null }
  }
  return { calls, undo: () => { Object.assign(api, real) } }
}
async function mount(opts: { features?: string[]; can?: (p: string) => boolean } = {}) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const features = opts.features ?? ['inspection_checklists']
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: opts.can ?? (() => true), hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: ['/crm/inspections'] }, h(InspectionsPage)))))) })
  await settle()
  return root
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
const setSelect = async (el: any, value: string) => { await act(async () => { el.value = value; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }
const menu = async () => { await click(document.querySelector('button[aria-label="Row actions"]')); return [...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')].map((b: any) => b.textContent.trim()) }
const menuItem = (label: string) => [...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')].find((b: any) => b.textContent.trim() === label) as any

describe('the Inspections page with checklists', () => {
  test('with the feature: a Checklists button, a progress column and a Checklist row action; without it, none of them and nothing fetched', async () => {
    let s = stub()
    try {
      let root = await mount()
      expect(button('Checklists')).toBeTruthy()
      expect(text()).toContain('1 of 3 answered · 1 failed')
      expect(await menu()).toContain('Checklist')
      root.unmount()
    } finally { s.undo() }
    s = stub()
    try {
      const root = await mount({ features: [] })
      expect(button('Checklists')).toBeFalsy()
      expect(text()).not.toContain('answered')
      expect(await menu()).not.toContain('Checklist')
      expect(s.calls.some((c) => c.url.includes('inspection-'))).toBe(false)
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('a visit with no checklist offers the saved ones, suggested by its type, and starts the one picked', async () => {
    const s = stub()
    try {
      const root = await mount()
      await menu(); await click(menuItem('Checklist'))
      const pick = document.querySelector('#checklist-template') as any
      expect(pick.textContent).toContain('Framing walk-through — 2 lines')
      await setSelect(pick, 't1')
      await click(button('Start checklist'))
      expect(s.calls.find((c) => c.url === '/api/inspection-checklists/i1/start')?.body).toEqual({ templateId: 't1' })
      expect(text()).toContain('0 of 2 answered')
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('Fail wants words first; with them it fails the line and says which punch-list item it made', async () => {
    const s = stub({ lines: [{ id: 'l1', label: 'Hangers', result: 'pending', note: null, punchListItemId: null }] })
    try {
      const root = await mount()
      await menu(); await click(menuItem('Checklist'))
      const group = document.querySelector('[role="group"][aria-label="Answer for Hangers"]') as any
      const failBtn = [...group.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Fail') as any
      await click(failBtn)
      expect(s.calls.some((c) => c.m === 'PUT')).toBe(false)            // nothing sent without a note
      expect(text()).toContain('Say what is wrong first')
      await setInput(document.querySelector('input[aria-label="Note for Hangers"]'), 'Two missing at C')
      await click([...document.querySelector('[role="group"][aria-label="Answer for Hangers"]')!.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Fail'))
      const put = s.calls.find((c) => c.m === 'PUT')
      expect(put?.url).toBe('/api/inspection-checklists/i1/items/l1')
      expect(put?.body).toEqual({ result: 'fail', note: 'Two missing at C' })
      expect(text()).toContain('PL-004 was added to the punch list')
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('a seat that may not update sees the answers but the buttons are disabled and there is no way to add or remove a line', async () => {
    const s = stub({ lines: [{ id: 'l1', label: 'Hangers', result: 'pass', note: null, punchListItemId: null }] })
    try {
      const root = await mount({ can: (p) => p.endsWith(':read') })
      await menu(); await click(menuItem('Checklist'))
      const group = document.querySelector('[role="group"][aria-label="Answer for Hangers"]') as any
      expect([...group.querySelectorAll('button')].every((b: any) => b.disabled)).toBe(true)
      expect(document.querySelector('input[aria-label="Add a line"]')).toBeNull()
      expect(document.querySelector('button[aria-label="Remove Hangers"]')).toBeNull()
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('failing the visit: the list can stay empty when the checklist already holds the failures, and cannot when it does not', async () => {
    let s = stub()
    try {
      const root = await mount()
      await menu(); await click(menuItem('Fail'))
      const fail = button('Record failure')
      expect(fail.disabled).toBe(false)                                 // VISIT.checklist.failed is 1
      expect(text()).toContain('failed lines on the checklist are used')
      await click(fail)
      expect(s.calls.find((c) => c.url === '/api/inspections/i1/fail')?.body).toEqual({ deficiencies: '' })
      root.unmount()
    } finally { s.undo() }
    s = stub()
    const saved = VISIT.checklist
    ;(VISIT as any).checklist = { total: 3, answered: 0, failed: 0 }
    try {
      const root = await mount()
      await menu(); await click(menuItem('Fail'))
      expect(button('Record failure').disabled).toBe(true)
      root.unmount()
    } finally { (VISIT as any).checklist = saved; s.undo() }
  }, 30_000)
})
