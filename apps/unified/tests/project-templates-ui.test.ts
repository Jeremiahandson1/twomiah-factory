// The Projects page with templates (brief item 6), in a DOM: "Start from a template" on the new-project form (and the
// project is made through the template's route, not the plain one), "Save as template" on a project's row menu — both
// only where the business has the feature and the seat has the permission. (happy-dom: no headless browser here.)
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
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const ProjectsPage = (await import(W + 'crm/pages/ProjectsPage.tsx') as any).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

const TEMPLATES = [{ id: 't1', name: 'Kitchen remodel', taskCount: 4, punchItemCount: 2 }]
const PROJECT = { id: 'p1', number: 'PRJ-0001', name: 'Kitchen — Ruiz', status: 'active', progress: 0 }

function stub() {
  const calls: { m: string; url: string; body?: any }[] = []
  const real = { projects: api.projects, contacts: api.contacts, get: api.get, post: api.post }
  api.projects = { ...api.projects, list: async () => ({ data: [PROJECT], pagination: { page: 1, pages: 1, total: 1, limit: 25 } }), create: async (b: any) => { calls.push({ m: 'POST', url: '/api/projects', body: b }); return {} } }
  api.contacts = { ...api.contacts, list: async () => ({ data: [{ id: 'c1', name: 'Okafor', type: 'client' }] }), get: async () => null }
  api.get = async (url: string) => { calls.push({ m: 'GET', url }); return url === '/api/project-templates' ? { data: TEMPLATES } : { data: [] } }
  api.post = async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return url.endsWith('/start') ? { id: 'p2', copied: { tasks: 4, punchItems: 2 }, leftOut: [] } : { name: body?.name, taskCount: 4, punchItemCount: 2 } }
  return { calls, undo: () => { Object.assign(api, { projects: real.projects, contacts: real.contacts, get: real.get, post: real.post }) } }
}
async function mount(url: string, opts: { features?: string[]; can?: (p: string) => boolean } = {}) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const features = opts.features ?? ['project_templates']
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: opts.can ?? (() => true), hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: [url] }, h(ProjectsPage)))))) })
  await settle()
  return root
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
const setSelect = async (el: any, value: string) => { await act(async () => { el.value = value; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }

describe('start a project from a template', () => {
  test('the form offers the templates, and Create goes through the template with the form’s fields', async () => {
    const s = stub()
    try {
      const root = await mount('/crm/projects?new=1')
      const pick = document.querySelector('#project-template') as any
      expect(pick).toBeTruthy()
      expect(pick.textContent).toContain('Kitchen remodel — 4 tasks, 2 punch items')
      await setSelect(pick, 't1')
      expect(text()).toContain('The schedule is placed from the start date below')
      const name = [...document.querySelectorAll('[role="dialog"] input')].find((i: any) => i.value === 'Kitchen remodel') as any
      expect(name).toBeTruthy()                                  // the template's name seeded the project's
      await setInput(name, 'Kitchen — Okafor')
      await click(button('Create'))
      const start = s.calls.find((c) => c.m === 'POST' && c.url === '/api/project-templates/t1/start')
      expect(start?.body.name).toBe('Kitchen — Okafor')
      expect(s.calls.some((c) => c.url === '/api/projects')).toBe(false)     // not the plain route
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('with no template picked, Create is the plain project', async () => {
    const s = stub()
    try {
      const root = await mount('/crm/projects?new=1')
      const name = document.querySelector('[role="dialog"] input') as any
      await setInput(name, 'Deck')
      await click(button('Create'))
      expect(s.calls.some((c) => c.url === '/api/projects')).toBe(true)
      expect(s.calls.some((c) => c.url.includes('/start'))).toBe(false)
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('without the feature, or without projects:create, the form has no template picker and nothing is fetched', async () => {
    for (const opts of [{ features: [] as string[] }, { can: (p: string) => p !== 'projects:create' }]) {
      const s = stub()
      try {
        const root = await mount('/crm/projects?new=1', opts)
        expect(document.querySelector('#project-template')).toBeNull()
        if (opts.features && !opts.features.length) expect(s.calls.some((c) => c.url === '/api/project-templates')).toBe(false)
        root.unmount()
      } finally { s.undo() }
    }
  }, 30_000)
})

describe('save a project as a template', () => {
  async function openMenu() {
    await click(document.querySelector('button[aria-label="Row actions"]'))
    return [...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')].map((b: any) => b.textContent.trim())
  }
  test('the row menu offers it, asks for a name and posts the project', async () => {
    const s = stub()
    try {
      const root = await mount('/crm/projects')
      expect(await openMenu()).toContain('Save as template')
      await click([...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')].find((b: any) => b.textContent.trim() === 'Save as template'))
      const input = document.querySelector('#template-name') as any
      expect(input.value).toBe('Kitchen — Ruiz template')
      await setInput(input, 'Kitchen remodel')
      await click(button('Save template'))
      const post = s.calls.find((c) => c.url === '/api/project-templates/from-project')
      expect(post?.body).toEqual({ projectId: 'p1', name: 'Kitchen remodel' })
      root.unmount()
    } finally { s.undo() }
  }, 30_000)

  test('not offered without the feature, or without projects:update', async () => {
    for (const opts of [{ features: [] as string[] }, { can: (p: string) => p !== 'projects:update' }]) {
      const s = stub()
      try {
        const root = await mount('/crm/projects', opts)
        expect(await openMenu()).not.toContain('Save as template')
        root.unmount()
      } finally { s.undo() }
    }
  }, 30_000)
})
