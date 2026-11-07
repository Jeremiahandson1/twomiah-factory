// The crew's page in Spanish (roofing row 27; roofing live test 11/07: "Add photos" stayed in English). Every fixed word on the page
// goes through its Spanish list when the office chose Spanish; the scope is the office's own Spanish one (server crewLink.ts).
import { test, expect } from 'bun:test'
import { Window } from 'happy-dom'

const win: any = new Window({ url: 'https://roofer.example.com/w/tok123' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const ORDER = {
  language: 'es', title: 'Tear-off', scope: 'Quitar y reemplazar', address: '1200 Main St', startDate: '2026-11-17', recipientName: 'Carlos', status: 'accepted',
  company: { name: null, phone: null }, materials: [], photos: [{ id: 'p1', url: '/m/a.jpg', caption: null }], completionPhotos: [],
  respondedByName: 'Carlos', rejectReason: null, completedAt: null, completionNote: null,
  can: { accept: false, reject: false, photos: true, complete: true, arrive: true, leave: false }, cancelled: false, checklist: [], checks: {},
}
;(globalThis as any).fetch = async () => new Response(JSON.stringify(ORDER), { status: 200, headers: { 'Content-Type': 'application/json' } })
const React: any = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = (await import('react-router-dom')) as any
const PAGE = '../web/src/crm/pages/roof/field/CrewLinkPage.tsx'
const Page = ((await import(PAGE)) as any).default

test('a Spanish crew page has no English fixed words left', async () => {
  const el = document.createElement('div'); document.body.appendChild(el)
  await act(async () => { createRoot(el).render(React.createElement(MemoryRouter, { initialEntries: ['/w/tok123'] }, React.createElement(Routes, null, React.createElement(Route, { path: '/w/:token', element: React.createElement(Page) })))) })
  for (let i = 0; i < 20 && !el.textContent?.includes('Quitar'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  const text = el.textContent || ''
  expect(text).toContain('Agregar fotos')
  expect(text).toContain('Orden de trabajo')
  for (const en of ['Add photos', 'Work order', 'Your photos', 'Photos from the office', 'Mark this work done']) expect(text).not.toContain(en)
  expect(el.querySelector('img')?.getAttribute('alt')).toBe('Foto del trabajo')
  // The start date in Spanish too (re-check 11/07: "Inicio Tuesday, November 17, 2026").
  expect(text).toContain('noviembre')
  expect(text).not.toContain('November')
})

test('the lead-in the app puts on a scope made from a proposal is Spanish; the office words after it stay as written', async () => {
  const { spanishLeadIn } = await import('../server/crm/roof/crewLink.ts')
  expect(spanishLeadIn('From signed proposal QTE-00001 — Roof replacement:\n• Tear off')).toBe('De la propuesta firmada QTE-00001 — Roof replacement:\n• Tear off')
  expect(spanishLeadIn('Just the office text')).toBe('Just the office text')
  expect(spanishLeadIn(null)).toBeNull()
})
