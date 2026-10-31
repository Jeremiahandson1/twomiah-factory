// The job form, in a DOM (brief item 4): where a trade needs a customer the field says so, the form will not post a new job
// without one (and says why), and a saved job with no customer shows a prompt but still saves other changes. Where the
// setting is off the form is what it was. (happy-dom: no headless browser is installed on this machine.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/jobs' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const { default: JobsPage } = await import(P + 'jobs/JobsPage.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

function fakeApi(jobs: any[]) {
  const calls: { m: string; url: string; body?: any }[] = []
  return {
    calls,
    get: async (url: string) => {
      calls.push({ m: 'GET', url })
      if (url === '/api/jobs') return { data: jobs, pagination: { pages: 1, total: jobs.length } }
      const one = jobs.find((j) => url === `/api/jobs/${j.id}`)
      if (one) return one
      if (url === '/api/contacts') return { data: [{ id: 'c1', name: 'Casey Customer', type: 'client' }] }
      return { data: [] }
    },
    post: async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return {} },
    put: async (url: string, body?: any) => { calls.push({ m: 'PUT', url, body }); return {} },
    delete: async () => ({}),
  }
}
async function mount(api: any, config: any, entry: string) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const errors: string[] = []
  const toast = { success: () => {}, error: (m: string) => { errors.push(m) } }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [entry] }, h(JobsPage, { api, toast, config }))) })
  await settle()
  return { root, errors }
}
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const titleBox = () => document.querySelector('[role="dialog"] input') as any
const typeInto = async (el: any, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true }))
  })
}

describe('the job form where a customer is needed', () => {
  const on = { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' }, requireCustomer: true, customerWord: 'customer' }

  test('the field is marked, and Create without a customer posts nothing and says why', async () => {
    const api = fakeApi([])
    const { root, errors } = await mount(api, on, '/crm/jobs?new=true')
    expect(text()).toContain('Customer *')
    expect(text()).toContain('Pick a customer...')
    await typeInto(titleBox(), 'Fix the gutter')
    await click(button('Create'))
    expect(api.calls.filter((c) => c.m === 'POST')).toHaveLength(0)
    expect(errors).toEqual(['Pick the customer this job is for.'])
    act(() => root.unmount())
  }, 30_000)

  test("a saved job with no customer shows the prompt, and still saves other changes", async () => {
    const old = { id: 'j1', number: 'JOB-00001', title: 'Old job', status: 'scheduled', priority: 'normal', contactId: null, contact: null }
    const api = fakeApi([old])
    const { root, errors } = await mount(api, on, '/crm/jobs?edit=j1')
    expect(text()).toContain('has no customer yet')
    await typeInto(titleBox(), 'Old job, renamed')
    await click(button('Update'))
    const put = api.calls.find((c) => c.m === 'PUT')
    expect(put?.url).toBe('/api/jobs/j1')
    expect(put?.body.title).toBe('Old job, renamed')
    expect(errors).toEqual([])
    act(() => root.unmount())
  }, 30_000)

  test('emptying the customer of a job that has one is stopped before it posts', async () => {
    const has = { id: 'j2', number: 'JOB-00002', title: 'Has customer', status: 'scheduled', priority: 'normal', contactId: 'c1', contact: { name: 'Casey Customer' } }
    const api = fakeApi([has])
    const { root, errors } = await mount(api, on, '/crm/jobs?edit=j2')
    const select = document.querySelector('[role="dialog"] select[required]') as any
    await act(async () => { select.value = ''; select.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await click(button('Update'))
    expect(api.calls.filter((c) => c.m === 'PUT')).toHaveLength(0)
    expect(errors).toEqual(['Pick the customer this job is for.'])
    act(() => root.unmount())
  }, 30_000)
})

describe('where it is off', () => {
  test('the field is the plain Contact picker and a job posts without one, as before', async () => {
    const api = fakeApi([])
    const { root, errors } = await mount(api, { labels: { singular: 'Job', plural: 'Jobs', add: 'New Job' } }, '/crm/jobs?new=true')
    expect(text()).not.toContain('Customer *')
    expect(text()).toContain('Contact')
    await typeInto(titleBox(), 'Fix the gutter')
    await click(button('Create'))
    expect(api.calls.filter((c) => c.m === 'POST')).toHaveLength(1)
    expect(errors).toEqual([])
    act(() => root.unmount())
  }, 30_000)
})
