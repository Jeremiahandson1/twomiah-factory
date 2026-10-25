// "Stylists see only their own appointments" (owner's decision 2026-10-25; server/crm/salon/bookScope.ts), through the
// real server and the real logins. Off — the default — every seat reads the whole book, as before. On, a stylist reads
// and acts on only their own chair (their login, and the roster card that is them): the day and week windows, the paged
// list, the client chart's appointments, the dashboard; they cannot check in, move, complete, cancel or log a service
// against another chair's appointment, nor book into one. The front desk, a manager and the owner keep the whole book;
// only the owner and admins may flip the switch.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PASSWORD = 'Own-book-1025'

describe('salon: stylists see only their own appointments', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const ids: Record<string, string> = {}
  const tokens: Record<string, string> = {}
  let client = '', cut = '', memberCard = ''
  let mine: any, mineByCard: any, theirs: any, theirsTomorrow: any

  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const idsOf = (r: any) => (r.body.data || []).map((x: any) => x.id).sort()
  const at = (h: number, dayOffset = 0) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return new Date(d.getTime() + dayOffset * 86400000) }
  const appt = async (h: number, stylist: Record<string, string | null>, dayOffset = 0) =>
    (await t.db.insert(t.schema.appointment).values({ companyId: co, contactId: client, serviceId: cut, startTime: at(h, dayOffset), endTime: at(h + 1, dayOffset), status: 'scheduled', ...stylist } as any).returning())[0]
  const today = () => { const s = at(0); return { from: s.toISOString(), to: new Date(s.getTime() + 86400000 - 1).toISOString() } }
  const week = () => { const s = at(0, -1); return { from: s.toISOString(), to: new Date(s.getTime() + 7 * 86400000).toISOString() } }
  const windowOf = (w: { from: string; to: string }) => `/api/appointments?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`
  const setSwitch = (who: string, on: boolean) => as(who, '/api/appointments/book-settings', 'PUT', { stylistsSeeOwnBookOnly: on })

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    ids.owner = s.owner.id
    await t.db.update(t.schema.company).set({ timezone: 'UTC', enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'service_menu', 'salon_booking', 'dashboard', 'team'] } as any).where(eq(t.schema.company.id, co))
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    for (const [key, role] of Object.entries({ ana: 'field', ben: 'field', desk: 'viewer', manager: 'manager', admin: 'admin' })) {
      const email = `${key}@test.example`
      const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co } as any).returning()
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    client = (await t.db.insert(t.schema.contact).values({ companyId: co, name: 'Casey Client', type: 'client' } as any).returning())[0].id
    cut = (await t.db.insert(t.schema.serviceMenu).values({ companyId: co, name: 'Cut', price: '50', durationMin: 60 } as any).returning())[0].id
    // Ana's roster card — the same person (her email), as /api/team/assignable matches a login to its card.
    memberCard = (await t.db.insert(t.schema.teamMember).values({ companyId: co, name: 'Ana Card', email: 'ANA@test.example', active: true } as any).returning())[0].id
    mine = await appt(9, { stylistId: ids.ana })
    mineByCard = await appt(11, { stylistMemberId: memberCard })
    theirs = await appt(13, { stylistId: ids.ben })
    theirsTomorrow = await appt(10, { stylistId: ids.ben }, 1)
  }, 120_000)

  test('off (the default): a stylist reads the whole book, as before', async () => {
    const r = await as('ana', '/api/appointments/book-settings')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ stylistsSeeOwnBookOnly: false, ownOnly: false, ownStylistIds: [] })
    expect(idsOf(await as('ana', windowOf(today())))).toEqual([mine.id, mineByCard.id, theirs.id].sort())
    expect(idsOf(await as('ana', windowOf(week())))).toContain(theirsTomorrow.id)
  })

  test('only the owner and admins may flip it — on the server', async () => {
    for (const who of ['ana', 'desk', 'manager']) expect((await setSwitch(who, true)).status).toBe(403)
    expect((await as('owner', '/api/appointments/book-settings', 'PUT', { stylistsSeeOwnBookOnly: 'yes' })).status).toBe(400)
    const r = await setSwitch('admin', true)
    expect(r.status).toBe(200)
    expect(r.body.stylistsSeeOwnBookOnly).toBe(true)
    expect(r.body.ownOnly).toBe(false)
    const [row] = await t.db.select({ settings: t.schema.company.settings }).from(t.schema.company).where(eq(t.schema.company.id, co))
    expect((row.settings as any).stylistsSeeOwnBookOnly).toBe(true)
  })

  test('on: a stylist reads only their own chair — day, week, paged list, client chart, dashboard', async () => {
    const scope = await as('ana', '/api/appointments/book-settings')
    expect(scope.body.ownOnly).toBe(true)
    expect(scope.body.ownStylistIds.sort()).toEqual([ids.ana, memberCard].sort())
    expect(idsOf(await as('ana', windowOf(today())))).toEqual([mine.id, mineByCard.id].sort())
    expect(idsOf(await as('ana', windowOf(week())))).toEqual([mine.id, mineByCard.id].sort())
    const paged = await as('ana', '/api/appointments')
    expect(idsOf(paged)).toEqual([mine.id, mineByCard.id].sort())
    expect(paged.body.pagination.total).toBe(2)
    // Asking for Ben's chair by name gives nothing, not Ben's book.
    expect(idsOf(await as('ana', `/api/appointments?stylistId=${ids.ben}`))).toEqual([])
    const chart = await as('ana', `/api/clients/${client}`)
    expect(chart.status).toBe(200)
    expect(chart.body.appointments.map((a: any) => a.id).sort()).toEqual([mine.id, mineByCard.id].sort())
    const upcoming = await as('ana', '/api/dashboard/recent-activity')
    expect(upcoming.status).toBe(200)
    for (const a of upcoming.body.upcomingAppointments) expect([mine.id, mineByCard.id]).toContain(a.id)
    const stats = await as('ana', '/api/dashboard/stats')
    expect(stats.body.appointments.today).toBe(2)

    // Ben sees his, not Ana's.
    expect(idsOf(await as('ben', windowOf(week())))).toEqual([theirs.id, theirsTomorrow.id].sort())
  })

  test('on: the front desk, a manager and the owner still see every chair', async () => {
    for (const who of ['desk', 'manager', 'owner', 'admin']) {
      const r = await as(who, windowOf(today()))
      expect(idsOf(r)).toEqual([mine.id, mineByCard.id, theirs.id].sort())
      expect((await as(who, '/api/appointments/book-settings')).body.ownOnly).toBe(false)
    }
    expect((await as('manager', '/api/dashboard/stats')).body.appointments.today).toBe(3)
    expect((await as('desk', `/api/clients/${client}`)).body.appointments.length).toBe(4)
  })

  test('on: a stylist cannot act on another chair\'s appointment, or book into one', async () => {
    expect((await as('ana', `/api/appointments/${theirs.id}/check-in`, 'POST')).status).toBe(404)
    expect((await as('ana', `/api/appointments/${theirs.id}`, 'PUT', { status: 'completed' })).status).toBe(404)
    expect((await as('ana', `/api/appointments/${theirs.id}`, 'PUT', { startTime: at(15).toISOString() })).status).toBe(404)
    expect((await as('ana', `/api/appointments/${theirs.id}`, 'DELETE')).status).toBe(404)
    expect((await as('ana', '/api/service-records', 'POST', { contactId: client, appointmentId: theirs.id, serviceId: cut, priceCharged: 50 })).status).toBe(404)
    const [still] = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, theirs.id))
    expect(still.status).toBe('scheduled')
    expect(new Date(still.startTime).getTime()).toBe(theirs.startTime.getTime())

    // Not into Ben's chair, and not handing her own to Ben.
    const intoBen = await as('ana', '/api/appointments', 'POST', { contactId: client, serviceId: cut, stylistId: ids.ben, startTime: at(16).toISOString() })
    expect(intoBen.status).toBe(403)
    expect(intoBen.body.code).toBe('OWN_BOOK_ONLY')
    expect((await as('ana', `/api/appointments/${mine.id}`, 'PUT', { stylistId: ids.ben })).status).toBe(403)
    expect((await as('ana', `/api/appointments/${mine.id}`, 'PUT', { stylistId: '' })).status).toBe(403)

    // Her own chair she works as before; naming nobody books it into hers.
    expect((await as('ana', `/api/appointments/${mine.id}`, 'PUT', { stylistId: memberCard })).status).toBe(200)
    expect((await as('ana', `/api/appointments/${mine.id}`, 'PUT', { stylistId: ids.ana })).status).toBe(200)
    const booked = await as('ana', '/api/appointments', 'POST', { contactId: client, serviceId: cut, startTime: at(18).toISOString() })
    expect(booked.status).toBe(201)
    expect(booked.body.stylistId).toBe(ids.ana)
    expect((await as('ana', `/api/appointments/${booked.body.id}`, 'DELETE')).status).toBe(200)

    // The manager still moves anyone's.
    expect((await as('manager', `/api/appointments/${theirs.id}`, 'PUT', { notes: 'moved by the manager' })).status).toBe(200)
  })

  test('off again: the stylist reads the whole book again', async () => {
    expect((await setSwitch('owner', false)).status).toBe(200)
    // (the 6pm one Ana booked and cancelled above stays in the book as cancelled)
    expect(idsOf(await as('ana', `${windowOf(today())}&status=scheduled`))).toEqual([mine.id, mineByCard.id, theirs.id].sort())
    expect((await as('ana', `/api/appointments/${theirs.id}`, 'PUT', { notes: 'any chair again' })).status).toBe(200)
  })
})
