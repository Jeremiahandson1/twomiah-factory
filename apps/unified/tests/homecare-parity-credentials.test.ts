// Home care parity, row 1 (docs/parity/homecare-cert-expiry.md): credential tracking, finished. Lead times the agency picks,
// email reminders, credentials kept for clients, a credential search, the old "certification alerts" list filled from the
// same scan, and an agency setting that BLOCKS (not only flags) an expired caregiver on a shift. All behind care_cert_reminders.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { createHomecareCore } from '../server/crm/homecare/core/index.ts'
import { certStage, normLeadDays } from '../server/crm/homecare/core/certReminders.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let core: ReturnType<typeof createHomecareCore>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const mails: { to: string; subject: string; html: string }[] = []

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
const ON = ['contacts', 'scheduling', 'team', 'care_cert_reminders']
const noticesFor = async (userId: string, type = 'certification_expiring') => (await t.db.select().from(t.schema.notifications)
  .where(and(eq(t.schema.notifications.userId, userId), eq(t.schema.notifications.type, type)))) as any[]
let today = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  core = createHomecareCore({ services: t.services.crm } as any)
  today = await core.time.today(companyId)
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  for (const who of ['ann', 'bob']) {
    const u = await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId })
    ids[who] = u.id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  await setFeatures(ON)
}, 90_000)

const give = async (caregiverId: string, certificationType: string, expiryDate: string) =>
  (await json(await as('owner')('/api/certifications', { method: 'POST', json: { caregiverId, certificationType, expiryDate } }))).body.id as string

describe('home care parity row 1 — the lead-time rules', () => {
  test('an agency picks its own lead times; anything else is dropped; none picked means 30 / 14 / 0', () => {
    expect(normLeadDays([14, 90, 60, 7, 'x', 30])).toEqual([90, 60, 30, 14])
    expect(normLeadDays([])).toEqual([30, 14, 0])
    expect(normLeadDays(undefined)).toEqual([30, 14, 0])
  })
  test('the stage a credential is in follows the agency\'s own list', () => {
    const mine = [90, 60, 30, 0]
    expect(certStage(120, mine)).toBeNull()
    expect(certStage(75, mine)).toBe(90)
    expect(certStage(45, mine)).toBe(60)
    expect(certStage(20, mine)).toBe(30)   // 14 was not picked, so 20 days out is still the 30-day stage
    expect(certStage(5, mine)).toBe(30)    // in the stage it last crossed: with no 14 or 7 picked, 5 days out is still the 30-day stage
    expect(certStage(0, mine)).toBe(0)
    expect(certStage(-3, mine)).toBe(0)
    expect(certStage(-3, [30, 14])).toBe(14)   // no expiry-day stage picked: it is in the last stage it crossed (sent once, never repeated)
    expect(certStage(5, [])).toBeNull()         // nothing picked is not a stage
    expect(certStage(20)).toBe(30)              // the default list is unchanged
    expect(certStage(14)).toBe(14)
  })
})

