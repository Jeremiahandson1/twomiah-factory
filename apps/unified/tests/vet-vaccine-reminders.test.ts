// Automatic vaccine reminders (server/crm/vet/vaccineReminders.ts). Reminders & Recall was called "automated" and every
// reminder was sent by hand (matrix 10/23). Through the real server and database; the clock is pinned (each pass is
// handed its `now`); no text leaves — the texting service is a recorder standing in for the shop's own number.
//   · off until the clinic switches it on; on, only between 9am and 7pm on the clinic's clock;
//   · the latest shot per pet and vaccine, due from today to the lead time ahead, a living pet only;
//   · one text per owner, naming every pet and vaccine; once per due date — a second pass sends nothing, a renewed
//     shot (a new due date) earns its own;
//   · an owner who texted STOP is never texted — automatically or by hand; refused texting (not set up, wallet empty)
//     is held and tried again; what went out stamps the shot and the owner (the page's Reminded column);
//   · the settings door: validated, owner/admin only; the manual send still works.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createVaccineReminders, vetReminderSettings, DEFAULT_VET_MESSAGE } from '../server/crm/vet/vaccineReminders.ts'

const json = async (r: Response) => (await r.json()) as any
/** A moment on the Chicago clock (CDT until 1 Nov 2026, CST after). */
const chicago = (local: string) => { const d = new Date(`${local}Z`); const off = d < new Date('2026-11-01T07:00:00Z') ? 5 : 6; return new Date(d.getTime() + off * 3600_000) }

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner: (p: string, init?: any) => Promise<Response>
let manager: (p: string, init?: any) => Promise<Response>
const texts: Array<{ companyId: string; msg: any }> = []
let reply: any = { status: 'sent' }
const sms = { sendSMS: async (cid: string, msg: any) => { texts.push({ companyId: cid, msg }); return typeof reply === 'function' ? reply() : reply } }
let engine: ReturnType<typeof createVaccineReminders>
let ann = '', bob = '', luna = '', max = '', rex = ''

