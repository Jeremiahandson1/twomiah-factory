// Home care parity row 17 (docs/parity/homecare-open-shift-broadcast.md): decline (with a reason) and hide an offer, an offer status with response
// counts, an answer-by time, the agency's visibility setting and days-ahead limit, email as a channel with each person's notification settings
// honoured, an outbox with resend, warnings before sending, a whole series offered at once — and the first to accept gets it, also in a race.
// Behind care_open_shift_offers.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { addDays } from '../server/crm/homecare/core/agencyTime.ts'
import { offerStatus, visibleUnder, declineProblem, sanitizeSettings, reachProblems, DEFAULT_SETTINGS } from '../server/crm/homecare/core/openShiftOffers.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
let today = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const texts: any[] = []
const emails: any[] = []
const BASE = ['contacts', 'scheduling', 'team']
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const send = async (who: string, method: string, path: string, body?: any) => {
  const r = await as(who)(path, { method, ...(body !== undefined ? { json: body } : {}) })
  const text = await r.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, body: parsed, text }
}
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const post = async (extra: any = {}) => (await send('owner', 'POST', '/api/open-shifts', { clientId: ids.pat, shiftDate: addDays(today, 10), startTime: '09:00', endTime: '11:00', ...extra })).body.id as string
const available = async (who: string) => ((await send(who, 'GET', '/api/open-shifts/available')).body.data as any[]).map((s) => s.id)
const board = async () => (await send('owner', 'GET', '/api/open-shift-offers/board?status=all')).body.data as any[]
const row = async (id: string) => (await board()).find((s) => s.id === id)
const phoneOf = (who: string) => `ExponentPushToken[${who}-phone]`

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { emails.push(m); return { ok: true } }
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, companyId))
  core = createHomecareCore({ services: t.services.crm } as any)
  today = await core.time.today(companyId)
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  let n = 0
  for (const who of ['ann', 'bob', 'cy', 'dee']) {
    ids[who] = (await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, phone: who === 'bob' ? null : `608555020${++n}` })).id
  }
  for (const who of ['ann', 'bob', 'dee']) {
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
    if (who !== 'bob') expect((await as(who)('/api/push/expo-token', { method: 'POST', json: { token: phoneOf(who), platform: 'ios' } })).status).toBe(201)
  }
  // Cy never signed in to the app (no token, no login); Dee turned texts off in her notification settings.
  await ins(t.schema.notificationPreferences, { companyId, userId: ids.dee, smsEnabled: false })
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures([...BASE, 'care_open_shift_offers'])
}, 90_000)

