// Home care depth, items 6 and 7 (docs/parity/homecare-open-shift-broadcast.md, homecare-daily-care-wording.md).
//   · 6: POST /api/open-shifts/:id/broadcast used to set a flag and answer "Broadcast sent to N" while telling nobody. It now
//     tells every caregiver who could take the shift — an in-app notice and a phone push, a text when asked — answers with the
//     count it really reached, and never marks a posting broadcast when nobody was told.
//   · 7: the menu heading "Clinical" is "Daily care". The medicine screen first said "Medication reminders" (it sends no reminder); since the
//     owner's follow-up 10/30 it says "Medicine list & dose log" — in the menu, the screen and its tabs, the phone's More menu and visit
//     screen, the assistant's description and the client report PDF.
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const texts: any[] = []
const phone = (who: string) => `ExponentPushToken[${who}-phone]`

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const offersFor = async (id: string) => (await t.db.select().from(t.schema.notifications)
  .where(and(eq(t.schema.notifications.userId, id), eq(t.schema.notifications.type, 'open_shift_offer')))).length
const posting = async (id: string) => ((await t.db.select().from(t.schema.openShifts).where(eq(t.schema.openShifts.id, id))) as any[])[0]

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  let n = 0
  for (const who of ['ann', 'bob', 'cy']) {
    const u = await ins(t.schema.user, { email: `${who}@test.example`, passwordHash: hash, firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Carer', role: 'caregiver', companyId, phone: `608555010${++n}` })
    ids[who] = u.id
    tokens[who] = await login(`${who}@test.example`, 'Caregiver-pass-1')
    expect((await as(who)('/api/push/expo-token', { method: 'POST', json: { token: phone(who), platform: 'ios' } })).status).toBe(201)
  }
  ids.pat = (await ins(t.schema.clients, { companyId, firstName: 'Pat', lastName: 'Client', isActive: true, isPrivatePay: true })).id
  // Bob already has a visit at the time the shift is for.
  const busy = await json(await as('owner')('/api/schedules', { method: 'POST', json: { caregiverId: ids.bob, clientId: ids.pat, scheduleType: 'one-time', date: '2026-12-02', startTime: '09:00', endTime: '11:00' } }))
  expect(busy.status).toBe(201)
  const other = await ins(t.schema.company, { name: 'Other Care', slug: 'other-care' })
  const oc = await ins(t.schema.clients, { companyId: other.id, firstName: 'Zed', lastName: 'Elsewhere' })
  ids.strangerShift = (await ins(t.schema.openShifts, { companyId: other.id, clientId: oc.id, date: '2026-12-05', startTime: '09:00:00', endTime: '11:00:00', status: 'open' })).id
}, 90_000)

const post = async (extra: any = {}) => (await json(await as('owner')('/api/open-shifts', { method: 'POST', json: { clientId: ids.pat, shiftDate: '2026-12-02', startTime: '09:00', endTime: '11:00', bonusAmount: 15, ...extra } }))).body.id as string

