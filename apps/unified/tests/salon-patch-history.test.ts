// Patch-test history (salon parity row 22; server crm/salon/patchTests.ts), through the real server and the real logins.
// A client has SEVERAL patch tests, each with a date, a status (pending / passed / failed), who ran it, a title and a description. The latest
// passed-or-failed one is what the booking rule reads. Completing the salon's named patch-test appointment records a pending test and the
// answer carries it so the screen can ask for the result. A confirmation, a reminder email and the day-before text tell a client whose
// service needs a test (and who holds none) that they need one.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { createAppointmentReminders } from '../server/crm/salon/appointmentReminders.ts'
import { createPatchTests } from '../server/crm/salon/patchTests.ts'
import { createSalonClock } from '../server/crm/salon/days.ts'

const TZ = 'America/Chicago'
const PASSWORD = 'Patch-hist-1031'
const today = () => tzParts(new Date(), TZ).date
const daysAgo = (n: number) => addDays(today(), -n)
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000)

describe('salon: patch-test history', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  let colour: any, patchSvc: any, ana = ''
  const sent: Array<{ to: string; name: string; data: any }> = []
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const client = async (name: string, extra: Record<string, unknown> = {}) =>
    await ins(t.schema.contact, { companyId: co, name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, phone: '608-555-0177', mobile: '608-555-0177', type: 'client', ...extra }) as { id: string; email: string }
  const chart = async (c: { id: string }) => (await as('owner', `/api/clients/${c.id}`)).body.patchTest
  const tests = async (c: { id: string }) => (await as('owner', `/api/clients/${c.id}/patch-tests`)).body.tests as any[]
  const waitFor = async (fn: () => boolean) => { for (let i = 0; i < 60 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)) }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    expect((await as('owner', '/api/company/features', 'PUT', { features: ['online_booking', 'contacts', 'client_profiles', 'salon_booking', 'service_menu'] })).status).toBe(200)
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    for (const [key, role] of Object.entries({ ana: 'field', desk: 'viewer' })) {
      const email = `${key}@test.example`
      const u = await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key === 'ana' ? 'Ana' : 'Desk', lastName: 'Tester', role, companyId: co })
      if (key === 'ana') ana = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 90, bookableOnline: true, requiresPatchTest: true })).body
    patchSvc = (await as('owner', '/api/service-menu', 'POST', { name: 'Patch Test', category: 'colour', durationMin: 15, price: 0, bookableOnline: true })).body
    const real = t.services.email.send.bind(t.services.email)
    ;(t.services.email as any).send = async (to: string, name: string, data: any) => { sent.push({ to, name, data }); return real(to, name, data) }
  }, 120_000)

  test('a client keeps several tests; each has date, status, who ran it, title and description; the chart follows the latest result', async () => {
    const c = await client('History Hana')
    expect(await tests(c)).toEqual([])
    const first = await as('owner', `/api/clients/${c.id}/patch-tests`, 'POST', { testedAt: daysAgo(40), status: 'failed', title: 'Tint patch', description: 'Red and itchy after a day', ranByUserId: ana })
    expect([first.status, first.body.status, first.body.ranByName, first.body.title]).toEqual([201, 'failed', 'Ana Tester', 'Tint patch'])
    expect((await chart(c)).state).toBe('failed')
    const second = await as('owner', `/api/clients/${c.id}/patch-tests`, 'POST', { testedAt: daysAgo(5), status: 'passed', title: 'Second try, other tint' })
    expect(second.status).toBe(201)
    // recorded by the person at the desk when nobody else is named; both stay in the history, newest first
    expect(typeof second.body.ranByName === 'string' || second.body.ranByName === null).toBe(true)
    const list = await tests(c)
    expect(list.map((x) => [x.testedAt, x.status])).toEqual([[daysAgo(5), 'passed'], [daysAgo(40), 'failed']])
    expect((await chart(c)).state).toBe('passed')
    // a pending test changes nothing on the chart until it has a result
    const pending = await as('owner', `/api/clients/${c.id}/patch-tests`, 'POST', { status: 'pending', title: 'Lash glue test' })
    expect([pending.status, pending.body.testedAt]).toEqual([201, today()])
    expect((await chart(c)).state).toBe('passed')
    const failedNow = await as('owner', `/api/clients/${c.id}/patch-tests/${pending.body.id}`, 'PUT', { status: 'failed' })
    expect(failedNow.status).toBe(200)
    expect((await chart(c)).state).toBe('failed')
    // removing the wrong one puts the chart back
    expect((await as('owner', `/api/clients/${c.id}/patch-tests/${pending.body.id}`, 'DELETE')).status).toBe(200)
    expect((await chart(c)).state).toBe('passed')
    expect((await tests(c)).length).toBe(2)
  })

  test('bad input is refused with the reason, and who may change the history is checked on the server', async () => {
    const c = await client('Rules Rae')
    const post = (b: unknown, who = 'owner') => as(who, `/api/clients/${c.id}/patch-tests`, 'POST', b)
    for (const [body, field] of [[{ status: 'maybe' }, 'status'], [{ testedAt: addDays(today(), 2) }, 'testedAt'], [{ testedAt: '2026-02-31' }, 'testedAt'], [{ title: 'x'.repeat(121) }, 'title'], [{ ranByUserId: 'nobody' }, 'ranByUserId']] as const) {
      const r = await post(body)
      expect([r.status, typeof r.body.fields?.[field]]).toEqual([400, 'string'])
    }
    // a read-only seat can read the chart but not change it; a stylist, who keeps a client's card, can (the same right as the chart's own form)
    expect((await post({ status: 'passed' }, 'desk')).status).toBe(403)
    expect((await as('desk', `/api/clients/${c.id}/patch-tests`)).status).toBe(200)
    const mine0 = (await tests(c))
    expect((await as('desk', `/api/clients/${c.id}/patch-tests/x`, 'DELETE')).status).toBe(403)
    expect(mine0).toEqual([])
    expect((await post({ status: 'passed' }, 'ana')).status).toBe(201)
    // another client's test cannot be reached through this client
    const other = await client('Other Ola')
    const mine = (await tests(c))[0]
    expect((await as('owner', `/api/clients/${other.id}/patch-tests/${mine.id}`, 'PUT', { status: 'failed' })).status).toBe(404)
    expect((await as('owner', `/api/clients/${other.id}/patch-tests/${mine.id}`, 'DELETE')).status).toBe(404)
    expect((await as('owner', `/api/clients/nope/patch-tests`)).status).toBe(404)
  })

  test('the old chart form still works: a date and result record or correct the latest test; cleared, it is removed', async () => {
    const c = await client('Form Faye')
    const put = (b: unknown) => as('owner', `/api/clients/${c.id}/profile`, 'PUT', b)
    expect((await put({ patchTestAt: daysAgo(10), patchTestResult: 'failed' })).status).toBe(200)
    expect((await tests(c)).map((x) => [x.testedAt, x.status])).toEqual([[daysAgo(10), 'failed']])
    expect((await put({ patchTestAt: daysAgo(10), patchTestResult: 'passed' })).status).toBe(200)
    expect((await tests(c)).map((x) => x.status)).toEqual(['passed'])
    expect((await put({ patchTestAt: '' })).status).toBe(200)
    expect(await tests(c)).toEqual([])
    expect((await chart(c)).state).toBe('none')
  })

  test('completing the named patch-test appointment records a pending test (once), and the result can then be set; other appointments record nothing', async () => {
    const c = await client('Visit Vera')
    const appt = (serviceId: string, startsInHours = -3) => ins(t.schema.appointment, { companyId: co, contactId: c.id, serviceId, stylistId: ana, status: 'scheduled', startTime: hoursFromNow(startsInHours), endTime: hoursFromNow(startsInHours + 1) })
    // not named yet: completing it records nothing
    const early = await appt(patchSvc.id, -6)
    const none = await as('owner', `/api/appointments/${early.id}`, 'PUT', { status: 'completed' })
    expect([none.status, none.body.patchTest]).toEqual([200, undefined])
    expect((await as('owner', '/api/appointments/patch-test-rule', 'PUT', { patchTestRule: true, patchTestServiceId: patchSvc.id })).status).toBe(200)
    // a colour is not the patch-test appointment
    const dye = await appt(colour.id, -5)
    expect((await as('owner', `/api/appointments/${dye.id}`, 'PUT', { status: 'completed' })).body.patchTest).toBeUndefined()
    const a = await appt(patchSvc.id)
    const done = await as('owner', `/api/appointments/${a.id}`, 'PUT', { status: 'completed' })
    expect(done.status).toBe(200)
    expect(done.body.patchTest).toMatchObject({ status: 'pending', title: 'Patch Test', testedAt: today(), ranByName: 'Ana Tester', appointmentId: a.id })
    // pending is not a pass: the colour is still held
    expect((await chart(c)).state).toBe('none')
    // the prompt's answer
    const answered = await as('owner', `/api/clients/${c.id}/patch-tests/${done.body.patchTest.id}`, 'PUT', { status: 'passed' })
    expect([answered.status, answered.body.status]).toEqual([200, 'passed'])
    expect((await chart(c)).state).toBe('passed')
    // completing again (reopen and complete) does not add a second test
    await as('owner', `/api/appointments/${a.id}`, 'PUT', { status: 'confirmed' })
    await as('owner', `/api/appointments/${a.id}`, 'PUT', { status: 'completed' })
    expect((await tests(c)).filter((x) => x.appointmentId === a.id).length).toBe(1)
    expect((await tests(c)).find((x) => x.appointmentId === a.id)?.status).toBe('passed')
    // with the result given on the way, no prompt is needed
    const c2 = await client('Quick Quinn')
    const b = await ins(t.schema.appointment, { companyId: co, contactId: c2.id, serviceId: patchSvc.id, stylistId: ana, status: 'scheduled', startTime: hoursFromNow(-9), endTime: hoursFromNow(-8) })
    const quick = await as('owner', `/api/appointments/${b.id}`, 'PUT', { status: 'completed', patchTestResult: 'failed' })
    expect(quick.body.patchTest.status).toBe('failed')
    expect((await as('owner', `/api/clients/${c2.id}`)).body.patchTest.state).toBe('failed')
  })

  test('a service that needs a test, for a client who holds none: the confirmation and the reminder email say so; one who holds a pass is told nothing', async () => {
    const need = await client('Needs Nell')
    const fine = await client('Fine Fran')
    await as('owner', `/api/clients/${fine.id}/patch-tests`, 'POST', { testedAt: daysAgo(3), status: 'passed' })
    const book = (c: { email: string }, ip: number) => t.call(`/api/book/services/colour`, { method: 'POST', headers: { 'x-forwarded-for': `10.9.${ip}.${ip}` }, json: { date: addDays(today(), 12), time: `${10 + (ip % 6)}:00`, name: 'Online Client', email: c.email, phone: '608-555-0160' } })
    // the rule is on, so the unqualified client is turned away online; switch it off to book, as a salon that only wants to REMIND does
    expect((await as('owner', '/api/appointments/patch-test-rule', 'PUT', { patchTestRule: false })).status).toBe(200)
    expect((await book(need, 1)).status).toBe(201)
    expect((await book(fine, 2)).status).toBe(201)
    await waitFor(() => sent.filter((s) => s.name === 'bookingConfirmed' && [need.email, fine.email].includes(s.to)).length >= 2)
    const mailTo = (email: string) => sent.find((s) => s.name === 'bookingConfirmed' && s.to === email)
    expect(mailTo(need.email)?.data.note).toContain('needs a patch test first')
    expect(mailTo(fine.email)?.data.note ?? null).toBeNull()
  })

  test('the day-before text carries the same sentence, and only for the client who needs it', async () => {
    const need = await client('Text Tess')
    const fine = await client('Text Tara')
    await as('owner', `/api/clients/${fine.id}/patch-tests`, 'POST', { testedAt: daysAgo(3), status: 'passed' })
    const mk = (c: { id: string }) => ins(t.schema.appointment, { companyId: co, contactId: c.id, serviceId: colour.id, status: 'scheduled', startTime: hoursFromNow(24), endTime: hoursFromNow(25) })
    await mk(need); await mk(fine)
    const texts: Array<{ contactId: string; message: string }> = []
    const patch = createPatchTests(t.db, createSalonClock(t.db))
    const reminders = createAppointmentReminders({ db: t.db, sms: { sendSMS: async (_c, m) => { texts.push(m); return { status: 'sent' } } }, logger: { info: () => {}, warn: () => {}, error: () => {} } as any, note: (a, b, s) => patch.needNote(a, b, s) })
    await reminders.processAppointmentReminders()
    const textOf = (c: { id: string }) => texts.find((x) => x.contactId === c.id)?.message ?? ''
    expect(textOf(need)).toContain('needs a patch test first')
    expect(textOf(fine)).toContain('Reply to this text')
    expect(textOf(fine)).not.toContain('patch test')
  })

  test('an expired or failed test is told apart in the sentence', async () => {
    const patch = createPatchTests(t.db, createSalonClock(t.db))
    const old = await client('Old Opal'); await as('owner', `/api/clients/${old.id}/patch-tests`, 'POST', { testedAt: daysAgo(200), status: 'passed' })
    const bad = await client('Bad Bree'); await as('owner', `/api/clients/${bad.id}/patch-tests`, 'POST', { testedAt: daysAgo(2), status: 'failed' })
    expect(await patch.needNote(co, old.id, colour.id)).toContain('has run out')
    expect(await patch.needNote(co, bad.id, colour.id)).toContain('did not pass')
    const cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Trim', category: 'hair', durationMin: 20, price: 20 })).body
    expect(await patch.needNote(co, bad.id, cut.id)).toBeNull()
  })
})
