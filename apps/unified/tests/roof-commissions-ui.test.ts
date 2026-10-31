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

describe('plans for the job’s other people', () => {
  test('the plan form offers every role and net profit, and sends exactly what was chosen', async () => {
    const { api, calls } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: null }, 'POST /api/commissions/plans': (b: any) => ({ id: 'p2', ...b }) })
    const root = await mount(api)
    await click(tab('Plans'))
    await click(Array.from(document.querySelectorAll('button')).find((b) => /New plan/.test(b.textContent || '')))
    const sel = (has: string) => (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find((s) => Array.from(s.options).some((o) => o.value === has))!
    const auto = sel('job_sales_rep')
    expect(Array.from(auto.options).map((o) => o.value)).toEqual(['none', 'job_assignee', 'job_creator', 'job_sales_rep', 'job_estimator', 'job_canvasser', 'job_office', 'job_production_manager', 'job_sales_manager'])
    await act(async () => { auto.value = 'job_sales_manager'; auto.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    const measured = sel('net_profit')
    expect(Array.from(measured.options).map((o) => o.value)).toEqual(['contract', 'gross_profit', 'net_profit'])
    await act(async () => { measured.value = 'net_profit'; measured.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    await inputValue(document.querySelector('input[required]:not([type=number])'), 'Sales manager override')
    await submit('Create')
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/commissions/plans')?.body).toMatchObject({ planType: 'percent_of_invoice', autoEarn: 'job_sales_manager', measuredOn: 'net_profit' })
    root.unmount()
  })
})

describe('the job’s commission people card', () => {
  const W = '../web/src/'
  async function mountCard(permissions: string[]) {
    const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
    const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
    const { api } = await import(W + 'api.ts') as any
    const Card = (await import(W + 'crm/pages/roof/jobs/JobCommissionPeople.tsx') as any).default
    const calls: Call[] = []
    const real = { get: api.get, put: api.put }
    api.get = async (url: string, params?: any) => { calls.push({ method: 'GET', path: url, body: params }); return { data: [{ id: 'r1', role: 'estimator', userId: 'u2' }] } }
    api.put = async (url: string, body?: any) => { calls.push({ method: 'PUT', path: url, body }); return { data: body.people.map((p: any, i: number) => ({ id: `n${i}`, ...p })) } }
    document.body.innerHTML = ''
    const el = document.createElement('div'); document.body.appendChild(el)
    const root = createRoot(el)
    const users = [{ id: 'u1', firstName: 'Pat', lastName: 'Manager' }, { id: 'u2', firstName: 'Eva', lastName: 'Estimator' }]
    const auth = { user: { id: 'u1', role: 'owner' }, company: {}, hasFeature: () => true }
    await act(async () => { root.render(h(AuthContext.Provider, { value: auth }, h(PermissionsProvider, { role: 'manager', permissions }, h(ToastProvider, null, h(MemoryRouter, null, h(Card, { jobId: 'j1', users })))))) })
    await settle()
    return { root, calls, undo: () => Object.assign(api, real) }
  }

  test('shows who holds each role, adds a production manager, and saves the whole set', async () => {
    const { root, calls, undo } = await mountCard(['jobs:dispatch', 'commissions:read'])
    expect(text()).toContain('Commission people')
    expect(text()).toContain('Eva Estimator')
    const add = document.querySelector('select[aria-label="Add a Production manager"]') as HTMLSelectElement
    await act(async () => { add.value = 'u1'; add.dispatchEvent(new win.Event('change', { bubbles: true })) })
    await settle()
    expect(text()).toContain('Pat Manager')
    await click(Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Save'))
    const put = calls.find((c) => c.method === 'PUT')
    expect(put?.path).toBe('/api/job-people/j1')
    expect(put?.body.people).toEqual([{ role: 'estimator', userId: 'u2' }, { role: 'production_manager', userId: 'u1' }])
    root.unmount(); undo()
  })

  test('a seat that cannot dispatch reads the people and has no way to change them', async () => {
    const { root, undo } = await mountCard(['commissions:read'])
    expect(text()).toContain('Eva Estimator')
    expect(document.querySelectorAll('select').length).toBe(0)
    expect(document.querySelector('button[aria-label^="Take"]')).toBeNull()
    root.unmount(); undo()
  })
})

const pick = async (select: HTMLSelectElement, value: string) => {
  await act(async () => { select.value = value; select.dispatchEvent(new win.Event('change', { bubbles: true })) })
  await settle()
}
const selectWith = (value: string) => (Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]).find((s) => Array.from(s.options).some((o) => o.value === value))!

describe('earlier triggers and draws (row 3)', () => {
  test('the plan form says when a plan is ready, offers $0 balance only for an early one, and sends both', async () => {
    const { api, calls } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: null }, 'POST /api/commissions/plans': (b: any) => ({ id: 'p1', ...b }) })
    const root = await mount(api)
    await click(tab('Plans'))
    await click(Array.from(document.querySelectorAll('button')).find((b) => /New plan/.test(b.textContent || '')))
    await pick(selectWith('job_sales_rep'), 'job_sales_rep')
    const when = selectWith('approved')
    expect(Array.from(when.options).map((o) => o.value)).toEqual(['collected', 'invoiced', 'completed', 'approved'])
    expect(text()).not.toContain('Only when nothing is owing')
    await pick(when, 'invoiced')
    expect(text()).toContain('Only when nothing is owing')
    await click(document.querySelector('input[type=checkbox][class=""], label input[type=checkbox]:not([value])') as Element)
    await inputValue(document.querySelector('input[required]:not([type=number])'), 'On invoice')
    await submit('Create')
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/commissions/plans')
    expect(post?.body).toMatchObject({ autoEarn: 'job_sales_rep', triggerOn: 'invoiced', zeroBalanceOnly: true })
    root.unmount()
  })

  test('a plan on profit is not offered Approved', async () => {
    const { api } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: null } })
    const root = await mount(api)
    await click(tab('Plans'))
    await click(Array.from(document.querySelectorAll('button')).find((b) => /New plan/.test(b.textContent || '')))
    await pick(selectWith('job_sales_rep'), 'job_sales_rep')
    await pick(selectWith('gross_profit'), 'gross_profit')
    expect(Array.from(selectWith('invoiced').options).map((o) => o.value)).toEqual(['collected', 'invoiced', 'completed'])
    root.unmount()
  })

  test('Give a draw sends the job, person, plan and amount to the draws route', async () => {
    const { api, calls } = fakeApi({
      ...BASE_ROUTES,
      '/api/commissions/plans': { data: [{ id: 'pl1', name: 'Rep 8%', planType: 'percent_of_invoice', percentRate: '8', autoEarn: 'job_sales_rep', isActive: true, userIds: [] }] },
      '/api/company/users': { data: [{ id: 'u1', firstName: 'Rita', lastName: 'Seat', isActive: true, role: 'field' }] },
      '/api/jobs': { data: [{ id: 'j1', number: 'J-1', title: 'Roof' }] },
      '/api/roof-money/settings': { minProfit: null },
      'POST /api/commission-draws': (b: any) => ({ id: 'd1', ...b }),
    })
    const root = await mount(api)
    await click(Array.from(document.querySelectorAll('button')).find((b) => /Give a draw/.test(b.textContent || '')))
    await pick(selectWith('j1'), 'j1')
    await pick(selectWith('u1'), 'u1')
    await pick(selectWith('pl1'), 'pl1')
    await inputValue(document.querySelector('input[min="0.01"]'), '300')
    await submit('Give draw')
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/commission-draws')
    expect(post?.body).toEqual({ jobId: 'j1', userId: 'u1', planId: 'pl1', amount: 300 })
    root.unmount()
  })

  test('a seat that cannot create commissions is not offered a draw', async () => {
    const { api } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: null } })
    const root = await mount(api, ['commissions:read'])
    expect(text()).not.toContain('Give a draw')
    root.unmount()
  })
})

