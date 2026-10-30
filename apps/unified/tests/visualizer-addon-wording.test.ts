// Brief item 11: the Exterior Visualizer is a PAID ADD-ON (off by default, needs the Visualizer address) — nowhere a customer
// reads is it described as part of the plan. Covers the Features list the server sends (contractor + roofing), the Features page a
// builder reads (shared tenant-ui screen: its sentence changes only for a trade that lists a paid add-on), and the Factory
// wizard's texts. (happy-dom: no headless browser here.)
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { bootTenant, seedOwner } from './harness.ts'

const win: any = new Window({ url: 'https://crm.example.com/crm/settings/features' })
for (const k of Object.getOwnPropertyNames(win)) if (!(k in globalThis)) (globalThis as any)[k] = win[k]
;(globalThis as any).window = win; (globalThis as any).document = win.document; (globalThis as any).navigator = win.navigator
;(globalThis as any).localStorage = win.localStorage
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React as any
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const { FeaturesSettingsPage } = await import('../../../packages/tenant-ui/src/shell/FeaturesSettingsPage.tsx') as any
const h = React.createElement as any
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const text = () => document.body.textContent || ''
const root = (p: string) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')

describe('what the server lists', () => {
  for (const vertical of ['contractor', 'roofing'] as const) {
    test(`${vertical}: the Visualizer is listed as a paid add-on`, async () => {
      const t = await bootTenant({ vertical })
      const seeded = await seedOwner(t)
      const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
      const r = await t.call('/api/company/features/catalog', { headers: { Authorization: `Bearer ${token}` } })
      const v = ((await r.json()) as any).features.find((f: any) => f.id === 'visualizer')
      expect(v).toBeTruthy()
      expect(v.description.toLowerCase()).toContain('paid add-on')
      expect(v.description.toLowerCase()).not.toContain('included')
    }, 120_000)
  }
})

async function mountPage(catalog: any[]) {
  document.body.innerHTML = ''
  const el = document.createElement('div'); document.body.appendChild(el)
  const api = { get: async (u: string) => (u === '/api/company/features/catalog' ? { template: 'crm', features: catalog } : u === '/api/company' ? { enabledFeatures: [] } : null), put: async () => ({}) }
  const auth = { user: { role: 'owner' }, isAdmin: true, company: { enabledFeatures: [] }, checkAuth: async () => {} }
  const toast = { success() {}, error() {} }
  const r = createRoot(el)
  await act(async () => { r.render(h(MemoryRouter, null, h(FeaturesSettingsPage, { api, auth, toast }))) })
  await settle()
  return r
}
const CORE = { id: 'jobs', name: 'Jobs', description: 'Work orders', category: 'Core', core: true }
const PRICEBOOK = { id: 'pricebook', name: 'Pricebook', description: 'Flat-rate prices', category: 'Finance', core: false }
const VIS = { id: 'visualizer', name: 'Exterior Visualizer', description: 'Paid add-on (extra cost) — AI-powered exterior visualization', category: 'Add-on Products', core: false }

describe('the Features page', () => {
  test('a trade with the Visualizer: the page says paid add-ons are extra and tags the row', async () => {
    const r = await mountPage([CORE, PRICEBOOK, VIS])
    expect(text()).toContain('Every feature except the paid add-ons is included')
    expect(text()).toContain('Paid add-ons cost extra')
    const row = [...document.querySelectorAll('div')].find((d: any) => d.textContent?.startsWith('Exterior Visualizer') && d.querySelector('span'))
    expect(row?.textContent).toContain('Paid add-on')
    expect(text()).not.toContain('Every feature is included in your plan')
    act(() => r.unmount())
  })

  test('a trade without one: the sentence is as it was, and no row is tagged', async () => {
    const r = await mountPage([CORE, PRICEBOOK])
    expect(text()).toContain('Every feature is included in your plan')
    expect(text()).not.toContain('Paid add-on')
    act(() => r.unmount())
  })
})

describe('the Factory wizard', () => {
  const features = root('apps/platform/src/components/factory/StepFeatures.tsx')
  const products = root('apps/platform/src/components/factory/StepProducts.tsx')
  test('the Full Site preset no longer lists the Visualizer among the pages it gives', () => {
    const line = features.split('\n').find((l) => l.includes("id: 'full-site'")) || ''
    expect(line).toContain('Exterior Visualizer is a paid add-on')
    expect(line).not.toContain('testimonials, visualizer')
  })
  test('the Visualizer feature and the Vision product both say paid add-on', () => {
    expect(features.split('\n').find((l) => l.includes("id: 'visualizer'")) || '').toContain('Paid add-on')
    expect(products.split('\n').find((l) => l.includes("id: 'vision'")) || '').toContain('paid add-on')
  })
})
