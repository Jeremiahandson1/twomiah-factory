// Home care depth, item 8 (docs/parity/homecare-cert-expiry.md): credential-expiry reminders. A daily scan tells the
// caregiver and the office at 30, 14 and 0 days before an active credential expires — once per stage, only for a company that
// has the care_cert_reminders feature on (not ready until the owner tests it) — and an expired caregiver is flagged (never
// hidden or blocked) when scheduling.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const phone = (who: string) => `ExponentPushToken[${who}-phone]`

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const noticesFor = async (userId: string) => (await t.db.select().from(t.schema.notifications)
  .where(and(eq(t.schema.notifications.userId, userId), eq(t.schema.notifications.type, 'certification_expiring')))) as any[]
let today = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  today = await core.time.today(companyId)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bob', 'cy']) {
    const u = await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId })
    ids[who] = u.id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
    expect((await as(who)('/api/push/expo-token', { method: 'POST', json: { token: phone(who), platform: 'ios' } })).status).toBe(201)
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  const give = async (caregiverId: string, certificationType: string, expiryDate: string, status = 'active') =>
    (await json(await as('owner')('/api/certifications', { method: 'POST', json: { caregiverId, certificationType, expiryDate, status } }))).body.id as string
  ids.cpr = await give(ids.ann, 'CPR', addDays(today, 30))
  ids.firstAid = await give(ids.ann, 'First Aid', addDays(today, 14))
  ids.license = await give(ids.bob, "Driver's license", today)
  ids.tb = await give(ids.bob, 'TB test', addDays(today, -3))
  await give(ids.cy, 'Food handler', addDays(today, 45))
  await give(ids.cy, 'Old training', addDays(today, -40))
  await give(ids.cy, 'Revoked cert', addDays(today, 5), 'revoked')
}, 90_000)

describe('home care — credential expiry reminders (item 8)', () => {
  test('with the feature off, nothing is sent', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    expect(await core.certReminders.scanCertReminders()).toBe(0)
    expect((await noticesFor(ids.ann)).length).toBe(0)
  })

  test('with it on: each credential is told at its stage, to the caregiver and the office, and only once', async () => {
    await setFeatures(['contacts', 'scheduling', 'team', 'care_cert_reminders'])
    t.pushed.length = 0
    // CPR (30 days), First Aid (14), the licence (today), the TB test (expired 3 days ago). Not: 45 days out, expired 40 days
    // ago, a revoked record.
    expect(await core.certReminders.scanCertReminders()).toBe(4)
    const ann = await noticesFor(ids.ann)
    expect(ann.map((n) => n.message).sort()).toEqual([
      `Your CPR expires in 30 days (${addDays(today, 30)}). Send the office the renewed copy.`,
      `Your First Aid expires in 14 days (${addDays(today, 14)}). Send the office the renewed copy.`,
    ])
    const bob = (await noticesFor(ids.bob)).map((n) => n.message).sort()
    expect(bob).toEqual([
      `Your Driver's license expires today (${today}). Send the office the renewed copy.`,
      `Your TB test expired on ${addDays(today, -3)}. Send the office the renewed copy.`,
    ])
    expect((await noticesFor(ids.cy)).length).toBe(0)
    // The office hears about each too.
    const office = (await noticesFor(ids.owner)).map((n) => n.message).sort()
    expect(office.length).toBe(4)
    expect(office.some((m) => m.startsWith('Ann Carer: CPR expires in 30 days'))).toBe(true)
    expect(office.some((m) => m.startsWith('Bob Carer: Driver') && m.includes('flagged when scheduling'))).toBe(true)
    // …and the caregivers' phones.
    expect(t.pushed.map((m: any) => m.to).sort()).toEqual([phone('ann'), phone('ann'), phone('bob'), phone('bob')])
    // A second scan the same day sends nothing.
    expect(await core.certReminders.scanCertReminders()).toBe(0)
    expect((await noticesFor(ids.ann)).length).toBe(2)
  })

  test('as the days pass the next stage goes out; a renewal starts the reminders over', async () => {
    // 16 days later the CPR is 14 days away: the 14-day reminder. (First Aid has expired by then: its 0-day stage.)
    const later = new Date(Date.now() + 16 * 86400000)
    expect(await core.certReminders.scanCertReminders(later)).toBeGreaterThanOrEqual(2)
    const cprNotes = (await noticesFor(ids.ann)).filter((n) => n.message.includes('CPR'))
    expect(cprNotes.length).toBe(2)
    // Renewed: a new expiry date is a new set of reminders.
    const renewed = addDays(today, 10)
    await t.db.update(t.schema.certificationRecords).set({ expiryDate: renewed } as any).where(eq(t.schema.certificationRecords.id, ids.license))
    expect(await core.certReminders.scanCertReminders()).toBe(1)
    expect((await noticesFor(ids.bob)).some((n) => n.message.includes(`expires in 10 days (${renewed})`))).toBe(true)
  })

  test('a caregiver whose credential has expired is flagged when scheduling, not hidden', async () => {
    const day = addDays(today, 3)
    const ranked = (await json(await as('owner')(`/api/scheduling/suggest-caregivers?clientId=${ids.pat}&date=${day}&startTime=09:00&endTime=11:00`))).body.suggestions
    const bob = ranked.find((s: any) => s.id === ids.bob)
    const cy = ranked.find((s: any) => s.id === ids.cy)
    expect(bob.expiredCertifications).toEqual([`TB test (expired ${addDays(today, -3)})`])
    expect(bob.reasons).toContain(`⚠️ Expired credential: TB test (expired ${addDays(today, -3)})`)
    expect(cy.expiredCertifications).toEqual(expect.arrayContaining([`Old training (expired ${addDays(today, -40)})`]))
    expect(ranked.find((s: any) => s.id === ids.ann).expiredCertifications).toEqual([])
    expect(bob.score).toBeLessThan(ranked.find((s: any) => s.id === ids.ann).score)
    // The shift can still be made; the reply says why to look twice.
    const made = await json(await as('owner')('/api/schedules', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.pat, scheduleType: 'one-time', date: day, startTime: '09:00', endTime: '11:00' } }))
    expect(made.status).toBe(201)
    expect(made.body.credentialWarnings).toEqual([`TB test (expired ${addDays(today, -3)})`])
    // A caregiver may not use the office's matching.
    expect((await as('ann')(`/api/scheduling/suggest-caregivers?clientId=${ids.pat}`)).status).toBe(403)
  })

  test('with the feature off the scheduling screens carry no flags', async () => {
    await setFeatures(['contacts', 'scheduling', 'team'])
    const ranked = (await json(await as('owner')(`/api/scheduling/suggest-caregivers?clientId=${ids.pat}&date=${addDays(today, 4)}&startTime=09:00&endTime=11:00`))).body.suggestions
    expect(ranked.every((s: any) => s.expiredCertifications.length === 0)).toBe(true)
    const made = await json(await as('owner')('/api/schedules', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.pat, scheduleType: 'one-time', date: addDays(today, 5), startTime: '09:00', endTime: '11:00' } }))
    expect(made.body.credentialWarnings).toEqual([])
  })
})