describe('the job on every line (row 4)', () => {
  test('the earnings table and the statement show the job number on each line, and a dash where there is none', async () => {
    const lines = [
      { id: 'c1', userName: 'Rita Seat', userId: 'u1', jobId: 'j1', jobNumber: 'JOB-00042', baseAmount: '10000', rateApplied: '8', commissionAmount: '800', earnedAt: '2026-10-30T12:00:00', status: 'pending', source: 'auto' },
      { id: 'c2', userName: 'Rita Seat', userId: 'u1', jobId: null, jobNumber: null, baseAmount: '0', rateApplied: null, commissionAmount: '25', earnedAt: '2026-10-30T12:00:00', status: 'pending', source: 'manual' },
    ]
    const { api } = fakeApi({
      ...BASE_ROUTES,
      '/api/commissions': { data: lines },
      '/api/company/users': { data: [{ id: 'u1', firstName: 'Rita', lastName: 'Seat', isActive: true, role: 'field' }] },
      '/api/commissions/statement': { person: { id: 'u1', name: 'Rita Seat' }, from: null, to: null, lines, totals: { pending: 825, approved: 0, paid: 0, disputed: 0, owed: 825 } },
    })
    const root = await mount(api)
    const heads = Array.from(document.querySelectorAll('th')).map((th) => th.textContent)
    expect(heads).toContain('Job')
    const rows = Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.textContent || '')
    expect(rows.some((r) => r.includes('JOB-00042'))).toBe(true)
    await click(tab('Statements'))
    await click(Array.from(document.querySelectorAll('button')).find((b) => /^(Show|Run|View|Load)/.test((b.textContent || '').trim())))
    expect(Array.from(document.querySelectorAll('th')).filter((th) => th.textContent === 'Job').length).toBeGreaterThan(0)
    expect(text()).toContain('JOB-00042')
    root.unmount()
  })
})

describe('who sees commissions (row 4)', () => {
  test('the Rules tab lists the roles, starts from the company’s choice and sends exactly the roles ticked', async () => {
    const { api, calls } = fakeApi({
      ...BASE_ROUTES,
      '/api/roof-money/settings': { minProfit: null, commissionViewerRoles: ['manager'] },
      'PUT /api/roof-money/settings': (b: any) => ({ minProfit: null, ...b }),
    })
    const root = await mount(api)
    await click(tab('Rules'))
    expect(text()).toContain('Who sees commissions')
    const boxes = Array.from(document.querySelectorAll('fieldset input[type=checkbox]')) as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([true, false, false])
    await click(boxes[1]); await click(boxes[0])
    const forms = Array.from(document.querySelectorAll('form'))
    const form = forms.find((f) => f.textContent?.includes('Who sees commissions'))!
    await act(async () => { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })) })
    await settle()
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/api/roof-money/settings')
    expect(put?.body).toEqual({ commissionViewerRoles: ['field'] })
    root.unmount()
  })

  test('a seat that can only read the rules sees the choice and cannot change it', async () => {
    const { api } = fakeApi({ ...BASE_ROUTES, '/api/roof-money/settings': { minProfit: null, commissionViewerRoles: ['manager', 'viewer'] } })
    const root = await mount(api, ['commissions:read'])
    await click(tab('Rules'))
    const boxes = Array.from(document.querySelectorAll('fieldset input[type=checkbox]')) as HTMLInputElement[]
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, true], [false, true], [true, true]])
    root.unmount()
  })
})