describe('home care parity row 1 — settings, lead times and email', () => {
  test('the settings screen reads and writes the agency\'s choices, for the office only', async () => {
    const start = await json(await as('owner')('/api/credentials/settings'))
    expect(start.status).toBe(200)
    expect(start.body).toMatchObject({ leadDays: [30, 14, 0], email: false, blockExpired: false, leadChoices: [90, 60, 30, 14, 0] })
    const bad = await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { leadDays: [45] } }))
    expect(bad.status).toBe(400)
    expect(bad.body.fields.leadDays).toBeTruthy()
    expect((await as('ann')('/api/credentials/settings')).status).toBe(403)
    expect((await as('ann')('/api/credentials/settings', { method: 'PUT', json: { email: true } })).status).toBe(403)
    const set = await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { leadDays: [90, 60, 30, 0], email: true } }))
    expect(set.body).toMatchObject({ leadDays: [90, 60, 30, 0], email: true, blockExpired: false })
  })

  test('a credential 75 days out is reminded at the 90-day stage — by app, and by email to the caregiver and the office', async () => {
    ids.cprAnn = await give(ids.ann, 'CPR', addDays(today, 75))
    ids.tbBob = await give(ids.bob, 'TB test', addDays(today, 20))
    mails.length = 0
    expect(await core.certReminders.scanCertReminders()).toBe(2)
    expect((await noticesFor(ids.ann)).map((n) => n.message)).toEqual([`Your CPR expires in 75 days (${addDays(today, 75)}). Send the office the renewed copy.`])
    // Bob's 20 days is the 30-day stage of THIS agency (it did not pick 14).
    expect((await noticesFor(ids.bob)).length).toBe(1)
    const toAnn = mails.filter((m) => m.to === 'ann@test.example')
    expect(toAnn.length).toBe(1)
    expect(toAnn[0].subject).toBe('Credential expiring')
    expect(toAnn[0].html).toContain('CPR expires in 75 days')
    const toOffice = mails.filter((m) => m.to === 'owner@test.example')
    expect(toOffice.length).toBe(2)
    expect(toOffice.some((m) => m.html.includes('Ann Carer: CPR expires in 75 days'))).toBe(true)
    // Once: a second scan sends nothing, by app or by email.
    mails.length = 0
    expect(await core.certReminders.scanCertReminders()).toBe(0)
    expect(mails.length).toBe(0)
  })

  test('with email switched off, nobody is emailed (the app notice still goes)', async () => {
    await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { email: false } }))
    const id = await give(ids.ann, 'First Aid', addDays(today, 60))
    mails.length = 0
    expect(await core.certReminders.scanCertReminders()).toBe(1)
    expect(mails.length).toBe(0)
    expect((await noticesFor(ids.ann)).some((n) => n.message.includes('First Aid expires in 60 days'))).toBe(true)
    expect(id).toBeTruthy()
  })
})

describe('home care parity row 1 — credentials kept for clients', () => {
  test('the office records a client credential, is reminded once, and the client is not messaged', async () => {
    await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { email: true } }))
    const made = await json(await as('owner')('/api/credentials/clients', { method: 'POST', json: { clientId: ids.pat, credentialType: 'Power of attorney', expiryDate: addDays(today, 29) } }))
    expect(made.status).toBe(201)
    expect(made.body.credentialType).toBe('Power of attorney')
    mails.length = 0
    expect(await core.certReminders.scanCertReminders()).toBe(1)
    const office = await noticesFor(ids.owner, 'client_credential_expiring')
    expect(office.map((n) => n.message)).toEqual([`Pat Client: Power of attorney expires in 29 days (${addDays(today, 29)}).`])
    expect(mails.map((m) => m.to)).toEqual(['owner@test.example'])
    expect(await core.certReminders.scanCertReminders()).toBe(0)
    const listed = await json(await as('owner')(`/api/credentials/clients?clientId=${ids.pat}`))
    expect(listed.body.data.length).toBe(1)
    expect(listed.body.data[0].clientFirstName).toBe('Pat')
  })

  test('validation, company walls and permissions', async () => {
    expect((await json(await as('owner')('/api/credentials/clients', { method: 'POST', json: { clientId: ids.pat } }))).status).toBe(400)
    expect((await json(await as('owner')('/api/credentials/clients', { method: 'POST', json: { clientId: ids.pat, credentialType: 'x', expiryDate: '12/31/2026' } }))).status).toBe(400)
    expect((await json(await as('owner')('/api/credentials/clients', { method: 'POST', json: { clientId: 'nope', credentialType: 'x' } }))).status).toBe(404)
    expect((await as('ann')('/api/credentials/clients')).status).toBe(403)
  })
})

