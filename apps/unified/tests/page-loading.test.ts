// A page that is still loading says what it is loading (brief item 9). Before: the lazy wrapper's Suspense fallback was
// null, so opening a screen on a slow connection showed a blank page; and Submittals, Lien Waivers, Draw Schedules, AIA
// forms and Gantt showed one spinner and no words.
//   · the fetch fallback names the page — the menu's word for it (a vertical renames menu items), else the name it was
//     registered under — over a skeleton;
//   · each of those pages, while its data is on the way, says what it is loading.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/lien-waivers' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
// .tsx by a path in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const P = '../../../packages/tenant-ui/src/'
const W = '../web/src/'
const { MenuNameContext } = await import(P + 'shell/menuName.tsx') as any
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const { page, named } = await import(W + 'crm/lazy.tsx') as any
const { api } = await import(W + 'api.ts') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const forever = () => new Promise(() => {})

async function mount(node: any, path: string, menu: { to: string; label: string }[] = []) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: () => true }
  await act(async () => {
    root.render(h(AuthContext.Provider, { value: auth },
      h(ToastProvider, null, h(ConfirmProvider, null,
        h(MemoryRouter, { initialEntries: [path] }, h(MenuNameContext.Provider, { value: menu }, node))))))
  })
  await settle()
  return root
}

describe('a screen being fetched says which one', () => {
  test("by the menu's word for it, over a skeleton — not a blank page", async () => {
    const Lazy = page(forever)
    const root = await mount(h(Lazy), '/crm/lien-waivers', [{ to: '/crm/lien-waivers', label: 'Lien Waivers' }])
    expect(text()).toContain('Loading Lien Waivers…')
    expect(document.querySelectorAll('[role=status] .animate-pulse').length).toBe(1)
    root.unmount()
  })

  test("a vertical's own word for the page wins over the registered name", async () => {
    const Lazy = named(forever as any, 'X' as any, 'Events')
    const root = await mount(h(Lazy), '/crm/events', [{ to: '/crm/events', label: 'Parties' }])
    expect(text()).toContain('Loading Parties…')
    root.unmount()
  })

  test('a page with no menu item uses the name it was registered under; a detail page, the menu item above it', async () => {
    const Lazy = named(forever as any, 'X' as any, 'Job Detail')
    let root = await mount(h(Lazy), '/crm/jobs/abc123', [{ to: '/crm/jobs', label: 'Service Calls' }])
    expect(text()).toContain('Loading Job Detail…')
    root.unmount()
    const Plain = page(forever)
    root = await mount(h(Plain), '/crm/jobs/abc123', [{ to: '/crm/jobs', label: 'Service Calls' }])
    expect(text()).toContain('Loading Service Calls…')
    root.unmount()
  })
})

describe('the construction pages say what they are loading', () => {
  const cases: [string, string, string][] = [
    ['SubmittalsPage', 'default', 'Loading your submittals…'],
    ['LienWaiversPage', 'default', 'Loading your lien waivers…'],
    ['DrawSchedulesPage', 'default', 'Loading your draw schedules…'],
    ['GanttChartsPage', 'default', 'Loading the schedules for your projects…'],
    ['AiaFormsPage', 'default', 'Loading your AIA forms…'],
  ]
  for (const [file, exp, words] of cases) {
    test(file, async () => {
      const real = { get: api.get }
      api.get = forever
      try {
        const Page = (await import(W + `crm/pages/${file}.tsx`) as any)[exp]
        const root = await mount(h(Page), '/crm/x')
        expect(text()).toContain(words)
        expect(document.querySelector('[data-page-loading]')).not.toBeNull()
        root.unmount()
      } finally { api.get = real.get }
    })
  }
})

describe('Selections says what it is loading', () => {
  test('the list of a project, while it is fetched', async () => {
    const real = api.get
    api.get = forever
    try {
      const Page = (await import(W + 'crm/pages/SelectionsPage.tsx') as any).default
      const root = await mount(h(Page, { projectId: 'p1' }), '/crm/selections')
      expect(text()).toContain('Loading your selections…')
      root.unmount()
    } finally { api.get = real }
  })
})
