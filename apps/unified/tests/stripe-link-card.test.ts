// Settings › Integrations' Stripe card (packages/tenant-ui settings/IntegrationsPage.tsx), in a real DOM: the two ways
// in — "I already have a Stripe account" and "Create a new Stripe account" — are drawn only when the server says linking
// can work (stripe.linkAvailable); otherwise the one Connect Stripe button, as before. Back from Stripe, ?stripe=<outcome>
// is said in plain words once and taken off the address. (Owner, 2026-10-25; the server half is stripe-link.test.ts.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/settings/integrations' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, useLocation } = await import('react-router-dom') as any
// .tsx screens by a path in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const PAGE = '../../../packages/tenant-ui/src/settings/IntegrationsPage.tsx'
const CONFIRM = '../../../packages/tenant-ui/src/ui/ConfirmProvider.tsx'
const { IntegrationsPage } = await import(PAGE) as any
const { ConfirmProvider } = await import(CONFIRM) as any
const h = React.createElement as any

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

let seenPath = ''
function Where() { const l = useLocation(); seenPath = l.pathname + l.search; return null }

async function mount(stripe: Record<string, unknown>, entry = '/crm/settings/integrations') {
  document.body.innerHTML = ''
  win.history.replaceState(null, '', entry)
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  const api = {
    get: async (p: string) => (p === '/api/integrations/status' ? { stripe, quickbooks: { connected: false, configured: false }, sms: {}, email: {}, twilio: {} } : {}),
    post: async () => ({}), put: async () => ({}), delete: async () => ({}),
  }
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [entry] }, h(ConfirmProvider, null, h(Where), h(IntegrationsPage, { api, config: { hasFeature: (f: string) => f === 'online_payments' } }))))
  })
  await settle()
  const buttons = [...document.querySelectorAll('button')].map((b: any) => (b.textContent || '').trim())
  return { root, buttons, text: document.body.textContent || '' }
}

describe('the Stripe card', () => {
  test('linking offered: both choices, each named plainly', async () => {
    const m = await mount({ connected: false, chargesEnabled: false, configured: true, linkAvailable: true })
    expect(m.buttons).toContain('I already have a Stripe account')
    expect(m.buttons).toContain('Create a new Stripe account')
    expect(m.buttons).not.toContain('Connect Stripe')
    m.root.unmount()
  })

  test('not offered (no client id on the Factory): only Connect Stripe, as before', async () => {
    const m = await mount({ connected: false, chargesEnabled: false, configured: true, linkAvailable: false })
    expect(m.buttons).toContain('Connect Stripe')
    expect(m.buttons).not.toContain('I already have a Stripe account')
    m.root.unmount()
  })

  test('a linked account with setup left finishes it in its own Stripe dashboard', async () => {
    const m = await mount({ connected: true, chargesEnabled: false, configured: true, linked: true })
    expect(m.text).toContain('Finish setup in your Stripe dashboard')
    expect(m.buttons).not.toContain('Finish setup')
    m.root.unmount()
  })

  test('back from Stripe: the outcome in words, then off the address', async () => {
    const ok = await mount({ connected: true, chargesEnabled: true, configured: true, linked: true }, '/crm/settings/integrations?stripe=linked')
    expect(ok.text).toContain('Your Stripe account is linked.')
    expect(seenPath).toBe('/crm/settings/integrations')
    ok.root.unmount()
    const other = await mount({ connected: false, chargesEnabled: false, configured: true, linkAvailable: true }, '/crm/settings/integrations?stripe=other_platform')
    expect(other.text).toContain('run by another software company')
    other.root.unmount()
  })
})
