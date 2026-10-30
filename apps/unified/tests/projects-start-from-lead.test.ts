// "Start a project" from the Lead Inbox lands on /crm/projects?new=1&contactId=… and the form opens with that person
// chosen — even though they are a brand-new contact the first page of the picker does not hold, and are not yet a "client".
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/projects' })
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
// By a path in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const ProjectsPage = (await import(W + 'crm/pages/ProjectsPage.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

async function mount(url: string, can: (p: string) => boolean) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can, hasFeature: () => true }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: [url] }, h(ProjectsPage)))))) })
  await settle()
  return root
}
const stub = () => {
  const real = { projects: api.projects, contacts: api.contacts }
  api.projects = { ...api.projects, list: async () => ({ data: [], pagination: { page: 1, pages: 1, total: 0, limit: 25 } }) }
  api.contacts = { ...api.contacts, list: async () => ({ data: [{ id: 'c-other', name: 'Other Client', type: 'client' }] }), get: async (id: string) => ({ id, name: 'Brand New Lead', type: 'lead' }) }
  return () => { api.projects = real.projects; api.contacts = real.contacts }
}

describe('a project started from a lead', () => {
  test('the form opens with the new contact chosen', async () => {
    const undo = stub()
    try {
      const root = await mount('/crm/projects?new=1&contactId=c-new', () => true)
      const select = [...document.querySelectorAll('select')].find((s: any) => [...s.options].some((o: any) => o.textContent === 'Brand New Lead')) as any

      expect(select).toBeTruthy()
      expect(select.value).toBe('c-new')
      root.unmount()
    } finally { undo() }
  })

  test('a seat that may not create projects gets no form', async () => {
    const undo = stub()
    try {
      const root = await mount('/crm/projects?new=1&contactId=c-new', (p) => p !== 'projects:create')
      expect([...document.querySelectorAll('select')].some((s: any) => [...s.options].some((o: any) => o.textContent === 'Brand New Lead'))).toBe(false)
      root.unmount()
    } finally { undo() }
  })
})
