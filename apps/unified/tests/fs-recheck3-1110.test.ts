// The field service third re-check (Chrome, 2026-11-10), through the real server as field service:
//   · the booking's "Where" left the ZIP off ("12 Pine St, Chippewa Falls, WI"), on the page, the email and the calendar;
//   · a warranty written before equipment could be named had no way to name it (no edit at all);
//   · the office's job page could not fill in a checklist — only Tech View could (it now uses the same form).
import { test, expect, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { whereOf } from '../server/booking/where.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = ''
const TZ = 'America/Chicago'
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: TZ, enabledFeatures: ['jobs', 'contacts', 'warranties', 'equipment_tracking', 'online_booking', 'job_checklists'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
}, 120_000)

test('Where is the street line and the ZIP, once', () => {
  expect(whereOf({ customerAddress: '12 Pine St, Chippewa Falls, WI', customerZip: '54729' })).toBe('12 Pine St, Chippewa Falls, WI 54729')
  expect(whereOf({ customerAddress: '12 Pine St 54729', customerZip: '54729' })).toBe('12 Pine St 54729')
  expect(whereOf({ customerAddress: '12 Pine St', customerZip: null })).toBe('12 Pine St')
  expect(whereOf({ customerAddress: '', customerZip: '54729' })).toBeNull()
})

test("the booking's confirmation page shows the ZIP in Where", async () => {
  expect((await call('/api/booking/settings', { method: 'PATCH', json: { timezone: TZ, enabled: true, maxDaysOut: 30, leadTimeMinutes: 60 } })).status).toBe(200)
  expect((await call('/api/booking/services', { method: 'POST', json: { name: 'Furnace tune-up', durationMinutes: 60, slotStepMinutes: 60 } })).status).toBe(201)
  expect((await call('/api/booking/hours', { method: 'PUT', json: { hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' })) } })).status).toBe(200)
  const day = addDays(tzParts(new Date(), TZ).date, 3)
  const r = await json(await t.call('/api/book/services/furnace-tune-up', { method: 'POST', json: { name: 'Dana Booker', email: 'dana@home.example', phone: '715-555-0101', address: '12 Pine St', city: 'Chippewa Falls', state: 'WI', zip: '54729', date: day, time: '14:00' } }))
  expect(r.status).toBe(201)
  const page = await t.call(`/book/done?token=${encodeURIComponent(r.body.token)}`)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('<span>Where</span><strong>12 Pine St, Chippewa Falls, WI 54729</strong>')
})

test('a warranty can be edited to name the unit it covers; the term moves the expiry; another customer\'s unit is refused', async () => {
  const hank = await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', type: 'client' })
  const bea = await ins(t.schema.contact, { companyId, name: 'Bea Neighbor', type: 'client' })
  const furnace = await ins(t.schema.equipment, { companyId, contactId: hank.id, name: 'Gas Furnace', model: '59TN6' })
  const beas = await ins(t.schema.equipment, { companyId, contactId: bea.id, name: 'Boiler' })
  const w = await json(await call('/api/warranties', { method: 'POST', json: { contactId: hank.id, name: 'Parts and labor, one year', startDate: '2026-11-09', durationMonths: 12 } }))
  expect([w.status, w.body.equipmentId ?? null]).toEqual([201, null])
  const edited = await json(await call(`/api/warranties/${w.body.id}`, { method: 'PUT', json: { equipmentId: furnace.id, durationMonths: 24, name: 'Parts and labor, two years' } }))
  expect(edited.status).toBe(200)
  expect([edited.body.equipmentId, edited.body.name, edited.body.contactId]).toEqual([furnace.id, 'Parts and labor, two years', hank.id])
  expect(String(edited.body.expiresAt).slice(0, 10)).toBe('2028-11-09')
  const list = await json(await call('/api/warranties'))
  expect(list.body.data.find((x: any) => x.id === w.body.id).equipment).toMatchObject({ name: 'Gas Furnace', model: '59TN6' })
  expect((await call(`/api/warranties/${w.body.id}`, { method: 'PUT', json: { equipmentId: beas.id } })).status).toBe(400)
  expect((await call(`/api/warranties/${w.body.id}`, { method: 'PUT', json: { name: '  ' } })).status).toBe(400)
  const cleared = await json(await call(`/api/warranties/${w.body.id}`, { method: 'PUT', json: { equipmentId: null } }))
  expect(cleared.body.equipmentId).toBeNull()
})

test("the office's job page fills a checklist in with Tech View's own form", () => {
  const panel = src('../web/src/crm/checklistLife.tsx')
  expect(panel).toContain("import { ChecklistForm, type Template } from './crewVisitTools'")
  expect(panel).toContain('<ChecklistForm job={job as any} tpl={filling}')
  expect(src('../web/src/crm/crewVisitTools.tsx')).toContain('export function ChecklistForm(')
})