describe('the rules (pure)', () => {
  test('offer status: Not sent, Pending, Accepted, Declined, Expired, Closed', () => {
    const base = { status: 'open', sent: 0, declined: 0, respondBy: null as string | null, now: '2026-11-02T10:00:00' }
    expect(offerStatus(base)).toBe('not_sent')
    expect(offerStatus({ ...base, sent: 3 })).toBe('pending')
    expect(offerStatus({ ...base, sent: 3, declined: 2 })).toBe('pending')
    expect(offerStatus({ ...base, sent: 3, declined: 3 })).toBe('declined')
    expect(offerStatus({ ...base, status: 'claimed', sent: 3 })).toBe('accepted')
    expect(offerStatus({ ...base, status: 'filled' })).toBe('accepted')
    expect(offerStatus({ ...base, sent: 3, respondBy: '2026-11-02T09:59:59' })).toBe('expired')
    expect(offerStatus({ ...base, sent: 3, respondBy: '2026-11-02T10:00:01' })).toBe('pending')
    expect(offerStatus({ ...base, status: 'cancelled' })).toBe('closed')
  })
  test('what a caregiver sees: nothing / only what was sent / everything offered to them; days ahead; answered and expired never', () => {
    const shift = { id: 's1', visibleTo: null as string[] | null, shiftDate: '2026-11-10', respondBy: null as string | null }
    const ctx = { caregiverId: 'ann', today: '2026-11-02', now: '2026-11-02T10:00:00', sent: new Set<string>(), answered: new Set<string>() }
    expect(visibleUnder(DEFAULT_SETTINGS, shift, ctx)).toBe(true)
    expect(visibleUnder({ visibility: 'none', daysAhead: null }, shift, ctx)).toBe(false)
    expect(visibleUnder({ visibility: 'sent', daysAhead: null }, shift, ctx)).toBe(false)
    expect(visibleUnder({ visibility: 'sent', daysAhead: null }, shift, { ...ctx, sent: new Set(['s1']) })).toBe(true)
    expect(visibleUnder(DEFAULT_SETTINGS, { ...shift, visibleTo: ['bob'] }, ctx)).toBe(false)
    expect(visibleUnder({ visibility: 'all', daysAhead: 7 }, shift, ctx)).toBe(false)   // 8 days away
    expect(visibleUnder({ visibility: 'all', daysAhead: 8 }, shift, ctx)).toBe(true)
    expect(visibleUnder(DEFAULT_SETTINGS, shift, { ...ctx, answered: new Set(['s1']) })).toBe(false)
    expect(visibleUnder(DEFAULT_SETTINGS, { ...shift, respondBy: '2026-11-02T09:00:00' }, ctx)).toBe(false)
  })
  test('a decline needs a listed reason; another reason needs words; settings are checked', () => {
    expect(declineProblem(undefined, '')).toBe('Pick why you are turning this shift down.')
    expect(declineProblem('busy', '')).toBeNull()
    expect(declineProblem('other', '  ')).toBe('Write the reason.')
    expect((sanitizeSettings({ visibility: 'some' }) as any).problem).toContain('Choose what caregivers see')
    expect((sanitizeSettings({ daysAhead: 0 }) as any).problem).toContain('Days ahead must be a whole number from 1 to 365')
    expect((sanitizeSettings({ daysAhead: '' }, { visibility: 'all', daysAhead: 5 }) as any).settings.daysAhead).toBeNull()
  })
  test('warnings name who cannot be reached by what', () => {
    const p = (o: any) => ({ id: 'x', firstName: 'Cy', lastName: 'Carer', phone: '1', email: 'e', hasApp: true, ...o })
    expect(reachProblems([p({})], ['app', 'push', 'sms', 'email'])).toEqual([])
    expect(reachProblems([p({ phone: null })], ['sms'])[0].problems[0]).toContain('no phone number')
    expect(reachProblems([p({ phone: null })], ['email'])).toEqual([])
    expect(reachProblems([p({ email: null })], ['email'])[0].problems[0]).toContain('no email address')
    expect(reachProblems([p({ hasApp: false })], ['push'])[0].problems[0]).toContain('has not signed in to the app')
  })
})

describe('decline and hide', () => {
  test('a decline needs a reason from the list; it takes the offer off their list and counts on the board', async () => {
    ids.s1 = await post()
    expect(await available('ann')).toContain(ids.s1)
    expect((await send('ann', 'POST', `/api/open-shift-offers/${ids.s1}/decline`, {})).status).toBe(400)
    expect((await send('ann', 'POST', `/api/open-shift-offers/${ids.s1}/decline`, { reason: 'other' })).status).toBe(400)
    const reasons = (await send('ann', 'GET', '/api/open-shift-offers/reasons')).body.reasons
    expect(reasons.map((r: any) => r.label)).toContain('It is too far')
    expect((await send('ann', 'POST', `/api/open-shift-offers/${ids.s1}/decline`, { reason: 'too_far' })).status).toBe(200)
    expect(await available('ann')).not.toContain(ids.s1)
    expect(await available('dee')).toContain(ids.s1)
    expect((await send('bob', 'POST', `/api/open-shift-offers/${ids.s1}/hide`, {})).status).toBe(200)
    expect(await available('bob')).not.toContain(ids.s1)
    expect((await row(ids.s1)).counts).toMatchObject({ declined: 1, hidden: 1 })
  })
  test('a caregiver cannot decline for someone else\'s offer and cannot answer one already taken; the office\'s side is closed to them', async () => {
    const mine = await post({ shiftDate: addDays(today, 11) })
    await t.db.update(t.schema.openShifts).set({ visibleTo: [ids.dee] } as any).where(eq(t.schema.openShifts.id, mine))
    expect((await send('ann', 'POST', `/api/open-shift-offers/${mine}/decline`, { reason: 'busy' })).status).toBe(403)
    const taken = await post({ shiftDate: addDays(today, 12) })
    await t.db.update(t.schema.openShifts).set({ status: 'filled' } as any).where(eq(t.schema.openShifts.id, taken))
    expect((await send('ann', 'POST', `/api/open-shift-offers/${taken}/hide`, {})).status).toBe(409)
    for (const [m, p, b] of [['GET', '/api/open-shift-offers/settings'], ['PUT', '/api/open-shift-offers/settings', { visibility: 'none' }], ['GET', '/api/open-shift-offers/board'], ['POST', `/api/open-shift-offers/${mine}/resend`, { mode: 'new' }], ['PUT', `/api/open-shift-offers/${mine}/deadline`, { respondBy: null }], ['GET', `/api/open-shift-offers/${mine}/outbox`]] as const) {
      expect((await send('ann', m, p, b as any)).status).toBe(403)
    }
  })
})