describe('home care parity row 1 — the credential search and the alerts list', () => {
  test('search by type, caregiver, expired, and expiring within N days', async () => {
    ids.oldBob = await give(ids.bob, 'Driver licence', addDays(today, -10))
    const get = async (q: string) => (await json(await as('owner')(`/api/credentials/search${q}`))).body
    const all = await get('')
    expect(all.pagination.total).toBeGreaterThanOrEqual(4)
    // Soonest expiry first: the expired licence leads.
    expect(all.data[0].certificationType).toBe('Driver licence')
    expect(all.data[0]).toMatchObject({ state: 'expired', daysLeft: -10, firstName: 'Bob' })
    expect((await get('?type=cpr')).data.map((r: any) => r.certificationType)).toEqual(['CPR'])
    expect((await get(`?caregiverId=${ids.bob}`)).data.every((r: any) => r.caregiverId === ids.bob)).toBe(true)
    expect((await get('?expired=true')).data.map((r: any) => r.certificationType)).toEqual(['Driver licence'])
    const soon = (await get('?withinDays=30')).data.map((r: any) => r.certificationType).sort()
    expect(soon).toEqual(['TB test']) // 20 days; the 60- and 75-day ones are further out; the expired one is not "within"
    expect((await get('?withinDays=90')).data.length).toBe(3)
    expect((await json(await as('owner')('/api/credentials/search?withinDays=abc'))).status).toBe(400)
    expect((await as('ann')('/api/credentials/search')).status).toBe(403)
  })

  test('the old certification alerts list is filled by the scan, kept true, and not raised twice', async () => {
    await core.certReminders.scanCertReminders()
    const alerts = async () => (await t.db.select().from(t.schema.certificationAlerts).where(eq(t.schema.certificationAlerts.companyId, companyId))) as any[]
    const before = await alerts()
    const bobTb = before.find((a) => a.certificationRecordId === ids.tbBob)
    expect(bobTb).toMatchObject({ status: 'active', alertType: 'expiring_soon', daysUntilExpiry: 20, certificationType: 'TB test' })
    const expired = before.find((a) => a.certificationRecordId === ids.oldBob)
    expect(expired).toMatchObject({ alertType: 'expired', daysUntilExpiry: -10 })
    await core.certReminders.scanCertReminders()
    expect((await alerts()).length).toBe(before.length)
    // Renewed: the old alert is resolved, a new expiry raises a fresh one.
    await t.db.update(t.schema.certificationRecords).set({ expiryDate: addDays(today, 15) } as any).where(eq(t.schema.certificationRecords.id, ids.tbBob))
    await core.certReminders.scanCertReminders()
    const after = await alerts()
    expect(after.find((a) => a.id === bobTb.id).status).toBe('resolved')
    expect(after.some((a) => a.certificationRecordId === ids.tbBob && a.status === 'active' && a.daysUntilExpiry === 15)).toBe(true)
  })
})

