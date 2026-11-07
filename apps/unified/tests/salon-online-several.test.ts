// Salon parity row 9 — several services in one online booking (Fresha, Vagaro, Square; online_multi_service with multi_service_visits, not
// ready). A time is offered only where every service fits, one after another, each with its own stylist (chosen, or whoever is free); the
// booking is one visit on the Book with a line per service; each stylist is held only for their own service, online and at the desk; the
// price is the sum. Moving it online is refused in words (call us); cancelling still works. Off: one service at a time, refused in words.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices', 'multi_service_visits', 'client_stylist_pick']
const PASSWORD = 'Several-1107-x'

describe('salon: several services in one online booking', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = '', other = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.7.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const pub = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { 'x-forwarded-for': `10.8.${Math.floor(++ip / 250)}.${ip % 250}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(2, 3)
  const day2 = addDays(day, 7)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const off = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + off * 60000).toISOString()
  }
  const times = async (slug: string, q = '', d = day) => ((await pub(`/api/book/services/${slug}/times?date=${d}${q}`)).body.data ?? []).map((x: any) => x.time) as string[]
  const book = (slug: string, time: string, email: string, extra: Record<string, unknown> = {}, d = day) =>
    pub(`/api/book/services/${slug}`, 'POST', { date: d, time, name: 'Online Client', email, phone: '608-555-0111', ...extra })
  const bookingOf = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0] as any

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const key of ['ana', 'bea']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      if (key === 'ana') ana = u.id; else bea = u.id
    }
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    // Each of them works Tuesdays 9–12.
    expect((await as('owner', '/api/booking/hours', 'PUT', { hours: [ana, bea].map((userId) => ({ userId, dayOfWeek: 2, start: '09:00', end: '12:00' })) })).status).toBe(200)
    expect((await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })).status).toBe(200)
    for (const [name, durationMin, price] of [['Colour', 60, 120], ['Cut', 30, 40], ['Blow Dry', 30, 35], ['Toner', 30, 30], ['Treatment', 30, 25]] as const) {
      expect((await as('owner', '/api/service-menu', 'POST', { name, category: 'hair', durationMin, price, bookableOnline: true })).status).toBe(201)
    }
    other = (await ins(t.schema.contact, { companyId: co, name: 'Desk Dana', email: 'dana@example.com', type: 'client' })).id
    // Bea has a desk client 10:00–10:30.
    const cut = (await t.db.select().from(t.schema.serviceMenu).where(eq(t.schema.serviceMenu.name, 'Cut')) as any[])[0].id
    expect((await as('owner', '/api/appointments', 'POST', { contactId: other, serviceId: cut, stylistId: bea, startTime: wall(day, '10:00') })).status).toBe(201)
  }, 120_000)

  test('off: one service at a time, refused in words', async () => {
    const r = await pub(`/api/book/services/colour/times?date=${day}&also=cut`)
    expect([r.status, r.body.code]).toEqual([400, 'basket_off'])
    const b = await book('colour', '09:00', 'off@example.com', { also: [{ service: 'cut' }] })
    expect([b.status, b.body.code]).toEqual([400, 'basket_off'])
    expect(await (await t.call('/book/colour')).text()).not.toContain('Add another service')
  })

  test('on: a time is offered only where every service fits, each with its own stylist', async () => {
    await features([...FEATURES, 'online_multi_service'])
    // a colour with anyone, then a cut with Bea: Bea is busy 10:00–10:30, so 09:00 (cut at 10:00) is not offered, 09:30 (cut 10:30) is
    const both = await times('colour', `&also=cut~${bea}`)
    expect(both).not.toContain('09:00')
    expect(both).toContain('09:30')
    expect(both).toContain('10:30')            // cut 11:30–12:00
    expect(both).not.toContain('11:00')        // the cut would run past 12:00
    // the colour alone is still offered at 09:00
    expect(await times('colour')).toContain('09:00')
    // the cut with anyone: Ana is free at 10:00, so 09:00 comes back
    expect(await times('colour', '&also=cut')).toContain('09:00')
    // dates follow the same rule
    expect(((await pub(`/api/book/services/colour/dates?also=cut~${bea}`)).body.data ?? []).length).toBeGreaterThan(0)
    // the page offers it: up to three more, from the services offered online
    const html = await (await t.call('/book/colour')).text()
    expect(html).toContain('+ Add another service')
    expect(html).toContain('data-also-max="3"')
    expect(html).toContain('&quot;slug&quot;:&quot;cut&quot;')
  })

  test('booking it: one visit with a line per service, the requested stylists, the sum as the price; moving online is refused', async () => {
    const r = await book('colour', '09:30', 'two@example.com', { who: ana, also: [{ service: 'cut', who: bea }] })
    expect(r.status).toBe(201)
    const b = await bookingOf(r.body.token)
    expect(b.basket.map((x: any) => [x.offsetMin, x.durationMin, x.userId, !!x.requested])).toEqual([[0, 60, ana, true], [60, 30, bea, true]])
    expect(new Date(b.endAt).getTime() - new Date(b.startAt).getTime()).toBe(90 * 60_000)
    const appt = (await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, b.appointmentId)) as any[])[0]
    expect([Number(appt.quotedPrice), appt.stylistId]).toEqual([160, ana])
    const items = (await t.db.select().from(t.schema.appointmentItem).where(eq(t.schema.appointmentItem.appointmentId, appt.id)) as any[]).sort((x, y) => x.position - y.position)
    expect(items.map((i) => [i.stylistId, i.startOffsetMin, i.durationMin, Number(i.price), i.requestedStylist])).toEqual([[ana, 0, 60, 120, true], [bea, 60, 30, 40, true]])
    // each stylist is held only for their own service: Ana 09:30–10:30, Bea 10:30–11:00 (and her desk client 10:00–10:30)
    expect(await times('cut', `&who=${bea}`)).toContain('09:30')
    expect(await times('cut', `&who=${bea}`)).not.toContain('10:30')
    expect(await times('cut', `&who=${ana}`)).toContain('10:30')
    expect(await times('cut', `&who=${ana}`)).not.toContain('10:00')
    // and at the desk: Bea at 10:30 clashes, Ana at 10:30 does not
    const cut = (await t.db.select().from(t.schema.serviceMenu).where(eq(t.schema.serviceMenu.name, 'Cut')) as any[])[0].id
    expect((await as('owner', '/api/appointments', 'POST', { contactId: other, serviceId: cut, stylistId: bea, startTime: wall(day, '10:30') })).status).toBe(409)
    expect((await as('owner', '/api/appointments', 'POST', { contactId: other, serviceId: cut, stylistId: ana, startTime: wall(day, '10:30') })).status).toBe(201)
    // the client's page: moving is refused in words, cancelling works
    const page = await pub(`/api/book/bookings/${r.body.token}`)
    expect(page.body.canMove).toBe(false)
    const move = await pub(`/api/book/bookings/${r.body.token}/reschedule`, 'POST', { date: day2, time: '09:00' })
    expect([move.status, move.body.code]).toEqual([409, 'basket'])
    expect(move.body.error).toContain('call us')
    // the page: both services by name, no Reschedule, and the way to move it
    const mine = await (await t.call(`/booking/${r.body.token}`)).text()
    expect(mine).toContain('Colour + Cut')
    expect(mine).not.toContain('>Reschedule</a>')
    expect(mine).toContain('This booking has several services')
    expect((await t.call(`/booking/${r.body.token}/reschedule`, { redirect: 'manual' } as any)).status).toBe(302)
    expect((await pub(`/api/book/bookings/${r.body.token}/cancel`, 'POST', {})).status).toBe(200)
    expect((await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, b.appointmentId)) as any[])[0].status).toBe('cancelled')
  })

  test('whoever is free for a later service; a time taken since is refused; no more than four services', async () => {
    const r = await book('colour', '09:00', 'any@example.com', { also: [{ service: 'cut' }, { service: 'blow-dry' }] }, day2)
    expect(r.status).toBe(201)
    const b = await bookingOf(r.body.token)
    expect(b.basket.length).toBe(3)
    expect(b.basket.every((x: any) => x.userId && !x.requested)).toBe(true)
    // the same three again at 09:00 with Ana for every one: her time is gone where she was given a service
    const taken = b.basket.some((x: any) => x.userId === ana)
    if (taken) expect((await book('colour', '09:00', 'again@example.com', { who: ana, also: [{ service: 'cut', who: ana }, { service: 'blow-dry', who: ana }] }, day2)).status).toBe(409)
    const five = await book('colour', '09:00', 'five@example.com', { also: [{ service: 'cut' }, { service: 'blow-dry' }, { service: 'toner' }, { service: 'treatment' }] }, day2)
    expect([five.status, five.body.code]).toEqual([400, 'basket_max'])
  })

  test('changed at the desk (Edit services): the booking holds the visit as it now is', async () => {
    await features([...FEATURES, 'online_multi_service', 'visit_editing'])
    const r = await book('cut', '11:00', 'desk@example.com', { who: ana, also: [{ service: 'blow-dry', who: bea }] }, day2)
    expect(r.status).toBe(201)
    expect(await times('cut', `&who=${bea}`, day2)).not.toContain('11:30')
    const b = await bookingOf(r.body.token)
    const cut = (await t.db.select().from(t.schema.serviceMenu).where(eq(t.schema.serviceMenu.name, 'Cut')) as any[])[0].id
    // Bea's blow dry becomes a second cut with Ana
    expect((await as('owner', `/api/appointments/${b.appointmentId}/services`, 'PUT', { items: [{ serviceId: cut, stylistId: ana }, { serviceId: cut, stylistId: ana, startOffsetMin: 30 }] })).status).toBe(200)
    const after = await bookingOf(r.body.token)
    expect(after.basket.map((x: any) => [x.userId, x.offsetMin])).toEqual([[ana, 0], [ana, 30]])
    // Bea's 11:30 is free online again; Ana's is not
    expect(await times('cut', `&who=${bea}`, day2)).toContain('11:30')
    expect(await times('cut', `&who=${ana}`, day2)).not.toContain('11:30')
  })

  test('the thank-you page tells the truth: a booking still held for its form is "Almost booked", with the way to finish', async () => {
    const r = await book('cut', '09:30', 'held@example.com', {}, day2)
    expect(r.status).toBe(201)
    const confirmed = await (await t.call(`/book/done?token=${r.body.token}`)).text()
    expect(confirmed).toContain('You&#39;re booked.')
    await t.db.update(t.schema.booking).set({ status: 'pending', depositStatus: 'forms' } as any).where(eq(t.schema.booking.token, r.body.token))
    const held = await (await t.call(`/book/done?token=${r.body.token}`)).text()
    expect(held).not.toContain('You&#39;re booked.')
    expect(held).toContain('Almost booked')
    expect(held).toContain('Fill in your form to confirm it.')
    expect(held).toContain(`/booking/${r.body.token}`)
  })
})
