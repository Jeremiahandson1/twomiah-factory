// Contractor parity row 10 (part a), the screens in a DOM (client_portal_plus, not ready): the office's Client portal panel on a
// project (what the client sees and is emailed about, sharing a daily log, a to-do for the client, answering a comment; a reader
// sees it and changes nothing), and the client's project page (to-dos ticked, the schedule commented on, daily logs, files).
// Server half: contractor-client-portal.test.ts. (happy-dom.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/projects/p1' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const P = '../../../packages/tenant-ui/src/'
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const { PortalProjectExtras } = await import(P + 'portal/PortalProjectExtras.tsx') as any
const Ctx = await import(P + 'portal/PortalContext.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const { ClientPortalPanel } = await import(W + 'crm/projects/ClientPortalPanel.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }
const setSelect = async (el: any, value: string) => { await act(async () => { el.value = value; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
async function mount(node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(node) })
  await settle()
  return root
}

const SETTINGS = { schedule: 'phases', scheduleWeeks: null, dailyLogs: true, photos: true, todos: true, payments: true, documents: true, shareByDefault: false, notify: {} }
function stubOffice() {
  const calls: { m: string; url: string; body?: any }[] = []
  const real = { get: api.get, post: api.post, put: api.put, delete: api.delete }
  api.get = async (url: string) => {
    calls.push({ m: 'GET', url })
    if (url.endsWith('/settings')) return SETTINGS
    if (url.startsWith('/api/daily-logs')) return { data: [{ dailyLog: { id: 'l1', date: '2026-11-02T00:00:00.000Z', workPerformed: 'Cabinets out', sharedWithClient: false } }] }
    if (url.startsWith('/api/documents')) return { data: [{ id: 'd1', name: 'Layout.pdf', sharedWithCustomer: true, mimeType: 'application/pdf' }] }
    if (url.endsWith('/sign-requests')) return { data: [{ id: 'sr1', title: 'Contract', status: 'signed', signedName: 'Lee Marsh', signedAt: '2026-11-03T00:00:00.000Z', signerIp: '203.0.113.7' }] }
    if (url.endsWith('/todos')) return { data: [{ id: 't1', title: 'Pick a colour', status: 'open', checklist: [{ text: 'Walls', done: true }, { text: 'Trim', done: false }] }] }
    if (url.endsWith('/payments')) return { contract: { value: 20000, source: 'quotes' }, scheduled: 2000, paid: 0, payments: [{ id: 'pay1', name: 'Deposit', amountType: 'percent', share: 10, amount: 2000, dueDate: null, state: 'scheduled', invoiceNumber: null }] }
    if (url.endsWith('/comments')) return { data: [{ id: 'c1', taskId: 'k1', taskName: 'Demolition', body: 'Keep the sink?', fromClient: true, createdAt: '' }] }
    return {}
  }
  api.put = async (url: string, body?: any) => { calls.push({ m: 'PUT', url, body }); return url.endsWith('/settings') ? { ...SETTINGS, ...body } : { told: 'not-asked' } }
  api.post = async (url: string, body?: any) => { calls.push({ m: 'POST', url, body }); return url.endsWith('/release') ? { invoice: { number: 'INV-00007' }, schedule: null } : {} }
  api.delete = async (url: string) => { calls.push({ m: 'DELETE', url }); return {} }
  return { calls, undo: () => Object.assign(api, real) }
}
const office = (perms: string[]) => h(MemoryRouter, null, officeInner(perms))
const officeInner = (perms: string[]) => h(ToastProvider, null, h(PermissionsProvider, { role: 'manager', permissions: perms }, h(ClientPortalPanel, { projectId: 'p1' })))

describe('the office’s panel', () => {
  test('a planner: changes what the client sees, shares a log, adds a to-do with a checklist, answers a comment', async () => {
    const s = stubOffice()
    try {
      const root = await mount(office(['projects:read', 'projects:update', 'invoices:create']))
      await setSelect(document.querySelector('select[aria-label="Schedule the client sees"]'), 'all')
      expect(s.calls.find((c) => c.m === 'PUT' && c.url.endsWith('/settings'))?.body).toEqual({ schedule: 'all' })
      await click(document.querySelector('input[aria-label="Share the log of ' + document.querySelector('[data-testid="share-daily-logs"] li')!.textContent!.split('Cabinets')[0] + '"]'))
      expect(s.calls.find((c) => c.url === '/api/client-portal/daily-logs/l1/share')?.body).toEqual({ shared: true })
      expect(document.querySelector('[data-testid="client-todos-office"]')!.textContent).toContain('1/2')
      await setInput(document.querySelector('input[aria-label="To-do title"]'), 'Sign off the layout')
      await act(async () => { const ta = document.querySelector('textarea[aria-label="To-do checklist"]') as any; Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'Read it\nSign it'); ta.dispatchEvent(new win.Event('input', { bubbles: true })) })
      await settle()
      await click(button('Add to-do'))
      expect(s.calls.find((c) => c.m === 'POST' && c.url.endsWith('/todos'))?.body).toEqual({ title: 'Sign off the layout', checklist: [{ text: 'Read it', done: false }, { text: 'Sign it', done: false }] })
      // documents to sign: the evidence shown, and a PDF sent
      expect(document.querySelector('[data-testid="sign-requests-office"]')!.textContent).toContain('Signed by Lee Marsh')
      expect(document.querySelector('[data-testid="sign-requests-office"]')!.textContent).toContain('from 203.0.113.7')
      await setSelect(document.querySelector('select[aria-label="PDF to sign"]'), 'd1')
      expect((document.querySelector('input[aria-label="Title to sign"]') as any).value).toBe('Layout')
      await click(button('Send to sign'))
      expect(s.calls.find((c) => c.url === '/api/client-portal/p1/sign-requests' && c.m === 'POST')?.body).toEqual({ documentId: 'd1', title: 'Layout' })
      // the payment schedule: a planner who may bill releases one
      expect(document.querySelector('[data-testid="payment-schedule-office"]')!.textContent).toContain('Contract $20,000.00')
      // Release raises and sends the invoice, so it asks first since e4ba6e1bc (contractor live test 11/07): the planner says yes.
      const ask = win.confirm; win.confirm = () => true
      try { await click(button('Release & invoice')) } finally { win.confirm = ask }
      expect(s.calls.find((c) => c.url === '/api/client-portal/payments/pay1/release')).toBeTruthy()
      await setInput(document.querySelector('input[aria-label="Answer on Demolition"]'), 'Yes')
      await click(button('Answer'))
      expect(s.calls.find((c) => c.url === '/api/client-portal/p1/tasks/k1/comments')?.body).toEqual({ body: 'Yes' })
      root.unmount()
    } finally { s.undo() }
  })

  test('a reader sees it all and can change nothing', async () => {
    const s = stubOffice()
    try {
      const root = await mount(office(['projects:read']))
      expect(document.querySelector('[data-testid="client-portal-panel"]')).toBeTruthy()
      expect(button('Release & invoice')).toBeUndefined()
      expect(button('Add payment')).toBeUndefined()
      expect((document.querySelector('select[aria-label="Schedule the client sees"]') as any).disabled).toBe(true)
      expect(button('Add to-do')).toBeUndefined()
      expect(button('Answer')).toBeUndefined()
      expect(button('Tell them the schedule changed')).toBeUndefined()
      root.unmount()
    } finally { s.undo() }
  })
})

