// Salon parity row 25 — the salon's own client app and its directory listing (Fresha, Vagaro, Boulevard; feature salon_client_app, not ready;
// server/crm/salon/clientApp.ts). The client portal installable in the salon's name, colour and icon, opening on that client's own portal;
// a service worker that caches nothing; a directory card only once the salon opts in, with nothing about any client; no commission.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const PASSWORD = 'Client-app-1107'

describe('salon: the client app and the directory listing', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* not json */ }
    return { status: r.status, body, headers: r.headers }
  }
  const pub = async (path: string) => { const r = await t.call(path); const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* not json */ } return { status: r.status, body, headers: r.headers } }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }

  beforeAll(async () => {
    process.env.SITE_URL = 'https://glow.example.com'
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ name: 'Glow Hair Studio', primaryColor: '#7c3aed', phone: '715-555-0100', address: '214 Water St', city: 'Eau Claire', state: 'WI', zip: '54703' } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const u = (await t.db.insert(t.schema.user).values({ email: 'sty@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Sty', lastName: 'List', role: 'field', companyId: co } as any).returning() as any[])[0]
    tokens.stylist = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: u.email, password: PASSWORD } })).json()) as any).accessToken
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Private Consult', category: 'other', durationMin: 30, price: 0 })).status).toBe(201)   // not online
  }, 120_000)

  test('off: no app files, no listing, no switch', async () => {
    expect((await pub('/api/client-app/manifest.webmanifest?t=abcdefgh1234')).status).toBe(404)
    expect((await pub('/api/client-app/listing')).status).toBe(404)
    expect((await as('owner', '/api/client-app-settings')).status).not.toBe(200)
  })

  test('on: the app in the salon’s name and colour, opening on the client’s own portal; a worker that caches nothing', async () => {
    await features([...FEATURES, 'salon_client_app'])
    const m = await pub('/api/client-app/manifest.webmanifest?t=Tok_abc-1234567')
    expect(m.status).toBe(200)
    expect(m.body).toMatchObject({ name: 'Glow Hair Studio', short_name: 'Glow Hair St', start_url: '/portal/Tok_abc-1234567', scope: '/portal/', display: 'standalone', theme_color: '#7c3aed' })
    // a token that is not one opens the portal's front door, never an address someone typed
    expect((await pub('/api/client-app/manifest.webmanifest?t=../../evil')).body.start_url).toBe('/portal/')
    const sw = await t.call('/api/client-app/sw.js')
    expect(sw.headers.get('service-worker-allowed')).toBe('/portal/')
    const code = await sw.text()
    expect(code).toContain("addEventListener('push'")
    expect(code).not.toContain("addEventListener('fetch'")
    const icon = await (await t.call('/api/client-app/icon.svg')).text()
    expect(icon).toContain('fill="#7c3aed"')
    expect(icon).toContain('>G</text>')
  })

  test('the listing: only once the owner opts in; the booking page and its online services, nothing about any client, no commission', async () => {
    await t.db.update(t.schema.company).set({ settings: { keepMe: 1 } } as any).where(eq(t.schema.company.id, co))
    expect((await pub('/api/client-app/listing')).status).toBe(404)
    expect((await as('stylist', '/api/client-app-settings', 'PUT', { directoryListing: true })).status).toBe(403)
    expect((await as('owner', '/api/client-app-settings', 'PUT', { directoryListing: 'yes' })).status).toBe(400)
    expect((await as('owner', '/api/client-app-settings', 'PUT', { directoryListing: true })).body).toEqual({ directoryListing: true })
    const l = await pub('/api/client-app/listing')
    expect(l.status).toBe(200)
    expect(l.body).toMatchObject({ name: 'Glow Hair Studio', phone: '715-555-0100', bookingUrl: 'https://glow.example.com/book', commission: 'none',
      address: { street: '214 Water St', city: 'Eau Claire', region: 'WI', postalCode: '54703', country: 'US' } })
    expect(l.body.services).toEqual([{ name: 'Cut', minutes: 30, price: 40, priceIsFrom: false, url: 'https://glow.example.com/book/cut' }])
    expect(JSON.stringify(l.body)).not.toMatch(/email|contact|client/i)
    // the other settings on the company are kept
    expect((await as('owner', '/api/client-app-settings', 'PUT', { directoryListing: false })).body).toEqual({ directoryListing: false })
    expect(((await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, co))) as any[])[0].settings).toEqual({ keepMe: 1, clientApp: { directoryListing: false } })
    expect((await pub('/api/client-app/listing')).status).toBe(404)
  })
})
