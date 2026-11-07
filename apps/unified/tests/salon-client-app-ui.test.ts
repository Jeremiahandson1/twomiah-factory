// Salon parity row 25, the screens in a DOM (happy-dom): the portal adds the app's manifest and worker only when the salon has the app, and
// offers "Add to home screen" only when the browser offers to install; the owner's card flips the directory listing.
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://glow.example.com/portal/Tok_abc-1234567' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const P = '../../../packages/tenant-ui/src/'
const { ToastProvider } = await import(P + 'ui/Toast.tsx') as any
const W = '../web/src/'
const { api } = await import(W + 'api.ts') as any
const { ClientAppInstall, ClientAppSettings } = await import(W + 'crm/pages/salon/ClientAppPanels.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const mount = async (el: any) => { document.body.innerHTML = ''; const d = document.createElement('div'); document.body.appendChild(d); const root = createRoot(d); await act(async () => { root.render(h(ToastProvider, null, el)) }); await settle(); return root }

describe('the client app on screen', () => {
  test('off: nothing added to the page', async () => {
    ;(globalThis as any).fetch = async () => new win.Response('{}', { status: 404 })
    const root = await mount(h(ClientAppInstall, { token: 'Tok_abc-1234567' }))
    expect(document.querySelector('link[rel="manifest"]')).toBeNull()
    root.unmount()
  })

  test('on: the manifest for this client and the salon’s colour; the install offer once the browser makes it', async () => {
    const asked: string[] = []
    ;(globalThis as any).fetch = async (url: string) => { asked.push(url); return new win.Response(JSON.stringify({ theme_color: '#7c3aed' }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
    const root = await mount(h(ClientAppInstall, { token: 'Tok_abc-1234567' }))
    expect(asked[0]).toBe('/api/client-app/manifest.webmanifest?t=Tok_abc-1234567')
    expect((document.querySelector('link[rel="manifest"]') as any).getAttribute('href')).toBe('/api/client-app/manifest.webmanifest?t=Tok_abc-1234567')
    expect((document.querySelector('meta[name="theme-color"]') as any).getAttribute('content')).toBe('#7c3aed')
    expect(document.body.textContent).not.toContain('Add to home screen')
    let prompted = false
    const ev: any = new win.Event('beforeinstallprompt', { cancelable: true })
    ev.prompt = async () => { prompted = true }
    await act(async () => { win.dispatchEvent(ev) })
    await settle()
    const btn = [...document.querySelectorAll('button')].find((b: any) => b.textContent === 'Add to home screen') as any
    expect(btn).toBeTruthy()
    await act(async () => { btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
    await settle()
    expect(prompted).toBe(true)
    root.unmount()
    expect(document.querySelector('link[rel="manifest"]')).toBeNull()
  })

  test('the owner’s card: the directory switch', async () => {
    const real = { get: api.get, put: api.put }
    const puts: any[] = []
    api.get = async () => ({ directoryListing: false })
    api.put = async (url: string, body: any) => { puts.push({ url, body }); return { directoryListing: body.directoryListing } }
    try {
      const root = await mount(h(ClientAppSettings, {}))
      const box = document.querySelector('[data-testid="client-app-settings"] input[type="checkbox"]') as any
      expect(box.checked).toBe(false)
      await act(async () => { box.click() })
      await settle()
      expect(puts).toEqual([{ url: '/api/client-app-settings', body: { directoryListing: true } }])
      root.unmount()
    } finally { Object.assign(api, real) }
  })
})
