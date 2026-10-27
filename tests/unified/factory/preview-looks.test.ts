// The free preview and the signup take the look a visitor chose (foundry, heritage or studio). The preview of a trade
// the unified app is open to is drawn by the unified renderer; a bad look is refused; the choice is kept with the
// signup and reaches the new site's row. Only the Factory database is a stand-in; nothing here reaches a live API.
import { test, expect, mock, beforeAll, describe } from 'bun:test'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fakeStore } from './fakeStore'
import { provisionBody } from '../../../apps/api/src/unified/factory'
import { provisionSchema } from '../../../apps/unified/server/modules/provision'
import { bootTenant } from '../../../apps/unified/tests/harness'

const store = fakeStore({ tenants: [] })
const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
let app: any
let n = 0

beforeAll(async () => {
  Object.assign(process.env, {
    UNIFIED_SIGNUPS: 'test', UNIFIED_LIVE_VERTICALS: 'contractor,fieldservice,landscaping,roofing,homecare,restaurant,bar,salon,basic',
    SIGNUP_WEBSITE_ENGINE: 'premium',
  })
  const authPath = '../../../apps/api/src/middleware/auth'
  const real = await import(authPath)
  mock.module(authPath, () => ({ ...real, supabase: store, requireRole: () => async (_c: any, next: any) => next() }))
  const { registerIntakeRoutes } = await import('../../../apps/api/src/routes/factory/intake')
  app = new Hono()
  registerIntakeRoutes(app as any)
})

// A fresh address each time: the route's own rate limit (6 per ten minutes per address) is exercised on purpose below.
const post = (p: string, json: unknown, ip = '10.0.0.' + ++n) =>
  app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(json) })
const preview = (over: Record<string, unknown> = {}, ip?: string) =>
  post('/public/preview', { businessName: 'Westridge Roofing', businessType: 'roofing', city: 'Eau Claire', state: 'WI', ...over }, ip)

const FONTS: Record<string, string> = { foundry: 'Barlow+Condensed', heritage: 'Instrument+Serif', studio: 'Plus+Jakarta' }

describe('POST /public/preview', () => {
  test('a trade the unified app is open to is drawn in each of the three looks', async () => {
    for (const design of ['foundry', 'heritage', 'studio']) {
      const res = await preview({ design })
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain(FONTS[design])
      expect(html).toContain('Westridge Roofing')
      for (const other of Object.keys(FONTS).filter((d) => d !== design)) expect(html).not.toContain(FONTS[other])
    }
  })

  test('the same business in two looks is two pages: the cache key includes the look', async () => {
    const a = await (await preview({ businessName: 'Cache Test Roofing', design: 'foundry' })).text()
    const b = await (await preview({ businessName: 'Cache Test Roofing', design: 'studio' })).text()
    const again = await (await preview({ businessName: 'Cache Test Roofing', design: 'foundry' })).text()
    expect(a).not.toBe(b)
    expect(again).toBe(a)
  })

  test('no look chosen: the trade’s own default, none of the three', async () => {
    const html = await (await preview({ businessName: 'Default Look Roofing' })).text()
    for (const f of Object.values(FONTS)) expect(html).not.toContain(f)
  })

  test('home care and a restaurant are drawn in the looks too', async () => {
    for (const businessType of ['home_care', 'restaurant']) {
      const html = await (await preview({ businessName: 'Hearthside ' + businessType, businessType, design: 'heritage' })).text()
      expect(html).toContain(FONTS.heritage)
    }
  })

  test('a design that is not one of the three is refused, as is one of the other designs', async () => {
    for (const design of ['nonsense', 'bar', 'classic', 42, {}]) {
      const res = await preview({ design })
      expect(res.status).toBe(422)
      expect(((await res.json()) as any).error).toBe('Unknown design.')
    }
  })

  test('a trade the unified app is not open to keeps its own preview, whatever look is asked', async () => {
    const res = await preview({ businessName: 'Paws Veterinary', businessType: 'veterinary', design: 'foundry' })
    expect(res.status).toBe(200)
    expect(await res.text()).not.toContain(FONTS.foundry)
  })

  test('the rate limit is as it was: the seventh preview from one address is refused', async () => {
    const ip = '10.9.9.9'
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await preview({ businessName: 'Limit Roofing ' + i, design: 'foundry' }, ip)).status)
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 429])
  })

  test('the names are still stripped of markup', async () => {
    const html = await (await preview({ businessName: 'Zed<script>alert(1)</script> Roofing', design: 'studio' })).text()
    expect(html).not.toContain('<script>alert(1)')
  })
})