describe('offer status, counts and the answer-by time', () => {
  test('a posting goes Not sent → Pending → Declined (everyone answered), with counts; an answer-by time that passes expires it', async () => {
    const id = await post({ shiftDate: addDays(today, 13) })
    expect((await row(id)).offerStatusLabel).toBe('Not sent')
    const told = await send('owner', 'POST', `/api/open-shifts/${id}/notify`, { caregiverIds: [ids.ann, ids.dee] })
    expect(told.status).toBe(200)
    expect(told.body.notified).toBe(2)
    expect(await row(id)).toMatchObject({ offerStatusLabel: 'Pending', counts: { sent: 2, accepted: 0, declined: 0, noAnswer: 2 } })
    await send('ann', 'POST', `/api/open-shift-offers/${id}/decline`, { reason: 'busy' })
    expect((await row(id)).counts).toMatchObject({ declined: 1, noAnswer: 1 })
    expect((await row(id)).offerStatusLabel).toBe('Pending')
    await send('dee', 'POST', `/api/open-shift-offers/${id}/decline`, { reason: 'other', note: 'Away that week' })
    expect((await row(id)).offerStatusLabel).toBe('Declined — everyone answered')
    // an answer-by time in the past: expired, gone from the phone, and a claim is refused
    const exp = await post({ shiftDate: addDays(today, 14) })
    await send('owner', 'POST', `/api/open-shifts/${exp}/notify`, { caregiverIds: [ids.ann] })
    expect((await send('owner', 'PUT', `/api/open-shift-offers/${exp}/deadline`, { respondBy: 'soon' })).status).toBe(400)
    expect((await send('owner', 'PUT', `/api/open-shift-offers/${exp}/deadline`, { respondBy: `${addDays(today, 1)} 17:00` })).status).toBe(200)
    expect(await available('ann')).toContain(exp)
    expect((await row(exp)).respondBy).toBe(`${addDays(today, 1)}T17:00:00`)
    await t.db.update(t.schema.openShifts).set({ respondBy: new Date(`${addDays(today, -1)}T12:00:00Z`) } as any)   // the company's clock is a wall time, stored as written.where(eq(t.schema.openShifts.id, exp))
    expect((await row(exp)).offerStatusLabel).toBe('Expired')
    expect(await available('ann')).not.toContain(exp)
    const late = await send('ann', 'POST', `/api/open-shifts/${exp}/claim`, {})
    expect(late.status).toBe(409)
    expect(late.text).toContain('The time to answer this offer has passed')
  })
})

describe('what caregivers see, set by the agency', () => {
  test('none / only what was sent them / all, and how many days ahead', async () => {
    const near = await post({ shiftDate: addDays(today, 3) }), far = await post({ shiftDate: addDays(today, 40) })
    expect(await available('ann')).toEqual(expect.arrayContaining([near, far]))
    expect((await send('owner', 'PUT', '/api/open-shift-offers/settings', { daysAhead: 14 })).status).toBe(200)
    expect(await available('ann')).toContain(near)
    expect(await available('ann')).not.toContain(far)
    expect((await send('owner', 'PUT', '/api/open-shift-offers/settings', { visibility: 'sent' })).status).toBe(200)
    expect(await available('ann')).not.toContain(near)
    await send('owner', 'POST', `/api/open-shifts/${near}/notify`, { caregiverIds: [ids.ann] })
    expect(await available('ann')).toContain(near)
    expect(await available('dee')).not.toContain(near)
    expect((await send('owner', 'PUT', '/api/open-shift-offers/settings', { visibility: 'none' })).status).toBe(200)
    expect(await available('ann')).toEqual([])
    expect((await send('owner', 'PUT', '/api/open-shift-offers/settings', { visibility: 'bogus' })).status).toBe(400)
    // the office still sees everything on its own board
    expect((await board()).map((s) => s.id)).toContain(near)
    await send('owner', 'PUT', '/api/open-shift-offers/settings', { visibility: 'all', daysAhead: null })
  })
})

