// Inspections on the phone (contractor parity, item 6) — the OFFICE half, in a DOM: the saved-checklist editor offers "put this on new
// inspections by itself" (and the kinds of job it is for) only where Automatic Inspection Checklists is on, and a visit the customer has
// signed shows who signed and when, with the signature, and offers no way to change a line. (happy-dom: no headless browser here.)
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

const VISIT = { id: 'i1', number: 'INS-0001', type: 'Framing', status: 'scheduled', scheduledDate: null, inspector: 'Dana', project: { id: 'p1', name: 'Ruiz addition' }, projectId: 'p1', checklist: { total: 1, answered: 1, failed: 0 } }
const LINE = { id: 'l1', label: 'Hangers', result: 'pass', note: null, punchListItemId: null }
const AUTO_TEMPLATE = { id: 't1', name: 'Framing walk-through', type: 'Framing', items: [{ id: 'a', label: 'Hangers' }], autoAttach: true, jobTypes: ['Framing crew'] }
const PLAIN_TEMPLATE = { id: 't2', name: 'Slab check', type: null, items: [{ id: 'b', label: 'Rebar' }], autoAttach: false, jobTypes: [] }

function stub(opts: { visit?: any; templates?: any[] } = {}) {
  const calls: { m: string; url: string; body?: any }[] = []
  const real = { inspections: api.inspections, projects: api.projects, get: api.get, post: api.post, put: api.put }
  api.inspections = { ...api.inspections, list: async () => ({ data: [VISIT], pagination: { page: 1, limit: 25, total: 1, totalPages: 1 } }) }
  api.projects = { ...api.projects, list: async () => ({ data: [] }) }
  api.get = async (url: string) => {
    calls.push({ m: 'GET', url })
    if (url === '/api/inspection-templates') return { data: opts.templates ?? [] }
    if (url === '/api/inspection-checklists/i1') return { ...(opts.visit || {}), items: [LINE], photos: [] }
    return { data: [] }
  }
  api.post = async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return {} }
  api.put = async (url: string, body?: any) => { calls.push({ m: 'PUT', url, body }); return {} }
  return { calls, undo: () => { Object.assign(api, real) } }
}
async function mount(features: string[], can: (p: string) => boolean = () => true) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can, hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: ['/crm/inspections'] }, h(InspectionsPage)))))) })
  await settle()
  return root
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }
const menu = async () => { await click(document.querySelector('button[aria-label="Row actions"]')); return [...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')] }
const unmount = async (root: any) => { await act(async () => { root.unmount() }) }

describe('the saved-checklist editor', () => {
  test('with Automatic Inspection Checklists on: the box and the kinds of job are there, what is saved says so, and the list shows which go on by themselves', async () => {
    const s = stub({ templates: [AUTO_TEMPLATE, PLAIN_TEMPLATE] })
    try {
      const root = await mount(['inspection_checklists', 'inspection_auto_checklists'])
      await click(button('Checklists'))
      expect(text()).toContain('goes on new inspections by itself (Framing crew)')
      expect(text().match(/goes on new inspections by itself/g)?.length).toBe(1)          // the plain one says nothing
      await click(button('New checklist'))
      const box = document.querySelector('#tpl-auto') as any
      expect(box).toBeTruthy()
      expect(document.querySelector('#tpl-kinds')).toBeNull()                              // the kinds appear once the box is ticked
      await click(box)
      await setInput(document.querySelector('#tpl-name'), 'Deck check')
      await act(async () => { const ta = document.querySelector('#tpl-lines') as any; Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'Ledger flashed\nGuard height'); ta.dispatchEvent(new win.Event('input', { bubbles: true })) })
      await setInput(document.querySelector('#tpl-kinds'), 'Deck crew, Porch ,')
      await click(button('Save checklist'))
      const post = s.calls.find((c) => c.m === 'POST' && c.url === '/api/inspection-templates')
      expect(post?.body).toEqual({ name: 'Deck check', type: null, items: ['Ledger flashed', 'Guard height'], autoAttach: true, jobTypes: ['Deck crew', 'Porch'] })
      await unmount(root)
    } finally { s.undo() }
  }, 30_000)

  test('editing one that is automatic starts with its settings filled in', async () => {
    const s = stub({ templates: [AUTO_TEMPLATE] })
    try {
      const root = await mount(['inspection_checklists', 'inspection_auto_checklists'])
      await click(button('Checklists'))
      await click(button('Edit'))
      expect((document.querySelector('#tpl-auto') as any).checked).toBe(true)
      expect((document.querySelector('#tpl-kinds') as any).value).toBe('Framing crew')
      await unmount(root)
    } finally { s.undo() }
  }, 30_000)

  test('with it off: no box, no kinds, and nothing about it is sent', async () => {
    const s = stub({ templates: [PLAIN_TEMPLATE] })
    try {
      const root = await mount(['inspection_checklists'])
      await click(button('Checklists'))
      await click(button('New checklist'))
      expect(document.querySelector('#tpl-auto')).toBeNull()
      await setInput(document.querySelector('#tpl-name'), 'Deck check')
      await act(async () => { const ta = document.querySelector('#tpl-lines') as any; Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'Ledger flashed'); ta.dispatchEvent(new win.Event('input', { bubbles: true })) })
      await click(button('Save checklist'))
      const post = s.calls.find((c) => c.m === 'POST' && c.url === '/api/inspection-templates')
      expect(post?.body).toEqual({ name: 'Deck check', type: null, items: ['Ledger flashed'] })
      await unmount(root)
    } finally { s.undo() }
  }, 30_000)
})

