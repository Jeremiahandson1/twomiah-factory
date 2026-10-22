// Draw schedules end to end through the real server (server/crm/projects/drawSchedules.ts, 2026-10-22). Before:
// the schedule's name, lender and notes were asked for and dropped; every draw stored $0 retainage and its whole
// gross as the net; a draw could be approved or paid from any status (and the page could never submit one, its
// Submit button waiting on a 'pending' status no draw has).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type Call = (p: string, init?: any) => Promise<Response>
let owner: Call
let scheduleId = ''

beforeAll(async () => {
  const t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'projects', 'draw_schedules'] } as any).where(eq(t.schema.company.id, seeded.company.id))
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  owner = async (p, init = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  const contact = await (await owner('/api/contacts', { method: 'POST', json: { name: 'Pat Client', type: 'client' } })).json()
  const project = await (await owner('/api/projects', { method: 'POST', json: { name: 'Keller kitchen', contactId: contact.id } })).json()
  expect(project.id).toBeTruthy()
  const res = await owner('/api/draw-schedules', { method: 'POST', json: { projectId: project.id, name: 'Main construction loan', totalAmount: 100000, retainagePercent: 10, lenderName: 'First Bank', lenderContact: 'loans@firstbank.example', notes: 'Monthly draws' } })
  expect(res.status).toBe(201)
  scheduleId = (await res.json()).id
}, 120_000)

const post = async (p: string, json: unknown = {}) => owner(p, { method: 'POST', json })

describe('a draw schedule', () => {
  test('keeps its name, lender and notes', async () => {
    const s = await (await owner(`/api/draw-schedules/${scheduleId}`)).json()
    expect([s.name, s.lenderName, s.lenderContact, s.notes]).toEqual(['Main construction loan', 'First Bank', 'loans@firstbank.example', 'Monthly draws'])
    const list = await (await owner('/api/draw-schedules')).json()
    expect(list.data.find((x: any) => x.id === scheduleId)?.name).toBe('Main construction loan')
  })
})

describe('a draw', () => {
  test('holds back the retainage: gross 20,000 at 10% is 2,000 held, 18,000 net', async () => {
    const r = await post('/api/draw-schedules/requests', { scheduleOfValuesId: scheduleId, grossAmount: 20000 })
    expect(r.status).toBe(201)
    const d = await r.json()
    expect([d.status, Number(d.grossAmount), Number(d.retainageAmount), Number(d.netAmount)]).toEqual(['draft', 20000, 2000, 18000])
  })

  test('moves one step at a time, and records the reasons', async () => {
    const d = await (await post('/api/draw-schedules/requests', { scheduleOfValuesId: scheduleId, grossAmount: 10000 })).json()
    const at = (a: string, body: unknown = {}) => post(`/api/draw-schedules/requests/${d.id}/${a}`, body)
    // a draft can't be approved, rejected or paid before the lender has it
    for (const a of ['approve', 'reject', 'mark-paid']) expect([a, (await at(a)).status]).toEqual([a, 409])
    expect((await at('submit')).status).toBe(200)
    expect((await at('submit')).status).toBe(409)
    const rejected = await (await at('reject', { notes: 'Missing lien waiver' })).json()
    expect([rejected.status, rejected.rejectionReason]).toEqual(['rejected', 'Missing lien waiver'])
    expect((await at('submit')).status).toBe(200)
    const approved = await (await at('approve', { notes: 'Inspected 10/22' })).json()
    expect([approved.status, approved.approvalNotes, !!approved.approvedById]).toEqual(['approved', 'Inspected 10/22', true])
    expect((await at('approve')).status).toBe(409)
    expect((await (await at('mark-paid')).json()).status).toBe('paid')
    expect((await at('mark-paid')).status).toBe(409)
    expect((await post('/api/draw-schedules/requests/no-such-draw/submit')).status).toBe(404)
  })

  test("can't take more than the loan has left; a rejected draw gives its amount back", async () => {
    // 100,000 less the 20,000 and 10,000 above leaves 70,000.
    const over = await post('/api/draw-schedules/requests', { scheduleOfValuesId: scheduleId, grossAmount: 70000.01 })
    expect(over.status).toBe(400)
    expect((await over.json()).code).toBe('over_contract')
    const d = await (await post('/api/draw-schedules/requests', { scheduleOfValuesId: scheduleId, grossAmount: 70000 })).json()
    expect(d.status).toBe('draft')
    expect((await post('/api/draw-schedules/requests', { scheduleOfValuesId: scheduleId, grossAmount: 1 })).status).toBe(400)
    await post(`/api/draw-schedules/requests/${d.id}/submit`)
    await post(`/api/draw-schedules/requests/${d.id}/reject`, { notes: 'Too early' })
    expect((await post('/api/draw-schedules/requests', { scheduleOfValuesId: scheduleId, grossAmount: 5000 })).status).toBe(201)
  })
})
