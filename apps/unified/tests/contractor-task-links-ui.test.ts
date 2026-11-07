// Contractor parity row 7 (part c), the Gantt page in a DOM: with task_links each task says what it waits on, a planner links a
// task to another of the project's, and unlinks it; a reader sees the links and no controls; off, none of it. (happy-dom.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/gantt-charts' })
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
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const mod = await import(W + 'crm/pages/GanttChartsPage.tsx') as any
const GanttChartsPage = mod.default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

const TASKS = [
  { id: 't1', projectId: 'p1', name: 'Footings', startDate: '2026-05-04T00:00:00.000Z', endDate: '2026-05-06T00:00:00.000Z', progress: 0 },
  { id: 't2', projectId: 'p1', name: 'Framing', startDate: '2026-05-09T00:00:00.000Z', endDate: '2026-05-17T00:00:00.000Z', progress: 0 },
  { id: 't3', projectId: 'p1', name: 'Roofing', startDate: '2026-05-18T00:00:00.000Z', endDate: '2026-05-20T00:00:00.000Z', progress: 0 },
]
const PROJECT = { id: 'p1', name: 'Addition', startDate: '2026-05-04T00:00:00.000Z', endDate: '2026-05-20T00:00:00.000Z', status: 'active', percentComplete: 0, tasks: TASKS, links: [{ id: 'l1', predecessorId: 't1', successorId: 't2', type: 'finish_to_start', lagDays: 2 }] }

function stub(project: any = PROJECT) {
  const calls: { m: string; url: string; body?: any }[] = []
  const real = { get: api.get, post: api.post, delete: api.delete }
  api.get = async (url: string) => { calls.push({ m: 'GET', url }); return { data: [project] } }
  api.post = async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return { id: 'l2', moved: [{ name: 'Roofing' }] } }
  api.delete = async (url: string) => { calls.push({ m: 'DELETE', url }); return {} }
  return { calls, undo: () => Object.assign(api, real) }
}
async function mount(features: string[], permissions = ['projects:read', 'projects:update']) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const auth = { user: { id: 'u1', role: 'owner' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) }
  await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(ToastProvider, null, h(ConfirmProvider, null, h(MemoryRouter, null, h(PermissionsProvider, { role: 'manager', permissions }, h(GanttChartsPage))))))) })
  await settle()
  return root
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const setSelect = async (el: any, value: string) => { await act(async () => { el.value = value; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }
const submit = async (form: any) => { await act(async () => { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })) }); await settle() }

describe('the words', () => {
  test('after / with, and the lag in days', () => {
    expect(mod.linkWords({ type: 'finish_to_start', lagDays: 2 }, 'Footings')).toBe('after Footings + 2 days')
    expect(mod.linkWords({ type: 'start_to_start', lagDays: 0 }, 'Footings')).toBe('with Footings')
    expect(mod.linkWords({ type: 'finish_to_start', lagDays: -1 }, 'Footings')).toBe('after Footings − 1 day')
  })
})

describe('the Gantt page', () => {
  test('on: the link shows on the task that waits; a planner links another and is told what moved; unlinks', async () => {
    const s = stub()
    try {
      const root = await mount(['gantt_charts', 'task_links'])
      const shown = [...document.querySelectorAll('[data-testid="task-link"]')].map((n: any) => n.textContent)
      expect(shown).toEqual(['after Footings + 2 days'])
      await click(document.querySelector('button[aria-label="Link Roofing to the task it waits on"]'))
      const form = document.querySelector('form[aria-label="Link Roofing"]') as any
      expect([...form.querySelectorAll('#link-pred-p1 option')].map((o: any) => o.textContent)).toEqual(['Choose…', 'Footings', 'Framing'])
      await setSelect(form.querySelector('#link-pred-p1'), 't2')
      await submit(form)
      expect(s.calls.find((c) => c.m === 'POST')).toMatchObject({ url: '/api/gantt-charts/p1/links', body: { predecessorId: 't2', successorId: 't3', type: 'finish_to_start', lagDays: 0 } })
      expect(text()).toContain('Moved with it: Roofing')
      await click(document.querySelector('button[aria-label="Unlink Framing"]'))
      expect(s.calls.find((c) => c.m === 'DELETE')?.url).toBe('/api/gantt-charts/links/l1')
      root.unmount()
    } finally { s.undo() }
  })

  test('a reader sees the link, and no link controls', async () => {
    const s = stub()
    try {
      const root = await mount(['gantt_charts', 'task_links'], ['projects:read'])
      expect(document.querySelectorAll('[data-testid="task-link"]').length).toBe(1)
      expect(document.querySelector('button[aria-label^="Link "]')).toBeNull()
      expect(document.querySelector('button[aria-label^="Unlink "]')).toBeNull()
      root.unmount()
    } finally { s.undo() }
  })

  test('off: no links shown and no Link buttons, even if the server sent links', async () => {
    const s = stub()
    try {
      const root = await mount(['gantt_charts'])
      expect(document.querySelector('[data-testid="task-link"]')).toBeNull()
      expect(document.querySelector('button[aria-label^="Link "]')).toBeNull()
      root.unmount()
    } finally { s.undo() }
  })
})