describe('home care parity row 1 — blocking an expired caregiver', () => {
  const shift = (caregiverId: string, day: string) => as('owner')('/api/schedules', { method: 'POST', json: { caregiverId, clientId: ids.pat, scheduleType: 'one-time', date: day, startTime: '09:00', endTime: '11:00' } })

  test('by default an expired caregiver is flagged, not refused', async () => {
    const r = await json(await shift(ids.bob, addDays(today, 3)))
    expect(r.status).toBe(201)
    expect(r.body.credentialWarnings).toEqual([`Driver licence (expired ${addDays(today, -10)})`])
  })

  test('with the block on, the shift is refused with the reason, and a caregiver in good standing is not', async () => {
    await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { blockExpired: true } }))
    const refused = await json(await shift(ids.bob, addDays(today, 4)))
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('credential_expired')
    expect(refused.body.error).toContain('Driver licence')
    expect((await json(await shift(ids.ann, addDays(today, 4)))).status).toBe(201)
    // Reassigning a shift to them is refused too.
    const annShift = (await json(await shift(ids.ann, addDays(today, 6)))).body.id
    const re = await json(await as('owner')(`/api/schedules/${annShift}/reassign`, { method: 'PUT', json: { newCaregiverId: ids.bob } }))
    expect(re.status).toBe(409)
    expect(re.body.code).toBe('credential_expired')
  })

  test('an open shift: the blocked caregiver is marked in the eligible list and is not told', async () => {
    const id = (await json(await as('owner')('/api/open-shifts', { method: 'POST', json: { clientId: ids.pat, shiftDate: addDays(today, 8), startTime: '09:00', endTime: '11:00' } }))).body.id
    const list = (await json(await as('owner')(`/api/open-shifts/${id}/eligible-caregivers`))).body.data
    const bob = list.find((r: any) => r.id === ids.bob)
    expect(bob).toMatchObject({ blockedByCredential: true, available: false })
    expect(bob.expiredCertifications).toEqual([`Driver licence (expired ${addDays(today, -10)})`])
    expect(list.find((r: any) => r.id === ids.ann).blockedByCredential).toBe(false)
    const only = await json(await as('owner')(`/api/open-shifts/${id}/notify`, { method: 'POST', json: { caregiverIds: [ids.bob] } }))
    expect(only.status).toBe(409)
    expect(only.body.code).toBe('credential_expired')
    const mixed = await json(await as('owner')(`/api/open-shifts/${id}/notify`, { method: 'POST', json: { caregiverIds: [ids.bob, ids.ann] } }))
    expect(mixed.status).toBe(200)
    expect(mixed.body.skippedForCredential).toBe(1)
  })

  test('switching the block off lets them back on', async () => {
    await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { blockExpired: false } }))
    expect((await json(await shift(ids.bob, addDays(today, 9)))).status).toBe(201)
  })
})

