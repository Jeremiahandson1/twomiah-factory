// Roofing parity row 8, the drawing editor in a DOM (the server's half is roof-photo-markup.test.ts):
//   · the Save control is offered only to a seat that may change a job's photos (jobs:update, the permission the route asks);
//   · for a seat that may, saving sends the shapes to the photo's markup route and hands back the marked copy.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/jobs/j1' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const W = '../web/src/'
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const { api } = await import(W + 'api.ts') as any
const Editor = (await import(W + 'crm/pages/roof/jobs/PhotoMarkupEditor.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const button = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label)

type Call = { method: string; path: string; body?: any }
async function mount(permissions: string[], onSaved: (r: any) => void = () => {}) {
  const calls: Call[] = []
  const real = { put: api.put }
  api.put = async (url: string, body?: any) => { calls.push({ method: 'PUT', path: url, body }); return { original: 'ph1', marked: { id: 'ph2' } } }
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'manager' }, company: {}, hasFeature: () => true }
  const shapes = [{ kind: 'circle', x: 0.5, y: 0.5, rx: 0.1, ry: 0.1, color: 'red' }]
  const editor = h(Editor, { original: { id: 'ph1', url: '/p.png', caption: 'Ridge' }, shapes, onClose: () => {}, onSaved })
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(PermissionsProvider, { role: 'manager', permissions }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, null, editor)))))) })
  await settle()
  return { calls, undo: () => Object.assign(api, real), root }
}

describe('the photo drawing editor', () => {
  test('offers Save only to a seat that may change a job’s photos', async () => {
    const view = await mount(['jobs:read'])
    try {
      expect(document.body.textContent).toContain('Draw on Ridge')
      expect(button('Save marked copy')).toBeUndefined()
      expect(button('Remove marks')).toBeUndefined()
    } finally { view.undo(); await act(async () => { view.root.unmount() }) }
  })

  test('for a seat that may, saving sends the shapes to the photo’s markup route', async () => {
    let saved: any = null
    const view = await mount(['jobs:read', 'jobs:update'], (r) => { saved = r })
    try {
      const save = button('Save marked copy')
      expect(save).toBeTruthy()
      await act(async () => { (save as HTMLElement).click() })
      await settle()
      expect(view.calls).toHaveLength(1)
      expect(view.calls[0].path).toBe('/api/photo-markup/ph1')
      expect(view.calls[0].body.shapes).toHaveLength(1)
      expect(saved?.marked?.id).toBe('ph2')
    } finally { view.undo(); await act(async () => { view.root.unmount() }) }
  })
})