describe('the client’s project page', () => {
  const EXTRAS = {
    toSign: [{ id: 'sr1', title: 'Contract', message: 'Please read page 2', status: 'sent', signedAt: null, signedName: null, signed: false }, { id: 'sr2', title: 'Change of scope', message: null, status: 'signed', signedAt: '2026-11-03T00:00:00.000Z', signedName: 'Lee Marsh', signed: true }],
    sections: { schedule: 'phases', dailyLogs: true, photos: true, todos: true },
    schedule: [{ id: 'k1', name: 'Demolition', startDate: '2026-11-02T00:00:00.000Z', endDate: '2026-11-05T00:00:00.000Z', progress: 50, status: 'in_progress', comments: [{ id: 'c1', body: 'Keep the sink?', fromClient: true, createdAt: null }, { id: 'c2', body: 'Yes', fromClient: false, createdAt: null }] }],
    dailyLogs: [{ id: 'l1', date: '2026-11-02T00:00:00.000Z', weather: 'Sunny', workPerformed: 'Cabinets out', workCompleted: null, photos: [{ id: 'ph1', caption: 'Bare wall' }] }],
    files: [{ id: 'd1', name: 'Layout.pdf', type: 'general', mimeType: 'application/pdf', createdAt: null, image: false }],
    todos: [{ id: 't1', title: 'Pick a colour', notes: null, checklist: [{ text: 'Walls', done: false }], dueDate: null, status: 'open', completedAt: null }],
    payments: { contract: 20000, paid: 2000, payments: [
      { id: 'a', name: 'Deposit', amount: 2000, dueDate: null, milestone: null, state: 'paid', invoiceId: 'i1', invoiceNumber: 'INV-1', balance: 0 },
      { id: 'b', name: 'Framing', amount: 5000, dueDate: null, milestone: { name: 'Framing', done: true }, state: 'due', invoiceId: 'i2', invoiceNumber: 'INV-2', balance: 5000 },
      { id: 'c', name: 'Finish', amount: 13000, dueDate: '2027-01-15T00:00:00.000Z', milestone: null, state: 'scheduled', invoiceId: null, invoiceNumber: null, balance: null },
    ] },
  }
  test('to-dos ticked, the schedule commented on, daily logs with photos, shared files', async () => {
    const calls: any[] = []
    const value = {
      token: 'tok', sections: { projectExtras: true }, config: {},
      fetch: async (path: string, init?: any) => { calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined }); return path.endsWith('/extras') ? EXTRAS : {} },
      url: (p: string) => `https://api.example.com/api/portal/p/tok${p}`,
    }
    const Provider = Ctx.PortalContext?.Provider
    expect(Provider).toBeTruthy()
    const root = await mount(h(MemoryRouter, null, h(Provider, { value }, h(PortalProjectExtras, { projectId: 'p1' }))))
    const pay = document.querySelector('[data-testid="client-payments"]')!
    expect(pay.textContent).toContain('$2,000.00 paid of $20,000.00')
    expect([...pay.querySelectorAll('a')].map((a: any) => [a.textContent, a.getAttribute('href')])).toEqual([['Pay $5,000.00', '/portal/tok/invoices/i2']])
    expect(pay.textContent).toContain('Coming up')
    const toSign = document.querySelector('[data-testid="client-to-sign"]')!
    expect([...toSign.querySelectorAll('a')].map((a: any) => [a.textContent, a.getAttribute('href')])).toEqual([['Read it', 'https://api.example.com/api/portal/p/tok/projects/p1/files/sign/sr1'], ['Signed copy', 'https://api.example.com/api/portal/p/tok/projects/p1/files/sign/sr2']])
    expect([...toSign.querySelectorAll('button')].map((b: any) => b.textContent)).toEqual(['Sign'])
    expect(toSign.textContent).toContain('Signed by Lee Marsh')
    expect(document.querySelector('[data-testid="client-schedule"]')!.textContent).toContain('Your builder: Yes')
    expect(document.querySelector('[data-testid="client-daily-logs"] img')!.getAttribute('src')).toBe('https://api.example.com/api/portal/p/tok/projects/p1/files/log-photo/l1:ph1')
    expect(document.querySelector('[data-testid="client-files"]')!.textContent).toContain('Layout.pdf')
    await click(document.querySelector('[data-testid="client-todos"] input[type="checkbox"]'))
    expect(calls.find((c) => c.path === '/projects/p1/todos/t1')?.body).toEqual({ item: 0, done: true })
    await setInput(document.querySelector('input[aria-label="Comment on Demolition"]'), 'Thanks')
    await click(button('Send'))
    expect(calls.find((c) => c.path === '/projects/p1/tasks/k1/comments')?.body).toEqual({ body: 'Thanks' })
    root.unmount()
  })
})
