// Home care depth, item 9 (docs/parity/homecare-family-text.md): a text to the relatives who asked for it when the caregiver
// clocks in and when they clock out — from the agency's own texting service, once per punch, never in quiet hours (9 PM–8 AM
// on the agency's clock), never for a relative who did not opt in, and only for a company with care_family_texts on.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const texts: any[] = []

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const logRows = async (timeEntryId: string) => (await t.db.select().from(t.schema.familyVisitText).where(eq(t.schema.familyVisitText.timeEntryId, timeEntryId))) as any[]
const member = async (body: any) => (await json(await as('owner')('/api/family-portal/admin/members', { method: 'POST', json: { clientId: ids.pat, password: 'Family-pass-1', ...body } })))

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', name: 'Test Care' } as any).where(eq(t.schema.company.id, companyId))
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures(['contacts', 'scheduling', 'team', 'care_family_texts'])
}, 90_000)

const entry = async () => ins(t.schema.timeEntries, { companyId, caregiverId: ids.ann, clientId: ids.pat, startTime: new Date('2026-12-02T15:00:00Z'), endTime: new Date('2026-12-02T17:00:00Z'), isComplete: true, durationMinutes: 120, allottedMinutes: 120 })
const at = (iso: string) => new Date(iso)

describe('home care — family text on clock-in / clock-out (item 9)', () => {
  test('the office records a relative\'s yes (needs a phone); a caregiver cannot', async () => {
    const mary = await member({ name: 'Mary Client', email: 'mary@family.example', phone: '608-555-0111', visitTextOptIn: true })
    expect(mary.status).toBe(201)
    expect(mary.body).toMatchObject({ visitTextOptIn: true })
    expect(mary.body.visitTextOptInAt).toBeTruthy()
    ids.mary = mary.body.id
    const joe = await member({ name: 'Joe Client', email: 'joe@family.example', phone: '608-555-0122' })
    expect(joe.body.visitTextOptIn).toBe(false)
    ids.joe = joe.body.id
    const noPhone = await member({ name: 'Nia Client', email: 'nia@family.example', visitTextOptIn: true })
    expect(noPhone.body.visitTextOptIn).toBe(false)
    ids.nia = noPhone.body.id
    const need = await json(await as('owner')(`/api/family-portal/admin/members/${ids.nia}`, { method: 'PUT', json: { visitTextOptIn: true } }))
    expect(need.status).toBe(400)
    expect(need.body.code).toBe('phone_required')
    const ok = await json(await as('owner')(`/api/family-portal/admin/members/${ids.nia}`, { method: 'PUT', json: { visitTextOptIn: true, phone: '608-555-0133' } }))
    expect(ok.body.visitTextOptIn).toBe(true)
    expect((await as('owner')(`/api/family-portal/admin/members/${ids.nia}`, { method: 'PUT', json: { visitTextOptIn: false } })).status).toBe(200)
    expect((await as('ann')(`/api/family-portal/admin/members/${ids.joe}`, { method: 'PUT', json: { visitTextOptIn: true } })).status).toBe(403)
  })

  test('arrival and departure texts go to the relative who opted in, from the agency\'s texting service', async () => {
    const e = await entry()
    texts.length = 0
    const noon = at('2026-12-02T17:00:00Z') // 11:00 AM Central
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', noon, noon)).toBe(1)
    expect(texts.length).toBe(1)
    expect(texts[0].toPhone).toBe('+16085550111')
    expect(texts[0].message).toBe('Test Care: Ann has arrived to help Pat (11:00 AM). Reply STOP to stop these texts.')
    const out = at('2026-12-02T19:05:00Z')
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_out', out, out)).toBe(1)
    expect(texts[1].message).toBe('Test Care: Ann has finished the visit with Pat (1:05 PM). Reply STOP to stop these texts.')
    expect((await logRows(e.id)).map((r) => `${r.event}:${r.status}`).sort()).toEqual(['clock_in:sent', 'clock_out:sent'])
    // Nothing about care or health in either.
    expect(texts.every((m) => !/medic|health|condition|care plan/i.test(m.message))).toBe(true)
    // A replayed punch says nothing more.
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', noon, noon)).toBe(0)
    expect(texts.length).toBe(2)
  })

  test('no text in quiet hours (9 PM–8 AM, the agency\'s clock) or for a punch that reached us late', async () => {
    const e = await entry()
    texts.length = 0
    const night = at('2026-12-03T04:00:00Z') // 10:00 PM Central the day before
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', night, night)).toBe(0)
    const early = at('2026-12-03T12:30:00Z') // 6:30 AM Central
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_out', early, early)).toBe(0)
    const e2 = await entry()
    const noon = at('2026-12-02T17:00:00Z')
    expect(await core.familyTexts.onClockEvent(companyId, e2, 'clock_in', new Date(noon.getTime() - 3 * 3600000), noon)).toBe(0)
    expect(texts.length).toBe(0)
    expect((await logRows(e.id)).map((r) => `${r.event}:${r.status}`).sort()).toEqual(['clock_in:skipped_quiet', 'clock_out:skipped_quiet'])
    expect((await logRows(e2.id)).map((r) => r.status)).toEqual(['skipped_late'])
  })

  test('a failed send is recorded as failed, not sent', async () => {
    const e = await entry()
    const keep = (t.services.crm.sms as any).sendSMS
    ;(t.services.crm.sms as any).sendSMS = async () => ({ status: 'failed', errorMessage: 'carrier refused' })
    const noon = at('2026-12-02T17:00:00Z')
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', noon, noon)).toBe(0)
    ;(t.services.crm.sms as any).sendSMS = keep
    expect((await logRows(e.id)).map((r) => r.status)).toEqual(['failed'])
  })

  test('with the feature off nothing is sent or recorded', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    const e = await entry()
    texts.length = 0
    const noon = at('2026-12-02T17:00:00Z')
    expect(await core.familyTexts.onClockEvent(companyId, e, 'clock_in', noon, noon)).toBe(0)
    expect(texts.length).toBe(0)
    expect((await logRows(e.id)).length).toBe(0)
    await setFeatures(['contacts', 'scheduling', 'team', 'care_family_texts'])
  })

  test('the real clock-in and clock-out routes reach the relative (whatever hour this runs: a text, or a quiet-hours record)', async () => {
    const r = await json(await as('ann')('/api/time-entries/clock-in', { method: 'POST', json: { clientId: ids.pat, latitude: 44.8, longitude: -91.5 } }))
    expect(r.status).toBe(201)
    const wait = async (timeEntryId: string, n: number) => { for (let i = 0; i < 100 && (await logRows(timeEntryId)).length < n; i++) await Bun.sleep(20) }
    await wait(r.body.id, 1)
    expect((await logRows(r.body.id)).map((x) => x.familyMemberId)).toEqual([ids.mary])
    const out = await as('ann')(`/api/time-entries/${r.body.id}/clock-out`, { method: 'POST', json: { notes: 'done' } })
    expect(out.status).toBe(200)
    await wait(r.body.id, 2)
    expect((await logRows(r.body.id)).map((x) => x.event).sort()).toEqual(['clock_in', 'clock_out'])
    // Joe, who never opted in, was never texted.
    expect((await t.db.select().from(t.schema.familyVisitText).where(and(eq(t.schema.familyVisitText.companyId, companyId), eq(t.schema.familyVisitText.familyMemberId, ids.joe)))).length).toBe(0)
  })
})