describe('POST /public/signup', () => {
  test('a design that is not one of the three is refused before anything is written', async () => {
    const before = store.writes.length
    const res = await post('/public/signup', { name: 'Westridge Roofing', email: 'o@westridge.example', industry: 'roofing', design: 'nonsense' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error).toBe('Unknown design.')
    expect(store.writes.length).toBe(before)
    expect(store.tables.tenants).toHaveLength(0)
  })

  test('a chosen look is kept with the signup (intake_data.signup.design), validated by the same rule', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dir, '../../../apps/api/src/routes/factory/intake.ts'), 'utf8')
    const signup = src.slice(src.indexOf("factory.post('/public/signup'"), src.indexOf("factory.get('/public/signup/:id/next'"))
    expect(signup).toContain('requestedLook(body.design)')
    expect(signup).toContain('...(look.design ? { design: look.design } : {})')
    // …inside the signup object the build reads, which is what unified/factory.ts chosenLook reads it from
    expect(signup.slice(signup.indexOf('signup: {'))).toContain('look.design')
  })
})

describe('the new site gets the look', () => {
  const HASH = '$2b$04$' + 'a'.repeat(53)
  const tenant = (signup: Record<string, unknown> | null) => ({
    id: 't1', slug: 'westridge', name: 'Westridge Roofing', industry: 'roofing', email: 'o@westridge.example', products: ['website'], features: [],
    intake_data: signup ? { signup } : {},
  })
  const siteOf = (t: any) => (provisionBody(t, { company: { plan: 'starter' } }, HASH) as any).site

  test('the provision body’s site carries the signup’s look, and the app’s schema accepts it', () => {
    for (const design of ['foundry', 'heritage', 'studio']) {
      const body: any = provisionBody(tenant({ design }), { company: { plan: 'starter' } }, HASH)
      expect(body.site.design).toBe(design)
      const parsed = provisionSchema.safeParse(body)
      expect(parsed.success && parsed.data.site?.design).toBe(design)
    }
  })

  test('no look chosen, or one that is no longer a choice: the site carries none, so it takes the vertical’s own', () => {
    expect(siteOf(tenant(null)).design).toBeUndefined()
    expect(siteOf(tenant({ goals: [] })).design).toBeUndefined()
    expect(siteOf(tenant({ design: 'bar' })).design).toBeUndefined()
  })
})

describe('a signup’s look reaches the new site’s row (the Factory’s body, through the unified app’s own provision)', () => {
  test('Studio chosen at signup: the business’s site row says studio, and its public page is drawn in it', async () => {
    const t = await bootTenant({ vertical: 'roofing' })
    process.env.FACTORY_SYNC_KEY = 'look-chain-key'
    const hash = await Bun.password.hash('Owner-pass-1-long', 'bcrypt')
    const tenant = { id: 't9', slug: 'westridge', name: 'Westridge Roofing', industry: 'roofing', email: 'o@westridge.example', state: 'WI', products: ['website'], features: [], intake_data: { signup: { goals: [], design: 'studio' } } }
    const res = await t.call('/api/internal/provision', { method: 'POST', json: provisionBody(tenant, { company: { plan: 'starter' } }, hash), headers: { 'X-Factory-Key': 'look-chain-key' } })
    expect(res.status).toBe(201)
    const [site] = await t.db.select().from(t.schema.website)
    expect(site.design).toBe('studio')
    expect(await (await t.call('/')).text()).toContain('Plus+Jakarta')
  })
})