describe('home care parity row 1 — every door that puts a caregiver on a shift', () => {
  const setBlock = async (on: boolean) => json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { blockExpired: on } }))
  const hub = async (caregiverId: string, day: string, extra: any = {}) => json(await as('owner')('/api/schedules-enhanced', { method: 'POST', json: { caregiverId, clientId: ids.pat, scheduleType: 'one-time', date: day, startTime: '09:00', endTime: '11:00', ...extra } }))
  const openShift = async (day: string, start = '09:00', end = '11:00') =>
    (await json(await as('owner')('/api/open-shifts', { method: 'POST', json: { clientId: ids.pat, shiftDate: day, startTime: start, endTime: end } }))).body.id as string

  test('the Schedule Hub create: a flag on the reply by default, a refusal when the agency blocks', async () => {
    await setBlock(false)
    const flagged = await hub(ids.bob, addDays(today, 14))
    expect(flagged.status).toBe(201)
    expect(flagged.body.credentialWarnings).toEqual([`Driver licence (expired ${addDays(today, -10)})`])
    expect((await hub(ids.ann, addDays(today, 14))).body.credentialWarnings).toEqual([])
    await setBlock(true)
    const refused = await hub(ids.bob, addDays(today, 15))
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('credential_expired')
    // A repeating shift and a split shift are refused the same way.
    expect((await hub(ids.bob, addDays(today, 15), { scheduleType: 'recurring', dayOfWeek: 2, date: null })).status).toBe(409)
    expect((await hub(ids.bob, addDays(today, 15), { splitShift: { startTime: '13:00', endTime: '15:00' } })).status).toBe(409)
    expect((await hub(ids.ann, addDays(today, 15))).status).toBe(201)
  })

  test('an open shift: the caregiver cannot take it from their phone, and the office cannot fill it for them', async () => {
    await setBlock(true)
    const id = await openShift(addDays(today, 16))
    const claim = await json(await as('bob')(`/api/open-shifts/${id}/claim`, { method: 'POST', json: {} }))
    expect(claim.status).toBe(409)
    expect(claim.body.code).toBe('credential_expired')
    expect(claim.body.error).toContain('Driver licence')
    const smart = await json(await as('owner')(`/api/open-shifts/${id}/smart-fill`, { method: 'POST', json: { caregiverId: ids.bob } }))
    expect(smart.status).toBe(409)
    expect(smart.body.error).toContain('expired credential')
    // Still open — nothing was assigned.
    expect(((await t.db.select().from(t.schema.openShifts).where(eq(t.schema.openShifts.id, id))) as any[])[0].status).toBe('open')
    await setBlock(false)
    expect((await json(await as('owner')(`/api/open-shifts/${id}/smart-fill`, { method: 'POST', json: { caregiverId: ids.bob } }))).status).toBe(200)
  })

  test('auto-fill never picks them while the agency blocks, and does when it does not', async () => {
    const day = addDays(today, 20)
    await setBlock(false)
    // Ann is busy that afternoon, so Bob is the only one free.
    expect((await hub(ids.ann, day, { startTime: '13:00', endTime: '15:00' })).status).toBe(201)
    await openShift(day, '13:00', '15:00')
    const run = async () => (await json(await as('owner')('/api/scheduling/auto-fill', { method: 'POST', json: { startDate: day, endDate: day, dryRun: true } }))).body
    const allowed = await run()
    expect(allowed.results[0]).toMatchObject({ status: 'filled', caregiverId: ids.bob })
    await setBlock(true)
    const blocked = await run()
    expect(blocked.results[0].status).toBe('unfilled')
    expect(JSON.stringify(blocked.results[0])).toContain('Expired credential')
  })

  test('the "Mark available" list marks an expired caregiver and, when the agency blocks, will not offer them', async () => {
    // A shift 5 days out: the licence has lapsed (10 days ago); the TB test, renewed to +15 days, has not.
    const day = addDays(today, 5)
    const get = async () => (await json(await as('owner')(`/api/open-shifts/caregivers-available?date=${day}&startTime=09:00&endTime=11:00`))).body.data
    await setBlock(false)
    let bob = (await get()).find((r: any) => r.id === ids.bob)
    expect(bob).toMatchObject({ available: true, blockedByCredential: false, expiredCertifications: [`Driver licence (expired ${addDays(today, -10)})`] })
    await setBlock(true)
    bob = (await get()).find((r: any) => r.id === ids.bob)
    expect(bob).toMatchObject({ available: false, blockedByCredential: true })
    expect((await get()).find((r: any) => r.id === ids.ann)).toMatchObject({ available: true, expiredCertifications: [] })
    await setBlock(false)
  })

  test('the older routes that change a shift\'s caregiver are held to the same rule', async () => {
    await setBlock(true)
    const mine = (await hub(ids.ann, addDays(today, 22))).body.id
    const re = await json(await as('owner')(`/api/schedules-all/${mine}`, { method: 'PUT', json: { caregiverId: ids.bob } }))
    expect(re.status).toBe(409)
    expect(re.body.code).toBe('credential_expired')
    const legacy = await json(await as('owner')('/api/scheduling/schedules', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.pat, date: addDays(today, 23) } }))
    expect(legacy.status).toBe(409)
    await setBlock(false)
  })
})

describe('home care parity row 1 — gated by the feature', () => {
  test('with care_cert_reminders off none of the new routes answer (the signed-in gate says 403), and nothing is blocked', async () => {
    await json(await as('owner')('/api/credentials/settings', { method: 'PUT', json: { blockExpired: true } }))
    await setFeatures(['contacts', 'scheduling', 'team'])
    for (const p of ['/api/credentials/search', '/api/credentials/settings', '/api/credentials/clients']) expect((await as('owner')(p)).status).toBe(403)
    // The block is part of the feature: switched off, an expired caregiver goes on a shift with no flag at all.
    const r = await json(await as('owner')('/api/schedules', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.pat, scheduleType: 'one-time', date: addDays(today, 12), startTime: '09:00', endTime: '11:00' } }))
    expect(r.status).toBe(201)
    expect(r.body.credentialWarnings).toEqual([])
  })
})
