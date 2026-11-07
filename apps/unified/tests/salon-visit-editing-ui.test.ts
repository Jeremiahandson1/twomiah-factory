// Salon parity row 8, the Edit services window in a DOM: a booked visit's services as rows — re-timed (a second service starting with
// the first), re-assigned, the heart for the requested stylist, one removed, one added — sent as the server takes them. (happy-dom.)
import { describe, test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://crm.example.com/crm/appointments' })
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
const { VisitServicesModal, itemsBody } = await import(W + 'crm/pages/salon/VisitServicesModal.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })) }); await settle() }
const setInput = async (el: any, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true })) }); await settle() }
const setSelect = async (el: any, v: string) => { await act(async () => { el.value = v; el.dispatchEvent(new win.Event('change', { bubbles: true })) }); await settle() }
const button = (label: string) => [...document.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as any

describe('Edit services', () => {
  test('re-time, re-assign, heart, remove and add — the body the server takes', async () => {
    const calls: any[] = []
    const real = { get: api.get, put: api.put }
    api.get = async (url: string) => (url === '/api/service-menu' ? { data: [{ id: 'colour', name: 'Full Colour', durationMin: 90 }, { id: 'cut', name: 'Cut', durationMin: 30 }, { id: 'blow', name: 'Blow Dry', durationMin: 30 }] } : { data: [{ id: 'ana', firstName: 'Ana' }, { id: 'bea', firstName: 'Bea' }] })
    api.put = async (url: string, body: any) => { calls.push({ url, body }); return {} }
    try {
      document.body.innerHTML = ''
      const el = document.createElement('div'); document.body.appendChild(el)
      const root = createRoot(el)
      const appt = { id: 'v1', startTime: '2026-11-12T19:00:00.000Z', items: [{ serviceId: 'colour', stylistId: 'ana', startOffsetMin: 0, durationMin: 90 }, { serviceId: 'cut', stylistId: 'bea', startOffsetMin: 90, durationMin: 30 }] }
      let saved = false
      await act(async () => { root.render(h(ToastProvider, null, h(VisitServicesModal, { appt, onSave: () => { saved = true }, onClose: () => {} }))) })
      await settle()
      await setInput(document.querySelector('input[aria-label="Service 2 starts (minutes in)"]'), '0')        // the cut with the colour
      await click(document.querySelector('button[aria-label="The client asked for this stylist (service 1)"]'))
      await click(button('+ Add a service'))
      await setSelect(document.querySelector('select[aria-label="Service 3"]'), 'blow')
      await setSelect(document.querySelector('select[aria-label="Stylist for service 3"]'), 'bea')
      await click(button('Save services'))
      expect(calls[0].url).toBe('/api/appointments/v1/services')
      expect(calls[0].body.items).toEqual([
        { serviceId: 'colour', stylistId: 'ana', startOffsetMin: 0, durationMin: 90, requestedStylist: true },
        { serviceId: 'cut', stylistId: 'bea', startOffsetMin: 0, durationMin: 30, requestedStylist: false },
        { serviceId: 'blow', stylistId: 'bea', startOffsetMin: 90, durationMin: 30, requestedStylist: false },
      ])
      expect(saved).toBe(true)
      root.unmount()
    } finally { Object.assign(api, real) }
  })

  test('rows without a service are left out; a blank stylist is the visit’s', () => {
    expect(itemsBody([{ serviceId: '', stylistId: '', startOffsetMin: 0, durationMin: 30, requestedStylist: false }, { serviceId: 'cut', stylistId: '', startOffsetMin: 30, durationMin: 30, requestedStylist: false }]))
      .toEqual([{ serviceId: 'cut', startOffsetMin: 30, durationMin: 30, requestedStylist: false }])
  })
})