describe('a visit the customer has signed', () => {
  const SIGNED = { signedBy: 'Rosa Ruiz', signedAt: '2026-10-30T15:00:00.000Z', signature: 'data:image/png;base64,AAAA' }

  test('shows who signed and when, with the signature, and offers no way to change a line — even to a seat that may update', async () => {
    const s = stub({ visit: SIGNED })
    try {
      const root = await mount(['inspection_checklists'])
      const items = await menu(); await click(items.find((b: any) => b.textContent.trim() === 'Checklist'))
      expect(text()).toContain('Signed by Rosa Ruiz on')
      expect(text()).toContain('The answers below are final')
      expect((document.querySelector('img[alt="Signature of Rosa Ruiz"]') as any)?.getAttribute('src')).toBe(SIGNED.signature)
      const group = document.querySelector('[role="group"][aria-label="Answer for Hangers"]') as any
      expect([...group.querySelectorAll('button')].every((b: any) => b.disabled)).toBe(true)
      expect(document.querySelector('input[aria-label="Add a line"]')).toBeNull()
      expect(document.querySelector('button[aria-label="Remove Hangers"]')).toBeNull()
      await unmount(root)
    } finally { s.undo() }
  }, 30_000)

  test('a seat that is not shown the evidence still sees who signed, without a picture; an unsigned visit shows no sign-off and stays editable', async () => {
    let s = stub({ visit: { signedBy: 'Rosa Ruiz', signedAt: SIGNED.signedAt } })
    try {
      const root = await mount(['inspection_checklists'], (p) => p.endsWith(':read'))
      const items = await menu(); await click(items.find((b: any) => b.textContent.trim() === 'Checklist'))
      expect(text()).toContain('Signed by Rosa Ruiz on')
      expect(document.querySelector('img')).toBeNull()
      await unmount(root)
    } finally { s.undo() }
    s = stub({ visit: {} })
    try {
      const root = await mount(['inspection_checklists'])
      const items = await menu(); await click(items.find((b: any) => b.textContent.trim() === 'Checklist'))
      expect(text()).not.toContain('Signed by')
      const group = document.querySelector('[role="group"][aria-label="Answer for Hangers"]') as any
      expect([...group.querySelectorAll('button')].some((b: any) => !b.disabled)).toBe(true)
      expect(document.querySelector('input[aria-label="Add a line"]')).toBeTruthy()
      await unmount(root)
    } finally { s.undo() }
  }, 30_000)
})