describe('messages: channels, settings honoured, an outbox, warnings, resend', () => {
  test('a warning before sending says who cannot be reached by what', async () => {
    const id = await post({ shiftDate: addDays(today, 15) })
    const w = (await send('owner', 'GET', `/api/open-shift-offers/${id}/check?channels=sms,email,push&caregiverIds=${ids.bob},${ids.cy},${ids.ann}`)).body.data
    const byName = Object.fromEntries(w.map((x: any) => [x.name, x.problems.join(' | ')]))
    expect(byName['Bob Carer']).toContain('no phone number')
    expect(byName['Cy Carer']).toContain('has not signed in to the app')
    expect(byName['Ann Carer']).toBeUndefined()
  })

  test('text and email go out, a person\'s own settings are honoured, and every message is kept with how it ended', async () => {
    const id = await post({ shiftDate: addDays(today, 16) })
    texts.length = 0; emails.length = 0; t.pushed.length = 0
    const r = await send('owner', 'POST', `/api/open-shifts/${id}/notify`, { caregiverIds: [ids.ann, ids.bob, ids.cy, ids.dee], sms: true, email: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ notified: 4, texted: 2, emailed: 4, pushed: 2, pushFailed: 2 })   // texts: Ann, Cy (Bob has no phone, Dee turned them off)
    expect(texts.length).toBe(2)
    expect(emails.map((m) => m.to).sort()).toEqual(['ann@test.example', 'bob@test.example', 'cy@test.example', 'dee@test.example'])
    const out = (await send('owner', 'GET', `/api/open-shift-offers/${id}/outbox`)).body.data as any[]
    const pick = (who: string, ch: string) => out.find((m) => m.caregiverId === ids[who] && m.channel === ch)
    expect(pick('ann', 'app')).toMatchObject({ status: 'delivered', statusLabel: 'Delivered', channelLabel: 'App notice' })
    expect(pick('ann', 'sms')).toMatchObject({ status: 'sent', target: '6085550201' })
    expect(pick('bob', 'sms')).toMatchObject({ status: 'skipped', detail: 'No phone number on file.' })
    expect(pick('dee', 'sms')).toMatchObject({ status: 'skipped' })
    expect(pick('dee', 'sms').detail).toContain('notification settings turn texts off')
    expect(pick('cy', 'push')).toMatchObject({ status: 'failed', statusLabel: 'Failed' })
    expect(pick('ann', 'push')).toMatchObject({ status: 'sent', detail: '1 device' })
    ids.outShift = id
  })

  test('resend the failures only, then only the newly added, then everyone with answers cleared', async () => {
    const id = ids.outShift
    // Cy now has the app (a phone token): the failed phone alert is retried and nothing else is.
    await t.db.insert(t.schema.expoPushTokens).values({ companyId, userId: ids.cy, token: phoneOf('cy'), platform: 'ios' } as any)
    texts.length = 0; emails.length = 0; t.pushed.length = 0
    const again = await send('owner', 'POST', `/api/open-shift-offers/${id}/resend`, { mode: 'failed' })
    expect(again.status).toBe(200)
    expect(t.pushed.map((m: any) => m.to)).toEqual([phoneOf('cy')])
    expect(texts.length).toBe(0); expect(emails.length).toBe(0)
    // Bob's push also failed (no token) and still does: it stays failed; nothing failed for Cy any more.
    expect((await send('owner', 'POST', `/api/open-shift-offers/${id}/resend`, { mode: 'failed' })).body.pushFailed).toBe(2 - 1)
    // A new caregiver joins: "new" tells only her.
    ids.eve = (await ins(t.schema.user, { email: 'eve@test.example', passwordHash: 'x', firstName: 'Eve', lastName: 'Carer', role: 'caregiver', companyId, phone: '6085550299' })).id
    t.pushed.length = 0
    const fresh = await send('owner', 'POST', `/api/open-shift-offers/${id}/resend`, { mode: 'new' })
    expect(fresh.status).toBe(200)
    expect(fresh.body.notified).toBe(1)
    const out = (await send('owner', 'GET', `/api/open-shift-offers/${id}/outbox`)).body.data as any[]
    expect(out.filter((m) => m.caregiverId === ids.eve).length).toBeGreaterThan(0)
    expect((await send('owner', 'POST', `/api/open-shift-offers/${id}/resend`, { mode: 'new' })).status).toBe(409)
    // "everyone" clears answers: Ann had declined, and sees it again.
    await send('ann', 'POST', `/api/open-shift-offers/${id}/decline`, { reason: 'busy' })
    expect(await available('ann')).not.toContain(id)
    const all = await send('owner', 'POST', `/api/open-shift-offers/${id}/resend`, { mode: 'everyone' })
    expect(all.status).toBe(200)
    expect(all.body.answersCleared).toBe(1)
    expect(await available('ann')).toContain(id)
    expect((await send('owner', 'POST', `/api/open-shift-offers/${id}/resend`, { mode: 'sideways' })).status).toBe(400)
  })

  test('without the feature the old broadcast is unchanged and the new routes answer 403', async () => {
    await setFeatures(BASE)
    expect((await send('owner', 'GET', '/api/open-shift-offers/board')).status).toBe(403)
    const id = await post({ shiftDate: addDays(today, 17) })
    const r = await send('owner', 'POST', `/api/open-shifts/${id}/notify`, { caregiverIds: [ids.ann], email: true })
    expect(r.body).toMatchObject({ notified: 1, texted: 0 })
    expect(r.body.emailed).toBeUndefined()
    await setFeatures([...BASE, 'care_open_shift_offers'])
  })
})

