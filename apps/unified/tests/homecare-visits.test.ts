// Home care's visits group (server/crm/homecare/visits) through the real server, as the homecare vertical: the
// mounts answer, the office's side is refused to a caregiver and reached by the office, the replies are the
// rulebook's (camelCase rows, lists as { data, pagination }), and the template defects fixed in the move stay fixed:
//   · a clock-in names a client of the caregiver's own company (another company's client id is a 404);
//   · a geofence save takes only its own settings (the template spread the request body into the row);
//   · an office edit of an unknown entry is a 404, and an edit of only the end time recomputes the duration;
//   · the phone line's "are you clocked in today?" is today on the agency's clock, and a clock-out of a closed visit
//     changes nothing;
//   · the certification-expiry scan counts the agency's calendar days.
import { describe, test, expect, beforeAll, setSystemTime } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const twilio = (path: string, form: Record<string, string>) =>
  t.call(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  const [cg] = await t.db.insert(t.schema.user).values({
    email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId, ivrPin: '4321',
  } as any).returning()
  ids.cg = cg.id
  tokens.cg = await login('ann@test.example', 'Caregiver-pass-1')
  const [pat] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Pat', lastName: 'Client', ivrCode: '517', isActive: true } as any).returning()
  ids.pat = pat.id
  // Another company's client, in the same database.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Care', slug: 'other-care' }).returning()
  const [stranger] = await t.db.insert(t.schema.clients).values({ companyId: other.id, firstName: 'Sam', lastName: 'Elsewhere' } as any).returning()
  ids.stranger = stranger.id
}, 60_000)

