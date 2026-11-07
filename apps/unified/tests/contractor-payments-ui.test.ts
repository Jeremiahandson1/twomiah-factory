// Contractor parity row 12 (part b), the screens in a DOM: the customer's pay window offers the plan's next installment first and
// then a tip (none, a share, or typed); without either it is as it was; the office's panel beside an invoice splits it into a plan
// and sets card / bank, and a reader changes nothing. Server half: contractor-payments.test.ts. (happy-dom.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/portal/x' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const P = '../../../packages/tenant-ui/src/'
const { PortalPaymentModal } = await import(P + 'portal/PaymentForm.tsx') as any
const { AuthContext } = await import(P + 'auth/AuthContext.tsx') as any
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const { PermissionsProvider } = await import(P + 'auth/PermissionsContext.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const { InvoicePaymentsPanel } = await import(W + 'crm/invoicePaymentsPanel.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any
async function mount(node: any) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(node) })
  await settle()
  return root
}

describe('the customer’s pay window', () => {
  test('the next installment first, then a tip; the form is asked for both', async () => {
    const calls: any[] = []
    ;(globalThis as any).fetch = async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init?.body || '{}') }); return new Response(JSON.stringify({ error: 'stop here' }), { status: 400 }) }
    const root = await mount(h(PortalPaymentModal, { isOpen: true, onClose: () => {}, invoiceId: 'i1', amount: 3000, portalToken: 'tok', allowPart: true, tips: true, next: { dueDate: '2026-12-01', owed: 1000 } }))
    expect(document.body.textContent).toContain('This installment, $1,000.00 (due 2026-12-01)')
    expect((document.querySelector('input[name="pay-amount"]') as any).checked).toBe(true) // the installment is chosen first
    const go = [...document.querySelectorAll('button')].filter((b: any) => !/Cancel/.test(b.textContent)).pop() as any
    await click(go)
    expect(document.querySelector('[data-testid="tip-step"]')).toBeTruthy()
    await click(button('15% · $150.00'))
    expect(calls[0].body).toMatchObject({ invoiceId: 'i1', amount: 1000, tip: 150, portalToken: 'tok' })
    root.unmount()
  })

  test('without tips or a plan: no tip step, the whole balance', async () => {
    const calls: any[] = []
    ;(globalThis as any).fetch = async (url: string, init: any) => { calls.push(JSON.parse(init?.body || '{}')); return new Response(JSON.stringify({ error: 'stop here' }), { status: 400 }) }
    const root = await mount(h(PortalPaymentModal, { isOpen: true, onClose: () => {}, invoiceId: 'i1', amount: 500, portalToken: 'tok' }))
    expect(document.querySelector('[data-testid="tip-step"]')).toBeNull()
    expect(calls[0]).toEqual({ invoiceId: 'i1', amount: 500, portalToken: 'tok' })
    root.unmount()
  })
})

describe('the office’s panel', () => {
  const stub = () => {
    const calls: any[] = []
    const real = { get: api.get, put: api.put, delete: api.delete }
    api.get = async (url: string) => { calls.push({ m: 'GET', url }); return { installments: [], next: null } }
    api.put = async (url: string, body: any) => { calls.push({ m: 'PUT', url, body }); return url.endsWith('/methods') ? { paymentMethods: body.paymentMethods } : { installments: body.installments.map((i: any, n: number) => ({ id: String(n), ...i, state: 'due' })) } }
    return { calls, undo: () => Object.assign(api, real) }
  }
  const mountPanel = (perms: string[], features = ['payment_plans', 'payment_method_choice']) => mount(h(AuthContext.Provider, { value: { user: { id: 'u' }, company: {}, can: () => true, hasFeature: (f: string) => features.includes(f) } },
    h(ToastProvider, null, h(PermissionsProvider, { role: 'manager', permissions: perms }, h(InvoicePaymentsPanel, { invoiceId: 'i1', total: 3000, status: 'sent' })))))
  const setSelect = async (el: any, v: string) => { await act(async () => { el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }

  test('split into three monthly installments and saved; bank only', async () => {
    const s = stub()
    try {
      const root = await mountPanel(['invoices:read', 'invoices:update'])
      await click(button('3 monthly'))
      expect(document.body.textContent).toContain('Adds up to $3,000.00 of $3,000.00')
      await click(button('Save plan'))
      const put = s.calls.find((c) => c.m === 'PUT' && c.url.endsWith('/plan'))
      expect(put.body.installments.map((i: any) => i.amount)).toEqual([1000, 1000, 1000])
      await setSelect(document.querySelector('select[aria-label="How the customer may pay online"]'), 'bank')
      expect(s.calls.find((c) => c.url.endsWith('/methods'))?.body).toEqual({ paymentMethods: 'bank' })
      root.unmount()
    } finally { s.undo() }
  })

  test('a reader changes nothing; off, no panel', async () => {
    const s = stub()
    try {
      let root = await mountPanel(['invoices:read'])
      expect(button('3 monthly')).toBeUndefined()
      expect((document.querySelector('select[aria-label="How the customer may pay online"]') as any).disabled).toBe(true)
      root.unmount()
      root = await mountPanel(['invoices:read', 'invoices:update'], [])
      expect(document.querySelector('[data-testid="invoice-payments-panel"]')).toBeNull()
      root.unmount()
    } finally { s.undo() }
  })
})
