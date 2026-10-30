// Patch-test status (salon gap #13; server/crm/salon/patchTest.ts), through the real server and the real logins. A client's
// patch test is a date AND a result. With the salon's rule switched on, a service that needs a patch test cannot be booked
// ONLINE without a passing, in-date one on record — the client is told to call — and the DESK books it only with a reason,
// kept on the appointment. Switched off (the default) nothing changes for a salon that never asked for the rule.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const PASSWORD = 'Patch-test-1030'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const daysAgo = (n: number) => addDays(today(), -n)

describe('salon: patch-test status', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = ''
  const tokens: Record<string, string> = {}
  let colour: any, cut: any
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, body }
  }
  const client = async (name: string, test?: { at: string; result?: string | null }) => {
    const c = await ins(t.schema.contact, { companyId: co, name, email: `${name.toLowerCase().replace(/\W/g, '')}@example.com`, type: 'client' })
    if (test) await ins(t.schema.clientProfile, { companyId: co, contactId: c.id, patchTestAt: test.at, patchTestResult: test.result ?? null })
    return c as { id: string; email: string }
  }
  let slot = 9
  const online = (c: { email: string; id: string }, service = 'colour', date = next(3)) => {
    slot += 1
    return t.call(`/api/book/services/${service}`, { method: 'POST', json: { date, time: `${String(slot).padStart(2, '0')}:00`, name: 'Online Client', email: c.email, phone: '608-555-0160' } })
  }
  const bookings = async () => (await t.db.select().from(t.schema.booking)).length
  const desk = (who: string, c: { id: string }, extra: Record<string, unknown> = {}, hour = 15) =>
    as(who, '/api/appointments', 'POST', { contactId: c.id, serviceId: colour.id, startTime: `${next(4)}T${String(hour).padStart(2, '0')}:00:00.000Z`, ...extra })

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
      await ins(t.schema.user, { email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role, companyId: co })
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email, password: PASSWORD } })).json()) as any).accessToken
    }
    colour = (await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 90, bookableOnline: true, requiresPatchTest: true })).body
    cut = (await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).body
  }, 120_000)

  test('the rule is off by default: a patch-test service books online and at the desk exactly as before', async () => {
    expect((await as('desk', '/api/appointments/patch-test-rule')).body).toEqual({ patchTestRule: false })
    const c = await client('Untested Una')
    expect((await online(c)).status).toBe(201)
    const d = await desk('owner', c, {}, 14)
    expect(d.status).toBe(201)
  })

  test('only whoever changes the company may switch the rule — on the server', async () => {
    for (const who of ['ana', 'desk']) expect((await as(who, '/api/appointments/patch-test-rule', 'PUT', { patchTestRule: true })).status).toBe(403)
    expect((await as('owner', '/api/appointments/patch-test-rule', 'PUT', { patchTestRule: 'yes' })).status).toBe(400)
    const r = await as('owner', '/api/appointments/patch-test-rule', 'PUT', { patchTestRule: true })
    expect([r.status, r.body]).toEqual([200, { patchTestRule: true }])
    expect((await as('ana', '/api/appointments/patch-test-rule')).body.patchTestRule).toBe(true)
  })

  test('on: online booking is refused with no test on record, an old test, or a failed one — and nothing is booked', async () => {
    const none = await client('Never Nia')
    const old = await client('Old Ola', { at: daysAgo(200), result: 'passed' })
    const failed = await client('Failed Fay', { at: daysAgo(5), result: 'failed' })
    const before = await bookings()
    for (const [c, words] of [[none, 'none is on record'], [old, 'has run out'], [failed, 'did not pass']] as const) {
      const r = await online(c)
      expect(r.status).toBe(409)
      const body: any = await r.json()
      expect(body.code).toBe('patch_test')
      expect(body.error).toContain(words)
      expect(body.error).toContain('call us')
    }
    expect(await bookings()).toBe(before)
    expect((await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.contactId, none.id))).length).toBe(0)
  })

  test('on: a passing, in-date test (or one recorded before results were kept) books online; other services are untouched', async () => {
    const ok = await client('Passed Pia', { at: daysAgo(30), result: 'passed' })
    const legacy = await client('Legacy Lee', { at: daysAgo(60), result: null })
    const stranger = await client('Plain Pat')
    expect((await online(ok)).status).toBe(201)
    expect((await online(legacy)).status).toBe(201)
    expect((await online(stranger, 'cut')).status).toBe(201)
  })

  test('on: the desk books a patch-test service only with a reason, kept on the appointment', async () => {
    const c = await client('Desk Dee')
    const refused = await desk('owner', c, {}, 15)
    expect([refused.status, refused.body.code]).toEqual([409, 'PATCH_TEST_NEEDED'])
    expect(refused.body.fields.patchTestOverrideReason).toBeTruthy()
    expect(refused.body.error).toContain('none is on record')
    expect((await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.contactId, c.id))).length).toBe(0)
    const ok = await desk('owner', c, { patchTestOverrideReason: 'Tested in person this morning, will record it after' }, 16)
    expect(ok.status).toBe(201)
    expect(ok.body.notes).toContain('Booked without a passing patch test — Tested in person this morning')
    // a client who has a passing test needs no reason
    const good = await client('Good Gia', { at: daysAgo(10), result: 'passed' })
    const free = await desk('owner', good, {}, 17)
    expect(free.status).toBe(201)
    expect(free.body.notes ?? '').not.toContain('patch test')
  })

  test('the chart says where a client stands, and the result follows its date', async () => {
    const c = await client('Chart Cleo')
    const put = (body: unknown) => as('owner', `/api/clients/${c.id}/profile`, 'PUT', body)
    expect((await as('owner', `/api/clients/${c.id}`)).body.patchTest.state).toBe('none')
    // a result needs the test's date
    let r = await put({ patchTestResult: 'passed' })
    expect([r.status, r.body.code]).toEqual([400, 'VALIDATION'])
    r = await put({ patchTestResult: 'maybe', patchTestAt: daysAgo(1) })
    expect(r.status).toBe(400)
    r = await put({ patchTestAt: daysAgo(3), patchTestResult: 'failed' })
    expect(r.status).toBe(200)
    expect((await as('owner', `/api/clients/${c.id}`)).body.patchTest).toMatchObject({ state: 'failed', ageDays: 3 })
    // editing something else with the same date does not lose the result
    r = await put({ allergies: 'Latex', patchTestAt: daysAgo(3) })
    expect(r.body.patchTestResult).toBe('failed')
    // a new test with no result given is not still "failed"
    r = await put({ patchTestAt: daysAgo(1) })
    expect(r.body.patchTestResult).toBeNull()
    expect((await as('owner', `/api/clients/${c.id}`)).body.patchTest.state).toBe('passed')
    // an old one expires
    await put({ patchTestAt: daysAgo(181), patchTestResult: 'passed' })
    expect((await as('owner', `/api/clients/${c.id}`)).body.patchTest.state).toBe('expired')
    // no date, no result
    r = await put({ patchTestAt: '' })
    expect([r.body.patchTestAt, r.body.patchTestResult]).toEqual([null, null])
  })

  test('off again: the hold is gone', async () => {
    expect((await as('owner', '/api/appointments/patch-test-rule', 'PUT', { patchTestRule: false })).status).toBe(200)
    const c = await client('Free Fern')
    slot = 9
    expect((await online(c, 'colour', next(2))).status).toBe(201)
  })
})
