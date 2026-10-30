// Brief item 11: the Exterior Visualizer is a PAID ADD-ON (off by default, needs the Visualizer address) — nowhere a customer
// reads is it described as part of the plan. Covers the Features list the server sends (contractor + roofing) and the Factory
// wizard's texts. (The owner's Features page switch — "Paid add-on", no switch, server refuses — is engine's commit 00238c898;
// this branch no longer touches that page.)
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { bootTenant, seedOwner } from './harness.ts'

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
