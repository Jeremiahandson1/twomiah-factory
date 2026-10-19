// The bar vertical's switches (verticals/bar/settings.ts, from templates/crm-bar): /api/loyalty is the bar's Regulars,
// not the salon's programme; the header search finds the menu and the taps; home is the events dashboard; the lead
// platforms are not the trades' marketplaces.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>
let token = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
// The Factory sets a bar's features (the owner's switch only offers the registry's crm-bar list).
const features = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list }).where(eq(t.schema.company.id, seeded.company.id))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'bar' })
  seeded = await seedOwner(t)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
}, 60_000)

describe('bar', () => {
  test("/api/loyalty is the bar's Regulars (CrmSettings.loyalty 'bar'): a guest by contact, a reward list", async () => {
    await features(['contacts', 'loyalty_rewards'])
    // The bar's reads a guest by their contact id and answers "not a member yet"; the salon's would 404 a member id.
    const [guest] = await t.db.insert(t.schema.contact).values({ companyId: seeded.company.id, name: 'Pat Kowalski', type: 'client', phone: '7155550142' }).returning()
    const r = await as(`/api/loyalty/members/${guest.id}`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ member: null, history: [] })
    const rewards = await as('/api/loyalty/rewards')
    expect(rewards.status).toBe(200)
    expect(await rewards.json()).toEqual({ data: [], pagination: { page: 1, limit: 0, total: 0, pages: 0 } })
  }, 30_000)

  test('the header search finds a menu item (86 shown) and a tap, where the menu is on', async () => {
    await features(['contacts', 'bar_menu'])
    const item = await as('/api/bar/menu/items', { method: 'POST', json: { name: 'Friday Fish Fry', priceCents: 1499, is86ed: true } })
    expect(item.status).toBe(201)
    expect((await as('/api/bar/taps', { method: 'POST', json: { lineNumber: 3, beerName: 'Spotted Cow', price: '5.50' } })).status).toBe(201)
    const found = (await (await as('/api/search?q=fish')).json()).results
    expect(found.some((x: any) => x.type === 'item' && x.name === 'Friday Fish Fry' && x.description === 'Menu · 86' && x.url === '/crm/menu')).toBe(true)
    const taps = (await (await as('/api/search?q=spotted')).json()).results
    expect(taps.some((x: any) => x.type === 'tap' && x.description === 'Tap 3')).toBe(true)
    // With the menu off, neither is searched.
    await features(['contacts'])
    expect((await (await as('/api/search?q=fish')).json()).results.some((x: any) => x.type === 'item')).toBe(false)
  }, 30_000)

  test('home is the events dashboard (CrmSettings.dashboard events)', async () => {
    await features(['contacts', 'dashboard', 'event_bookings', 'invoices'])
    const r = await as('/api/dashboard/stats')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Object.keys(body.pipeline)).toEqual(['enquiry', 'tentative', 'confirmed', 'completed', 'lost', 'cancelled'])
  }, 30_000)

  test("lead sources: a bar connects Yelp, not Angi (templates/crm-bar routes/leads.ts, T42)", async () => {
    await features(['contacts', 'lead_inbox'])
    const angi = await as('/api/leads/sources', { method: 'POST', json: { platform: 'angi' } })
    expect(angi.status).toBe(400)
    expect((await as('/api/leads/sources', { method: 'POST', json: { platform: 'yelp' } })).status).toBe(201)
  }, 30_000)
})