describe('first to accept gets it', () => {
  test('two caregivers tapping at once: exactly one gets it, the other is told it is gone', async () => {
    const id = await post({ shiftDate: addDays(today, 20), autoAssign: true } as any)
    await t.db.update(t.schema.openShifts).set({ autoAssign: true, createdById: ids.owner ?? null } as any).where(eq(t.schema.openShifts.id, id))
    const [a, b] = await Promise.all([send('ann', 'POST', `/api/open-shifts/${id}/claim`, {}), send('dee', 'POST', `/api/open-shifts/${id}/claim`, {})])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const winner = a.status === 200 ? ids.ann : ids.dee
    const [stored] = await t.db.select().from(t.schema.openShifts).where(eq(t.schema.openShifts.id, id)) as any[]
    expect(stored.status).toBe('filled')
    expect(stored.claimedById).toBe(winner)
    const loser = a.status === 409 ? a : b
    expect(loser.text).toContain('Someone else just took this shift')
    const claims = await t.db.select().from(t.schema.openShiftClaims).where(eq(t.schema.openShiftClaims.openShiftId, id)) as any[]
    expect(claims.length).toBe(1)
  })
})

describe('a whole recurring series offered at once', () => {
  test('it posts one shift per week the visit happens; the first to accept takes them all; a clash refuses it', async () => {
    const dow = (n: number) => new Date(`${addDays(today, 21)}T12:00:00Z`).getUTCDay()
    const wd = dow(0)
    const sched = await send('owner', 'POST', '/api/schedules-enhanced', { caregiverId: ids.eve, clientId: ids.pat, scheduleType: 'recurring', dayOfWeek: wd, startTime: '13:00', endTime: '15:00', frequency: 'weekly' })
    expect(sched.status).toBe(201)
    const sid = sched.body.id ?? sched.body.schedule?.id ?? sched.body.data?.id
    expect((await send('owner', 'POST', `/api/open-shift-offers/series/${sid}`, { from: addDays(today, 21), weeks: 1 })).status).toBe(400)
    const posted = await send('owner', 'POST', `/api/open-shift-offers/series/${sid}`, { from: addDays(today, 21), weeks: 3, autoAssign: true, bonusAmount: 10 })
    expect(posted.status).toBe(201)
    expect(posted.body.posted).toBe(3)
    const second = await send('owner', 'POST', `/api/open-shift-offers/series/${sid}`, { from: addDays(today, 21), weeks: 3 })
    expect(second.status).toBe(409)   // already posted: fewer than two left
    const rows = (await board()).filter((s) => s.seriesId === posted.body.seriesId)
    expect(rows.length).toBe(3)
    // Dee has a visit on the second week's day: she cannot take the series, and nothing is claimed.
    await send('owner', 'POST', '/api/schedules', { caregiverId: ids.dee, clientId: ids.pat, scheduleType: 'one-time', date: addDays(today, 28), startTime: '13:00', endTime: '14:00' })
    const clash = await send('dee', 'POST', `/api/open-shifts/${posted.body.ids[0]}/claim`, {})
    expect(clash.status).toBe(400)
    expect(clash.text).toContain('you cannot take this series')
    expect((await board()).filter((s) => s.seriesId === posted.body.seriesId && s.status === 'open').length).toBe(3)
    // Ann takes one and gets all three.
    const phoneRows = (await send('ann', 'GET', '/api/open-shifts/available')).body.data as any[]
    expect(phoneRows.find((s) => s.id === posted.body.ids[0]).seriesVisits).toBe(3)
    const took = await send('ann', 'POST', `/api/open-shifts/${posted.body.ids[1]}/claim`, {})
    expect(took.status).toBe(200)
    expect(took.body.visits ?? took.body.data?.visits).toBe(3)
    const after = (await board()).filter((s) => s.seriesId === posted.body.seriesId)
    expect(after.every((s) => s.status === 'filled' && s.claimedById === ids.ann)).toBe(true)
    expect((await send('dee', 'POST', `/api/open-shifts/${posted.body.ids[2]}/claim`, {})).status).toBe(400)
  })
})
