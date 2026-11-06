// Clients MUST choose a named stylist online (salon parity row 17; Timely): a third setting beside "optional" and "no choice" — "anyone" is not
// offered, no time shows until a stylist is chosen, and the server refuses a booking that names none (settings: Settings › The Book).
// booking/pages.ts). Off — the default — online booking goes to whoever is free and no forms are asked.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const PASSWORD = 'Pick-1030-xx'

describe('salon: online stylist choice required', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.3.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const pub = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { 'x-forwarded-for': `10.4.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(2, 6)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  const timesFor = async (slug: string, who = '') => ((await pub(`/api/book/services/${slug}/times?date=${day}${who ? `&who=${who}` : ''}`)).body.data ?? []).map((x: any) => x.time) as string[]
  const book = (slug: string, time: string, email: string, extra: Record<string, unknown> = {}) =>
    pub(`/api/book/services/${slug}`, 'POST', { date: day, time, name: 'Online Client', email, phone: '608-555-0111', ...extra })
  const booking = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0]
  const page = async (path: string) => { const r = await t.call(path); return { status: r.status, html: await r.text(), location: r.headers.get('location') } }
  const post = (path: string, fields: Record<string, string>) => t.call(path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() } as any)

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const key of ['ana', 'bea']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea } = ids as any)
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    // Each of them works Tuesdays 9–12.
    expect((await as('owner', '/api/booking/hours', 'PUT', { hours: [ana, bea].map((userId) => ({ userId, dayOfWeek: 2, start: '09:00', end: '12:00' })) })).status).toBe(200)
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 120, bookableOnline: true })).status).toBe(201)
  }, 120_000)

  test('"optional" first: with the pick on and nothing required, anyone still works', async () => {
    await features([...FEATURES, 'client_stylist_pick'])
    expect((await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })).status).toBe(200)
    const got = (await as('owner', '/api/appointments/online-stylist-pick')).body
    expect([got.onlineStylistPick, got.onlineStylistPickRequired]).toEqual([true, false])
    expect((await timesFor('cut')).length).toBeGreaterThan(0)
    expect((await book('cut', '09:00', 'any1@example.com')).status).toBe(201)
    expect((await page('/book/cut')).html).toContain('Anyone — first available')
  })

  test('required: only the owner sets it; it turns the pick on; "anyone" is not offered, no time shows, and a booking naming nobody is refused', async () => {
    expect((await as('ana', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPickRequired: true })).status).toBe(403)
    expect((await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPickRequired: 'yes' })).status).toBe(400)
    const on = await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPickRequired: true })
    expect([on.status, on.body.onlineStylistPick, on.body.onlineStylistPickRequired]).toEqual([200, true, true])
    // the page: the placeholder asks for a choice, "anyone" is gone, and the box is required
    const html = (await page('/book/cut')).html
    expect(html).not.toContain('Anyone — first available')
    expect(html).toContain('Choose your stylist')
    expect(html).toMatch(/<select id="book-who" name="who" required>/)
    // no day or time is offered until a stylist is chosen; with one chosen they are
    expect(await timesFor('cut')).toEqual([])
    expect((await pub('/api/book/services/cut/dates')).body.data ?? []).toEqual([])
    expect((await timesFor('cut', ana)).length).toBeGreaterThan(0)
    expect(((await pub(`/api/book/services/cut/dates?who=${ana}`)).body.data ?? []).length).toBeGreaterThan(0)
    // a booking that names nobody is refused in words; naming a stylist books
    const none = await book('cut', '10:00', 'none@example.com')
    expect(none.status).toBe(400)
    expect(JSON.stringify(none.body)).toContain('choose your stylist')
    const named = await book('cut', '10:00', 'named@example.com', { who: bea })
    expect(named.status).toBe(201)
    expect((await booking(named.body.token)).assignedUserId).toBe(bea)
  })

  test('turning the pick off turns "required" off with it, and anyone books again', async () => {
    const off = await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: false })
    expect([off.body.onlineStylistPick, off.body.onlineStylistPickRequired]).toEqual([false, false])
    expect((await book('cut', '11:00', 'back@example.com')).status).toBe(201)
    // required cannot linger behind a pick that is off, even if sent alone
    await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })
    await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPickRequired: true })
    await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: false })
    await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })
    expect((await as('owner', '/api/appointments/online-stylist-pick')).body.onlineStylistPickRequired).toBe(false)
  })

  test('with the feature off the setting means nothing: anyone books', async () => {
    await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPickRequired: true })
    await features(FEATURES)
    expect((await book('cut', '11:30', 'feat-off@example.com')).status).toBe(201)
  })
})
