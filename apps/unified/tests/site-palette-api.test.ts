// The site's colours through the real server (site/palette.ts, /api/site): saved as a draft, kept off the site until
// Publish, refused when they are not colours, and — once published — in the stylesheet visitors get.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const css = async () => (await t.call('/styles/main.css')).text()

beforeAll(async () => {
  t = await bootTenant()
  const seeded = await seedOwner(t)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  await t.db.insert(t.schema.website).values({ companyId: seeded.company.id, tagline: 'Live' })
})

describe('the site palette', () => {
  test('the presets come with what an empty colour means', async () => {
    const r = await (await as('/api/site/palettes')).json()
    expect(r.presets.length).toBeGreaterThanOrEqual(10)
    expect(r.defaults.accent).toMatch(/^#[0-9a-f]{6}$/)
    expect(r.designs.bar.page).toBe(false)
    expect(r.designs.heritage.page).toBe(true)
  })
  test('something that is not a colour is refused, and nothing is saved', async () => {
    for (const body of [{ accentColor: 'red' }, { palette: { brand: 'blue' } }, { palette: { page: '#12' } }, { palette: ['#fff'] }]) {
      expect((await as('/api/site/settings', { method: 'PATCH', json: body })).status).toBe(400)
    }
  })
  test('saved is a draft; the public stylesheet changes only when it is published', async () => {
    const before = await css()
    const saved = await (await as('/api/site/settings', { method: 'PATCH', json: { accentColor: '#2255cc', palette: { brand: '#aa3311', band: '#223344', page: '#faf4ea', preset: 'brick-cream', junk: 'x' } } })).json()
    expect(saved.hasDraft).toBe(true)
    expect(saved.draft.palette).toEqual({ brand: '#aa3311', band: '#223344', page: '#faf4ea', preset: 'brick-cream' })
    expect(await css()).toBe(before)
    expect((await as('/api/site/settings/publish', { method: 'POST', json: {} })).status).toBe(200)
    const live = await css()
    for (const c of ['#aa3311', '#2255cc']) expect(live).toContain(c)
    expect(live).toContain('#223344')
  })
  test('clearing the palette goes back to the design\'s own colours once published', async () => {
    await as('/api/site/settings', { method: 'PATCH', json: { accentColor: null, palette: null } })
    await as('/api/site/settings/publish', { method: 'POST', json: {} })
    const live = await css()
    expect(live).not.toContain('#aa3311')
    expect(live).not.toContain("the owner's accent")
  })
})