describe('home care — visits', () => {
  test('the office side is the office\'s; a caregiver reaches their own', async () => {
    for (const p of ['/api/time-entries/pending-approval', '/api/evv', '/api/sandata/status', '/api/sandata/settings', `/api/visit-docs/clients/${ids.pat}?from=2026-09-01&to=2026-09-30`, '/api/alerts', '/api/alerts/certifications']) {
      expect({ p, status: (await as('cg')(p)).status }).toEqual({ p, status: 403 })
      expect({ p, status: (await as('owner')(p)).status }).toEqual({ p, status: 200 })
    }
    const ctx = await as('cg')('/api/sandata/caregiver-context')
    expect(ctx.status).toBe(200)
    expect(await ctx.json()).toEqual({ sandataAgencyId: null, isWisconsin: false, clients: [], activeVisit: null })
  }, 30_000)

  test('the Sandata payer presets are for whoever writes a payer, not the EVV office', async () => {
    // They fill the payer form (billing/PayersServiceCodes.tsx); a billing seat without evv:delete was refused them.
    const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
    await t.db.insert(t.schema.user).values([
      { email: 'bill@test.example', passwordHash: hash, firstName: 'Bill', lastName: 'Seat', role: 'viewer', companyId, extraPermissions: ['care-billing:read', 'care-billing:create', 'care-billing:update'] },
      { email: 'mona@test.example', passwordHash: hash, firstName: 'Mona', lastName: 'Manager', role: 'manager', companyId },
    ] as any)
    tokens.bill = await login('bill@test.example', 'Seat-pass-1')
    tokens.mona = await login('mona@test.example', 'Seat-pass-1')
    const status = async (who: string) => (await as(who)('/api/sandata/payer-presets')).status
    expect({ owner: await status('owner'), bill: await status('bill'), mona: await status('mona'), cg: await status('cg') })
      .toEqual({ owner: 200, bill: 200, mona: 403, cg: 403 })
  }, 30_000)

  test('/api/alerts is home care\'s office queue, a list reply', async () => {
    const made = await as('owner')('/api/alerts', { method: 'POST', json: { alertType: 'care', message: 'Check on Pat' } })
    expect(made.status).toBe(201)
    const listed = await (await as('owner')('/api/alerts')).json()
    expect(listed.pagination.total).toBe(1)
    expect(listed.data[0]).toMatchObject({ alertType: 'care', message: 'Check on Pat', status: 'active' })
  })

  test('a clock-in names a client of the caregiver\'s own company, and answers in camelCase', async () => {
    const stranger = await as('cg')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.stranger } })
    expect(stranger.status).toBe(404)
    const r = await as('cg')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.8, longitude: -91.5 } })
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body).toMatchObject({ clientId: ids.pat, caregiverId: ids.cg, companyId, sandataRequired: false })
    expect('client_id' in body).toBe(false)
    ids.entry = body.id
    const active = await (await as('cg')('/api/time-entries/active')).json()
    expect(active).toMatchObject({ id: ids.entry, clientId: ids.pat, clientName: 'Pat Client' })
    const board = await (await as('owner')('/api/time-tracking/active')).json()
    expect(board.data.map((e: any) => e.id)).toEqual([ids.entry])
    const out = await as('cg')(`/api/time-entries/${ids.entry}/clock-out`, { method: 'POST', json: { notes: 'ok' } })
    expect(out.status).toBe(200)
    expect((await out.json()).isComplete).toBe(true)
    const again = await (await as('cg')(`/api/time-entries/${ids.entry}/clock-out`, { method: 'POST', json: {} })).json()
    expect(again.alreadyComplete).toBe(true)
  })

  test('an office edit: unknown entry 404; only an end time recomputes the duration from the clock-in', async () => {
    expect((await as('owner')('/api/time-tracking/nope', { method: 'PUT', json: { notes: 'x' } })).status).toBe(404)
    const [e] = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, ids.entry))
    const end = new Date(e.startTime.getTime() + 95 * 60000).toISOString()
    const r = await as('owner')(`/api/time-tracking/${ids.entry}`, { method: 'PUT', json: { endTime: end } })
    expect(r.status).toBe(200)
    expect((await r.json()).durationMinutes).toBe(95)
  })

  test('a geofence save takes only its own settings', async () => {
    const r = await as('owner')(`/api/time-tracking/geofence/${ids.pat}`, { method: 'POST', json: { radiusFeet: 500, companyId: 'someone-else', clientId: ids.stranger, id: 'forged' } })
    expect(r.status).toBe(200)
    const g = await r.json()
    expect(g).toMatchObject({ radiusFeet: 500, companyId, clientId: ids.pat })
    expect(g.id).not.toBe('forged')
    expect((await as('owner')(`/api/time-tracking/geofence/${ids.stranger}`, { method: 'POST', json: { radiusFeet: 1 } })).status).toBe(404)
  })

  test('the phone line: "clocked in today" is the agency\'s today; a closed visit is not closed again', async () => {
    await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
    // Friday 8:30 PM Central = Saturday 01:30 UTC; the punch was 6:00 PM Central (23:00 UTC Friday).
    setSystemTime(new Date('2026-10-17T01:30:00Z'))
    try {
      const [open] = await t.db.insert(t.schema.timeEntries).values({ companyId, caregiverId: ids.cg, clientId: ids.pat, startTime: new Date('2026-10-16T23:00:00Z') } as any).returning()
      const pin = await (await twilio('/api/ivr/verify-pin', { Digits: '4321', From: '+17155550101' })).text()
      expect(pin).toContain('You are currently clocked in')
      expect(pin).toContain(`timeEntryId=${open.id}`)
      const out = await twilio(`/api/ivr/clock-out?caregiverId=${ids.cg}&timeEntryId=${open.id}`, { Digits: '1', From: '+17155550101' })
      expect(await out.text()).toContain('You are now clocked out')
      const [closed] = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, open.id))
      expect(closed.originPhone).toBe('7155550101')
      // A retried webhook an hour later changes nothing.
      setSystemTime(new Date('2026-10-17T02:30:00Z'))
      const replay = await (await twilio(`/api/ivr/clock-out?caregiverId=${ids.cg}&timeEntryId=${open.id}`, { Digits: '1' })).text()
      expect(replay).toContain('No active shift found')
      const [still] = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, open.id))
      expect(still.endTime?.toISOString()).toBe(closed.endTime?.toISOString())
      expect(still.durationMinutes).toBe(closed.durationMinutes)
    } finally {
      setSystemTime()
    }
  })

  test('a phone clock-out bills by the app\'s rule: the schedule for a payer, the clock for private pay; far off schedule waits for the office', async () => {
    const hour = 60 * 60 * 1000
    // A payer client (Pat): scheduled 60 minutes, on the clock 3 hours → bills the 60, and needs the office's OK.
    const [payerVisit] = await t.db.insert(t.schema.timeEntries).values({ companyId, caregiverId: ids.cg, clientId: ids.pat, startTime: new Date(Date.now() - 3 * hour), allottedMinutes: 60 } as any).returning()
    expect(await (await twilio(`/api/ivr/clock-out?caregiverId=${ids.cg}&timeEntryId=${payerVisit.id}`, { Digits: '1' })).text()).toContain('You are now clocked out')
    const [p] = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, payerVisit.id))
    expect({ billable: p.billableMinutes, needsApproval: p.needsApproval, reason: p.approvalReason }).toEqual({ billable: 60, needsApproval: true, reason: 'time_variance' })
    // A private-pay client: the clock is what is billed (the template billed min(actual, scheduled) for both).
    const [priv] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Priya', lastName: 'Private', isPrivatePay: true, isActive: true } as any).returning()
    const [privVisit] = await t.db.insert(t.schema.timeEntries).values({ companyId, caregiverId: ids.cg, clientId: priv.id, startTime: new Date(Date.now() - 2 * hour), allottedMinutes: 60 } as any).returning()
    expect(await (await twilio(`/api/ivr/clock-out?caregiverId=${ids.cg}&timeEntryId=${privVisit.id}`, { Digits: '1' })).text()).toContain('You are now clocked out')
    const [q] = await t.db.select().from(t.schema.timeEntries).where(eq(t.schema.timeEntries.id, privVisit.id))
    expect(q.billableMinutes).toBe(120)
  })

  test('the database refuses a second open visit for one caregiver (0010: two taps cannot make twin visits)', async () => {
    await t.db.insert(t.schema.timeEntries).values({ companyId, caregiverId: ids.cg, clientId: ids.pat, startTime: new Date() } as any)
    await expect((async () => { await t.db.insert(t.schema.timeEntries).values({ companyId, caregiverId: ids.cg, clientId: ids.pat, startTime: new Date() } as any) })()).rejects.toThrow()
    await t.db.update(t.schema.timeEntries).set({ endTime: new Date() } as any).where(eq(t.schema.timeEntries.caregiverId, ids.cg))
  })

  test('the certification scan counts the agency\'s calendar days', async () => {
    // 8:30 PM Central on Oct 16 (already Oct 17 in UTC): a certificate expiring Oct 16 expires today, not yesterday.
    setSystemTime(new Date('2026-10-17T01:30:00Z'))
    try {
      await t.db.insert(t.schema.certificationRecords).values([
        { companyId, caregiverId: ids.cg, certificationType: 'CPR', expiryDate: '2026-10-16', status: 'active' },
        { companyId, caregiverId: ids.cg, certificationType: 'TB test', expiryDate: '2026-11-15', status: 'active' },
      ] as any)
      const r = await (await as('owner')('/api/alerts/certifications/generate', { method: 'POST', json: {} })).json()
      expect(r).toEqual({ scanned: 2, created: 2, skippedDuplicates: 0 })
      const list = (await (await as('owner')('/api/alerts/certifications')).json()).data
      expect(list.map((a: any) => [a.certificationType, a.daysUntilExpiry, a.alertType])).toEqual([
        ['CPR', 0, 'expiring_urgent'], ['TB test', 30, 'expiring_soon'],
      ])
    } finally {
      setSystemTime()
    }
  })
})