async function shot(patientId: string, vaccine: string, given: string, due: string) {
  return (await t.db.insert(t.schema.vaccination).values({ companyId, patientId, vaccine, givenDate: given, dueDate: due } as any).returning())[0]
}
const setRules = (rules: any) => owner('/api/reminders/settings', { method: 'PUT', json: rules })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'vet' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'Paws Clinic', timezone: 'America/Chicago', enabledFeatures: ['contacts', 'patient_records', 'reminders_recall'] } as any).where(eq(t.schema.company.id, companyId))
  const tok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } }))).accessToken
  owner = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
  await t.db.insert(t.schema.user).values({ email: 'manager@test.example', passwordHash: await Bun.password.hash('Manager-pass-1', 'bcrypt'), firstName: 'Mae', lastName: 'Manager', role: 'manager', companyId } as any)
  const mtok = (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: 'manager@test.example', password: 'Manager-pass-1' } }))).accessToken
  manager = (p, init = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${mtok}` } }))
  ann = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', mobile: '6085550100', type: 'client' } as any).returning())[0].id
  bob = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Bob Stop', mobile: '6085550101', type: 'client', optedOutSms: true } as any).returning())[0].id
  luna = (await t.db.insert(t.schema.patient).values({ companyId, ownerId: ann, name: 'Luna' } as any).returning())[0].id
  max = (await t.db.insert(t.schema.patient).values({ companyId, ownerId: ann, name: 'Max', species: 'cat' } as any).returning())[0].id
  rex = (await t.db.insert(t.schema.patient).values({ companyId, ownerId: bob, name: 'Rex' } as any).returning())[0].id
  engine = createVaccineReminders({ db: t.db, sms, logger: console as any, isFeatureEnabled: t.services.features.isFeatureEnabled })
}, 120_000)

describe('the settings door', () => {
  test('off by default, 14 days ahead, the manual text\'s words', async () => {
    expect(vetReminderSettings({})).toEqual({ auto: false, leadDays: 14, message: DEFAULT_VET_MESSAGE })
    expect(await json(await owner('/api/reminders/settings'))).toMatchObject({ auto: false, leadDays: 14 })
  })
  test('a manager reads but cannot change it; bad values are refused by field', async () => {
    expect((await manager('/api/reminders/settings')).status).toBe(200)
    expect((await manager('/api/reminders/settings', { method: 'PUT', json: { auto: true, leadDays: 14, message: 'x' } })).status).toBe(403)
    const bad = await setRules({ auto: true, leadDays: 200, message: '' })
    expect(bad.status).toBe(400)
    expect(Object.keys((await json(bad)).fields)).toEqual(expect.arrayContaining(['leadDays', 'message']))
  })
})

describe('the daily pass', () => {
  test('off: nothing is texted', async () => {
    await shot(luna, 'Rabies', '2025-10-30', '2026-10-30')
    await engine.runOnce(chicago('2026-10-23T10:00:00'))
    expect(texts).toEqual([])
  })

  test('on: one text per owner naming every pet and shot due in the window; not before 9am; once per due date', async () => {
    await shot(max, 'FVRCP', '2025-11-02', '2026-11-02')
    await shot(luna, 'DHPP', '2025-12-30', '2026-12-30')        // outside 14 days
    await shot(rex, 'Rabies', '2025-10-31', '2026-10-31')        // Bob replied STOP
    expect((await setRules({ auto: true, leadDays: 14, message: DEFAULT_VET_MESSAGE })).status).toBe(200)
    await engine.runOnce(chicago('2026-10-23T08:30:00'))
    expect(texts).toEqual([])
    await engine.runOnce(chicago('2026-10-23T09:15:00'))
    expect(texts.length).toBe(1)
    expect(texts[0].msg).toMatchObject({ contactId: ann, toPhone: '6085550100' })
    expect(texts[0].msg.message).toBe("Hi Ann, it's Paws Clinic with a reminder: Rabies and FVRCP for Luna and Max, due October 30 and November 2. Call us and we'll get it booked in.")
    await engine.runOnce(chicago('2026-10-23T14:00:00'))
    await engine.runOnce(chicago('2026-10-24T09:15:00'))
    expect(texts.length).toBe(1)
    const vax = await t.db.select().from(t.schema.vaccination).where(eq(t.schema.vaccination.patientId, luna))
    expect(vax.find((v: any) => v.vaccine === 'Rabies')).toMatchObject({ reminderCount: 1 })
    expect(vax.find((v: any) => v.vaccine === 'DHPP')).toMatchObject({ reminderCount: 0 })
    const [a] = await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, ann))
    expect(a.lastRemindedAt).toBeTruthy()
    const log = await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.kind, 'vaccine_reminder'))
    expect(log.filter((l: any) => l.status === 'sent').map((l: any) => l.step).sort()).toEqual(['due:2026-10-30', 'due:2026-11-02'])
    expect(log.find((l: any) => l.step === 'due:2026-10-31')).toMatchObject({ status: 'skipped', detail: 'The owner asked not to be texted (STOP).' })
  })

  test('a renewed shot (a new due date) earns its own reminder; a deceased pet earns none', async () => {
    await shot(luna, 'Rabies', '2026-10-25', '2026-11-20') // given early, due again
    const [ghost] = await t.db.insert(t.schema.patient).values({ companyId, ownerId: ann, name: 'Ghost', deceased: true } as any).returning()
    await shot(ghost.id, 'Rabies', '2025-11-10', '2026-11-10')
    texts.length = 0
    await engine.runOnce(chicago('2026-11-10T09:15:00'))
    expect(texts.map((x) => x.msg.message)).toEqual(["Hi Ann, it's Paws Clinic with a reminder: Rabies for Luna, due November 20. Call us and we'll get it booked in."])
  })

  test('texting refused (not set up / wallet empty): held and tried again on the next pass, not spent', async () => {
    const [cara] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Cara Cat', mobile: '6085550102', type: 'client' } as any).returning()
    const [tom] = await t.db.insert(t.schema.patient).values({ companyId, ownerId: cara.id, name: 'Tom', species: 'cat' } as any).returning()
    await shot(tom.id, 'FeLV', '2025-12-01', '2026-12-01')
    texts.length = 0
    reply = { status: 'refused', refused: true, errorMessage: 'Messaging paused: usage wallet is empty — top up to resume.' }
    await engine.runOnce(chicago('2026-11-25T09:15:00'))
    const [held] = await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.step, 'due:2026-12-01'))
    expect(held).toMatchObject({ status: 'held' })
    reply = { status: 'sent' }
    await engine.runOnce(chicago('2026-11-25T10:15:00'))
    expect(texts.filter((x) => x.msg.contactId === cara.id).length).toBe(2)
    const [after] = await t.db.select().from(t.schema.reminderLog).where(eq(t.schema.reminderLog.step, 'due:2026-12-01'))
    expect(after.status).toBe('sent')
    await engine.runOnce(chicago('2026-11-26T10:15:00'))
    expect(texts.filter((x) => x.msg.contactId === cara.id).length).toBe(2)
  })

  test('the Reminders & Recall switch off: nothing goes', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'patient_records'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures(companyId)
    const [dan] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dan Dog', mobile: '6085550103', type: 'client' } as any).returning()
    const [fido] = await t.db.insert(t.schema.patient).values({ companyId, ownerId: dan.id, name: 'Fido' } as any).returning()
    await shot(fido.id, 'Rabies', '2025-12-05', '2026-12-05')
    texts.length = 0
    await engine.runOnce(chicago('2026-11-30T09:15:00'))
    expect(texts).toEqual([])
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'patient_records', 'reminders_recall'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures(companyId)
  })
})

describe('the manual send stays, and honours STOP', () => {
  test('an opted-out owner is not texted by hand; the reply says why', async () => {
    const real = t.services.crm.sms.sendSMS
    const sent: any[] = []
    ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { sent.push(m); return { status: 'sent' } }
    try {
      const r = await json(await owner('/api/reminders/send', { method: 'POST', json: { contactIds: [bob], message: 'Hi {{owner_name}}' } }))
      expect(r).toMatchObject({ sent: 0, failed: 1, optedOut: 1, error: 'That owner asked not to be texted (they replied STOP).' })
      const ok = await json(await owner('/api/reminders/send', { method: 'POST', json: { contactIds: [ann], message: 'Hi {{owner_name}}' } }))
      expect(ok).toMatchObject({ sent: 1 })
      expect(sent.map((m) => m.message)).toEqual(['Hi Ann'])
    } finally { (t.services.crm.sms as any).sendSMS = real }
  })
})