describe('home care — open shift broadcast really sends (item 6)', () => {
  test('it tells the free caregivers (notice + phone), not the busy one, and counts who it reached', async () => {
    ids.shift = await post()
    t.pushed.length = 0
    const r = await json(await as('owner')(`/api/open-shifts/${ids.shift}/broadcast`, { method: 'POST', json: {} }))
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ success: true, notified: 2, texted: 0, total: 2 })
    expect(r.body.message).toBe('Told 2 caregivers')
    expect(await offersFor(ids.ann)).toBe(1)
    expect(await offersFor(ids.cy)).toBe(1)
    expect(await offersFor(ids.bob)).toBe(0)
    expect(t.pushed.map((m: any) => m.to).sort()).toEqual([phone('ann'), phone('cy')])
    expect(t.pushed[0].title).toContain('Open Shift: Pat Client')
    const row = await posting(ids.shift)
    expect(row.broadcastSent).toBe(true)
    expect(row.notifiedCaregiverCount).toBe(2)
    // The board's "who was told" view agrees.
    const eligible = (await json(await as('owner')(`/api/open-shifts/${ids.shift}/eligible-caregivers`))).body.data
    expect(eligible.filter((e: any) => e.notified).map((e: any) => e.id).sort()).toEqual([ids.ann, ids.cy].sort())
  })

  test('with sms:true it also texts them from the agency\'s texting service', async () => {
    texts.length = 0
    const id = await post({ shiftDate: '2026-12-03' })
    const r = await json(await as('owner')(`/api/open-shifts/${id}/broadcast`, { method: 'POST', json: { sms: true, customMessage: 'Thank you!' } }))
    expect(r.body).toMatchObject({ notified: 3, texted: 3 })
    expect(r.body.message).toBe('Told 3 caregivers and texted 3')
    expect(texts.length).toBe(3)
    expect(texts[0].message).toContain('Open shift')
    expect(texts[0].message).toContain('Thank you!')
  })

  test('a posting offered to chosen caregivers reaches only them', async () => {
    const id = await post({ shiftDate: '2026-12-04' })
    await t.db.update(t.schema.openShifts).set({ visibleTo: [ids.ann] } as any).where(eq(t.schema.openShifts.id, id))
    t.pushed.length = 0
    const r = await json(await as('owner')(`/api/open-shifts/${id}/broadcast`, { method: 'POST', json: {} }))
    expect(r.body).toMatchObject({ notified: 1, total: 1, message: 'Told 1 caregiver' })
    expect(t.pushed.map((m: any) => m.to)).toEqual([phone('ann')])
  })

  // 10/30 (owner's follow-up): the broadcast follows the same rule as auto-fill (core/caregiverFit.ts).
  test("a caregiver on the client's do-not-use list is not told", async () => {
    await t.db.update(t.schema.clients).set({ doNotUseCaregivers: [ids.cy] } as any).where(eq(t.schema.clients.id, ids.pat))
    try {
      const id = await post({ shiftDate: '2026-12-07' })
      const cyBefore = await offersFor(ids.cy)
      t.pushed.length = 0
      const r = await json(await as('owner')(`/api/open-shifts/${id}/broadcast`, { method: 'POST', json: {} }))
      expect(r.body).toMatchObject({ notified: 2, total: 2 })
      expect(t.pushed.map((m: any) => m.to).sort()).toEqual([phone('ann'), phone('bob')].sort())
      expect(await offersFor(ids.cy)).toBe(cyBefore) // nothing new for her
    } finally {
      await t.db.update(t.schema.clients).set({ doNotUseCaregivers: [] } as any).where(eq(t.schema.clients.id, ids.pat))
    }
  })

  test('when nobody can be told it says so, and the posting is not marked broadcast', async () => {
    const id = await post()
    await t.db.update(t.schema.openShifts).set({ visibleTo: [ids.bob] } as any).where(eq(t.schema.openShifts.id, id))
    const r = await json(await as('owner')(`/api/open-shifts/${id}/broadcast`, { method: 'POST', json: {} }))
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('nobody_to_tell')
    expect((await posting(id)).broadcastSent).toBeFalsy()
  })

  test('a filled or removed posting is not broadcast; another company\'s posting is not found', async () => {
    const id = await post({ shiftDate: '2026-12-06' })
    expect((await as('owner')(`/api/open-shifts/${id}/cancel`, { method: 'POST', json: {} })).status).toBe(200)
    expect((await as('owner')(`/api/open-shifts/${id}/broadcast`, { method: 'POST', json: {} })).status).toBe(409)
    expect((await as('owner')(`/api/open-shifts/${ids.strangerShift}/broadcast`, { method: 'POST', json: {} })).status).toBe(404)
  })

  test('a caregiver cannot broadcast', async () => {
    const id = await post({ shiftDate: '2026-12-07' })
    expect((await as('ann')(`/api/open-shifts/${id}/broadcast`, { method: 'POST', json: {} })).status).toBe(403)
    expect((await posting(id)).broadcastSent).toBeFalsy()
  })

  test('/notify (the office picks) still tells exactly the people chosen', async () => {
    const id = await post({ shiftDate: '2026-12-08' })
    t.pushed.length = 0
    const r = await json(await as('owner')(`/api/open-shifts/${id}/notify`, { method: 'POST', json: { caregiverIds: [ids.cy] } }))
    expect(r.body).toMatchObject({ success: true, notified: 1, texted: 0, total: 1 })
    expect(t.pushed.map((m: any) => m.to)).toEqual([phone('cy')])
  })
})

describe('home care — "Daily care", not "Clinical" (item 7)', () => {
  const read = (f: string) => fs.readFileSync(path.join(import.meta.dir, '..', f), 'utf8')

  test('the menu heading and the screen label', () => {
    const menu = read('web/src/crm/verticals/homecare.tsx')
    expect(menu).not.toMatch(/'Clinical'/)
    expect(menu).toContain("['/crm/medications', 'Daily care']")
    expect(read('web/src/crm/pages/homecare/clients/index.tsx')).toContain("label: 'Medicine list & dose log'")
    const screen = read('web/src/crm/pages/homecare/clients/MedicationsManagement.tsx')
    expect(screen).toContain('Medicine list &amp; dose log')
    expect(screen).toContain('Medicine list ({activeMeds.length})')
    expect(screen).toContain('Dose log ({logs.length})')
    expect(screen).not.toMatch(/Medication reminders|Administration Log/i)
  })

  test('the phone\'s More menu names the same rows', () => {
    const generated = read('../mobile/src/more/menu.generated.ts')
    const row = generated.split('\n').find((l) => l.includes('"path":"/crm/medications"'))!
    expect(row).toContain('"label":"Medicine list & dose log"')
    expect(generated).not.toMatch(/Clinical|Medication reminders/)
    expect(read('../mobile/src/care/components/VisitParts.tsx')).toContain('<SectionTitle>Medicine list & dose log</SectionTitle>')
  })

  test('the client report PDF names the list and the log the same way', () => {
    const reports = read('server/crm/homecare/planning/reports.ts')
    expect(reports).toContain("sectionHeader('Medicine list')")
    expect(reports).toContain("'Dose log (period)'")
    expect(reports).not.toContain('Medication Administration (period)')
  })

  test('the incident notice and the assistant\'s description use the new words', () => {
    expect(read('server/crm/homecare/office/incidents.ts')).toContain('Open Daily care → Incidents')
    expect(read('server/crm/homecare/office/incidents.ts')).not.toMatch(/Open Clinical/)
    const settings = read('verticals/homecare/settings.ts')
    expect(settings).toContain('Daily care (daily-living tasks, the medicine list and dose log')
    expect(settings).not.toMatch(/medication reminders/i)
    expect(settings).not.toMatch(/Clinical \(ADLs/)
  })
})
