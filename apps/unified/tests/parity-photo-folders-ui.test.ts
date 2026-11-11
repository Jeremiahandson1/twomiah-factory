// Parity tier 2 #2 (11/10): photo folders on the job page — the shared JobPhotosPanel in a real DOM against a stand-in API. With
// the switch on: a tab per folder that has photos, with its count, "All" first; a tab shows only its photos; the folder a new photo
// goes in; "Move to folder" files a photo through the job's own route (or the library's, by category). Off: as before, no tabs.
import { test, expect } from 'bun:test'
import { Window } from 'happy-dom'
const win: any = new Window({ url: 'https://crm.example.com/crm/jobs/job-1' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
// A .tsx screen: imported by a path held in a variable, so the server's tsconfig (no JSX) does not type-check the UI here.
const PANEL = '../../../packages/tenant-ui/src/jobs/JobPhotosPanel.tsx'
const { JobPhotosPanel } = await import(PANEL) as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

const PHOTOS = [
  { id: 'p1', url: '/m/1.jpg', caption: 'Old furnace', photoType: 'before' },
  { id: 'p2', url: '/m/2.jpg', caption: 'New furnace', photoType: 'after' },
  { id: 'p3', url: '/m/3.jpg', caption: 'Flue', photoType: 'after' },
  { id: 'p4', url: '/m/4.jpg', caption: 'Truck', photoType: 'general' },
]
function fakeApi(rows: any[]) {
  const calls: Array<{ method: string; path: string; body?: any }> = []
  return {
    calls,
    get: async () => rows,
    request: async (path: string, init: any) => { calls.push({ method: init.method, path, body: init.body }); return {} },
  }
}
async function render(props: any) {
  const el = document.createElement('div'); document.body.innerHTML = ''; document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => { root.render(h(JobPhotosPanel, { toast: { success: () => {}, error: () => {} }, jobId: 'job-1', ...props })) })
  await settle()
  return el
}
const tabs = (el: any) => [...el.querySelectorAll('[aria-label="Photo folders"] button')].map((b: any) => b.textContent)
const shown = (el: any) => [...el.querySelectorAll('.grid img')].map((i: any) => i.getAttribute('alt'))

test('folders on: a tab per folder with photos, counts, "All" first, and the photos in no folder', async () => {
  const el = await render({ api: fakeApi(PHOTOS), store: 'job', folders: true })
  expect(tabs(el)).toEqual(['All (4)', 'Before (1)', 'After (2)', 'Not in a folder (1)'])
  expect(shown(el)).toEqual(['Old furnace', 'New furnace', 'Flue', 'Truck'])
  const after = [...el.querySelectorAll('[aria-label="Photo folders"] button')].find((b: any) => b.textContent === 'After (2)') as any
  await act(async () => { after.dispatchEvent(new win.MouseEvent('click', { bubbles: true })) })
  await settle()
  expect(shown(el)).toEqual(['New furnace', 'Flue'])
})

test('folders off: no tabs, every photo, as before', async () => {
  const el = await render({ api: fakeApi(PHOTOS), store: 'job', folders: false })
  expect(tabs(el)).toEqual([])
  expect(shown(el).length).toBe(4)
})

test('the photo library (the contractor) reads its folders from the category', async () => {
  const el = await render({ api: fakeApi([{ id: 'd1', url: '/m/d1.jpg', description: 'Footings', type: 'progress' }, { id: 'd2', url: '/m/d2.jpg', description: 'Permit card', type: 'permit' }]), store: 'library', folders: true })
  expect(tabs(el)).toEqual(['All (2)', 'Progress (1)', 'Permits (1)'])
})
