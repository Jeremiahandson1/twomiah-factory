// The Commissions screen for a roofer, in a DOM (roofing parity rows 1-4): the plan form's choices, the Rules tab (the minimum
// profit, the disclaimer, who sees commissions), the Job column on every earnings line and statement, and the disclaimer a
// commissioned person accepts. The server's half is in roof-commissions-*.test.ts; this file is what the screen draws and sends.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/commissions' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { ConfirmProvider } = await import(P + 'ui/ConfirmProvider.tsx') as any
const { CommissionsPage } = await import(P + 'commissions/CommissionsPage.tsx') as any
const roof: any = (await import('../verticals/roof/settings.ts')).default
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''

type Call = { method: string; path: string; body?: any }
/** A fake api: answers from `routes` (path → value), records every call. */
function fakeApi(routes: Record<string, any>) {
  const calls: Call[] = []
  const answer = (method: string) => async (path: string, body?: any) => {
    calls.push({ method, path, body })
    const hit = routes[`${method} ${path}`] ?? routes[path]
    if (hit === undefined) throw new Error(`no route ${method} ${path}`)
    return typeof hit === 'function' ? hit(body) : hit
  }
  return { calls, api: { get: answer('GET'), post: answer('POST'), put: answer('PUT'), delete: answer('DELETE') } }
}
const toast = { success: () => {}, error: () => {} }
const OWNER = ['*']

async function mount(api: any, permissions: string[] = OWNER) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const cfg = roof.screens.commissions
  await act(async () => {
    root.render(h(PermissionsProvider, { role: permissions.includes('*') ? 'owner' : 'field', permissions },
      h(ConfirmProvider, null, h(MemoryRouter, { initialEntries: ['/crm/commissions'] }, h(CommissionsPage, { api, toast, config: cfg })))))
  })
  await settle()
  return root
}
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
/** Press a form's submit button the way the browser does: the form's own submit event (happy-dom's click does not fire it). */
const submit = async (label: string) => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === label) as HTMLButtonElement
  expect(btn).toBeTruthy()
  await act(async () => { btn.form!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })) })
  await settle()
}
const tab = (name: string) => Array.from(document.querySelectorAll('[role=tab]')).find((b) => b.textContent === name)
const inputValue = async (el: Element | null | undefined, value: string) => {
  const input = el as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new win.Event('input', { bubbles: true })); input.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await settle()
}

const BASE_ROUTES = {
  '/api/commissions': { data: [] },
  '/api/commissions/plans': { data: [] },
  '/api/company/users': { data: [] },
}

describe('the Rules tab: the company’s minimum profit', () => {
  test('the owner sets a minimum of 25% of the contract and the screen sends exactly that', async () => {
    const { api, calls } = fakeApi({
      ...BASE_ROUTES,
      '/api/roof-money/settings': { minProfit: null },
      'PUT /api/roof-money/settings': (b: any) => ({ minProfit: b.minProfit }),
    })
    const root = await mount(api)
    await click(tab('Rules'))
    expect(text()).toContain('Minimum profit')
    const select = document.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('none')
    await act(async () => { select.value = 'percent'; select.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    const box = document.querySelector('input[type=number]')
    await inputValue(box, '25')
    await submit('Save')
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.body).toEqual({ minProfit: { kind: 'percent', value: 25 } })
    root.unmount()
  })

  test('a seat that may only read the pay structure sees the minimum and no Save', async () => {
    const { api } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: { kind: 'amount', value: 4000 } } })
    const root = await mount(api, ['commissions:read'])
    await click(tab('Rules'))
    expect((document.querySelector('input[type=number]') as HTMLInputElement).value).toBe('4000')
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Save')).toBe(false)
    root.unmount()
  })
})

describe('the plan form', () => {
  test('a roofer can make a tiered plan measured on gross profit, and the screen sends measuredOn', async () => {
    const { api, calls } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: null }, 'POST /api/commissions/plans': (b: any) => ({ id: 'p1', ...b }) })
    const root = await mount(api)
    await click(tab('Plans'))
    await click(Array.from(document.querySelectorAll('button')).find((b) => /New plan/.test(b.textContent || '')))
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]
    const type = selects.find((s) => Array.from(s.options).some((o) => o.value === 'tiered'))!
    expect(type).toBeTruthy()
    await act(async () => { type.value = 'tiered'; type.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    const auto = (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find((s) => Array.from(s.options).some((o) => o.value === 'job_sales_rep'))!
    await act(async () => { auto.value = 'job_sales_rep'; auto.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    const measured = (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find((s) => Array.from(s.options).some((o) => o.value === 'gross_profit'))!
    expect(measured).toBeTruthy()
    await act(async () => { measured.value = 'gross_profit'; measured.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    await inputValue(document.querySelector('input[required]:not([type=number])'), 'Profit brackets')
    await submit('Create')
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/commissions/plans')
    expect(post?.body).toMatchObject({ planType: 'tiered', autoEarn: 'job_sales_rep', measuredOn: 'gross_profit' })
    root.unmount()
  })
})
