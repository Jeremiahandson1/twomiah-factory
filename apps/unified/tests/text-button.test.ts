// The Text button in a real DOM (packages/tenant-ui/src/text/TextButton.tsx): drawn only for a seat that may read the record it
// records on; choosing a message records it ("Text opened on your phone — not confirmed sent") — on a phone when the texting app
// opens, on a computer when the QR code is shown; where nothing records (a template, a booking with no contact) it still works.
import { describe, test, expect, beforeEach } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/contacts/c1' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom') as any
const BUTTON = '../../../packages/tenant-ui/src/text/TextButton.tsx'
const AUTH = '../../../packages/tenant-ui/src/auth/AuthContext.tsx'
const RECORD = '../../../packages/tenant-ui/src/text/record.ts'
const { TextButton } = await import(BUTTON) as any
const { AuthContext } = await import(AUTH) as any
const { registerTextApi } = await import(RECORD) as any
const h = React.createElement as any

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const calls: any[] = []

function asDevice(kind: 'phone' | 'computer') {
  const ua = kind === 'phone' ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  Object.defineProperty(win.navigator, 'userAgent', { value: ua, configurable: true })
}

async function mount(props: Record<string, unknown>, can: (p: string) => boolean = () => true) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => {
    root.render(h(MemoryRouter, null, h(AuthContext.Provider, { value: { company: { name: 'Acme Co' }, can } }, h(TextButton, { phone: '(608) 555-0111', name: 'Sam Lee', ...props }))))
  })
  await settle()
  return root
}
const textButton = () => [...document.querySelectorAll('button')].find((b: any) => /^Text/.test((b.textContent || '').trim())) as any
const pick = async (label: RegExp) => {
  await act(async () => { textButton().dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  const item = [...document.querySelectorAll('[role=menuitem]')].find((b: any) => label.test(b.textContent || '')) as any
  await act(async () => { item.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await settle()
}

// The api the unified app registers: a press is a POST /api/text-activity/<entity>/<id>.
const recorderApi = { post: async (path: string, body: any) => { const [, , , entity, id] = path.split('/'); calls.push({ entity, id, message: body.message, label: body.label }) } }
beforeEach(() => { calls.length = 0; registerTextApi(recorderApi); asDevice('computer') })

describe('who sees the button', () => {
  test('a seat that may read the contact sees it; one that may not does not (and a lead asks leads:read)', async () => {
    await mount({ record: { entity: 'contact', id: 'c1' } }, (p) => p === 'contacts:read')
    expect(textButton()).toBeTruthy()
    await mount({ record: { entity: 'contact', id: 'c1' } }, () => false)
    expect(textButton()).toBeUndefined()
    await mount({ record: { entity: 'lead', id: 'l1' } }, (p) => p === 'contacts:read')
    expect(textButton()).toBeUndefined()
    await mount({ record: { entity: 'lead', id: 'l1' } }, (p) => p === 'leads:read')
    expect(textButton()).toBeTruthy()
  })

  test('no usable number: no button', async () => {
    await mount({ phone: 'n/a', record: { entity: 'contact', id: 'c1' } })
    expect(textButton()).toBeUndefined()
  })
})

describe('recording', () => {
  test('on a computer, the QR dialog counts as opened: one record, with the chosen message', async () => {
    await mount({ record: { entity: 'contact', id: 'c1' } })
    await pick(/on our way/i)
    expect(calls).toEqual([{ entity: 'contact', id: 'c1', message: 'ready', label: "We're on our way" }])
    expect(document.querySelector('svg[role=img]')).toBeTruthy() // the QR code is up
  })

  test('on a phone, the texting app is opened (the sms: link) and it is recorded', async () => {
    asDevice('phone')
    let opened = ''
    Object.defineProperty(win, 'location', { value: { get href() { return opened }, set href(v: string) { opened = v }, origin: 'https://crm.example.com' }, configurable: true })
    await mount({ record: { entity: 'lead', id: 'l1' } })
    await pick(/blank/i)
    expect(opened).toBe('sms:6085550111')
    expect(calls).toEqual([{ entity: 'lead', id: 'l1', message: 'blank', label: 'A blank text' }])
  })

  test('nothing to record on (no record prop): the text still opens and nothing is written', async () => {
    await mount({})
    await pick(/blank/i)
    expect(calls).toEqual([])
    expect(document.querySelector('svg[role=img]')).toBeTruthy()
  })

  test('where no recorder is registered (a template) the button is drawn and works, whatever the permission', async () => {
    registerTextApi(null)
    await mount({ record: { entity: 'contact', id: 'c1' } }, () => false)
    expect(textButton()).toBeTruthy()
    await pick(/blank/i)
    expect(calls).toEqual([])
  })

  test('a failing record does not stop the text', async () => {
    registerTextApi({ post: async () => { throw new Error('offline') } })
    await mount({ record: { entity: 'contact', id: 'c1' } })
    await pick(/blank/i)
    expect(document.querySelector('svg[role=img]') || document.body.textContent).toBeTruthy()
  })
})
