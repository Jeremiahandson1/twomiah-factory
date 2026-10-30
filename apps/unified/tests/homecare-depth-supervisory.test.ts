// Home care depth, item 11 (docs/parity/homecare-supervisory-visits.md): a check-in on each client every 60 or 90 days —
// the agency picks the rule, a client can have their own days or none, the office records a visit on a short form, and
// what is due or overdue shows on the dashboard's to-do list. Off (the routes are not there, the dashboard says nothing)
// without care_supervisory_visits.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { supervisoryStatus } from '../server/crm/homecare/core/supervisory.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const BASE = ['contacts', 'scheduling', 'team', 'dashboard']
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const list = async () => (await json(await as('owner')('/api/supervisory-visits'))).body
const row = (b: any, id: string) => b.clients.find((c: any) => c.clientId === id)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash('Caregiver-pass-1', 'bcrypt')
  ids.ann = (await ins(t.schema.user, { email: 'ann@test.example', passwordHash: hash, firstName: 'Ann', lastName: 'Carer', role: 'caregiver', companyId })).id
  tokens.ann = await login('ann@test.example', 'Caregiver-pass-1')
  // started 100 days ago, never visited → overdue on 90 and on 60
  ids.old = (await ins(t.schema.clients, { companyId, firstName: 'Olga', lastName: 'Old', isActive: true, startDate: day(-100) })).id
  // started 70 days ago → overdue on 60, fine on 90
  ids.mid = (await ins(t.schema.clients, { companyId, firstName: 'Mo', lastName: 'Mid', isActive: true, startDate: day(-70) })).id
  // started 80 days ago → due within 14 days on 90
  ids.soon = (await ins(t.schema.clients, { companyId, firstName: 'Sol', lastName: 'Soon', isActive: true, startDate: day(-80) })).id
  ids.gone = (await ins(t.schema.clients, { companyId, firstName: 'Gus', lastName: 'Gone', isActive: false, startDate: day(-200) })).id
  const other = await ins(t.schema.company, { name: 'Other Care', slug: 'other-care' })
  ids.zed = (await ins(t.schema.clients, { companyId: other.id, firstName: 'Zed', lastName: 'Elsewhere', isActive: true, startDate: day(-300) })).id
  await setFeatures(BASE)
}, 90_000)

describe('home care — supervisory visits (item 11)', () => {
  test('the status rule: overdue after the due date, due soon in the last 14 days', () => {
    expect(supervisoryStatus('2026-12-01', '2026-12-02')).toBe('overdue')
    expect(supervisoryStatus('2026-12-02', '2026-12-02')).toBe('due_soon')
    expect(supervisoryStatus('2026-12-16', '2026-12-02')).toBe('due_soon')
    expect(supervisoryStatus('2026-12-17', '2026-12-02')).toBe('ok')
  })

  test('without the feature the routes are refused and the dashboard says nothing', async () => {
    const off = await json(await as('owner')('/api/supervisory-visits'))
    expect(off.status).toBe(403)
    expect(off.body).toMatchObject({ code: 'FEATURE_NOT_ENABLED', feature: 'care_supervisory_visits' })
    const items = (await json(await as('owner')('/api/dashboard/action-items'))).body.items as any[]
    expect(items.some((i) => i.key.startsWith('supervisory'))).toBe(false)
  })

  test('on the agency\'s 90-day rule: who is overdue, due soon, fine — and inactive or other companies\' clients are left out', async () => {
    await setFeatures([...BASE, 'care_supervisory_visits'])
    const b = await list()
    expect(b.ruleDays).toBe(90)
    expect(row(b, ids.old)).toMatchObject({ status: 'overdue', intervalDays: 90, lastVisit: null, daysOverdue: 10 })
    expect(row(b, ids.soon)).toMatchObject({ status: 'due_soon', daysUntilDue: 10 })
    expect(row(b, ids.mid)).toMatchObject({ status: 'ok', daysUntilDue: 20 })
    expect(row(b, ids.gone)).toBeUndefined()
    expect(row(b, ids.zed)).toBeUndefined()
    expect(b.clients[0].clientId).toBe(ids.old)
    const items = (await json(await as('owner')('/api/dashboard/action-items'))).body.items as any[]
    expect(items.find((i) => i.key === 'supervisory_overdue')).toMatchObject({ count: 1, page: 'supervisory-visits' })
    expect(items.find((i) => i.key === 'supervisory_due_soon')).toMatchObject({ count: 1 })
  })

  test('the agency can pick 60 days (and only 60 or 90); a client can have their own days or none', async () => {
    const o = as('owner')
    expect((await json(await o('/api/supervisory-visits/rule', { method: 'PUT', json: { days: 45 } }))).body.code).toBe('bad_rule')
    expect((await json(await o('/api/supervisory-visits/rule', { method: 'PUT', json: { days: 60 } }))).body.ruleDays).toBe(60)
    let b = await list()
    expect(b.ruleDays).toBe(60)
    expect(row(b, ids.mid)).toMatchObject({ status: 'overdue', intervalDays: 60, daysOverdue: 10 })
    // Mo only needs one every 180 days; Sol needs none.
    expect((await json(await o(`/api/supervisory-visits/client/${ids.mid}/interval`, { method: 'PUT', json: { days: 180 } }))).body.intervalDays).toBe(180)
    expect((await json(await o(`/api/supervisory-visits/client/${ids.soon}/interval`, { method: 'PUT', json: { days: 0 } }))).status).toBe(200)
    expect((await json(await o(`/api/supervisory-visits/client/${ids.mid}/interval`, { method: 'PUT', json: { days: -3 } }))).body.code).toBe('bad_interval')
    expect((await json(await o(`/api/supervisory-visits/client/${ids.zed}/interval`, { method: 'PUT', json: { days: 30 } }))).status).toBe(404)
    b = await list()
    expect(row(b, ids.mid)).toMatchObject({ status: 'ok', intervalDays: 180, ownInterval: true })
    expect(row(b, ids.soon)).toBeUndefined()
    // back to the agency's rule
    await o(`/api/supervisory-visits/client/${ids.mid}/interval`, { method: 'PUT', json: { days: null } })
    await o(`/api/supervisory-visits/client/${ids.soon}/interval`, { method: 'PUT', json: { days: null } })
    await o('/api/supervisory-visits/rule', { method: 'PUT', json: { days: 90 } })
  })

  test('recording a visit restarts the clock, keeps the form, and refuses an empty or future visit', async () => {
    const o = as('owner')
    const empty = await json(await o(`/api/supervisory-visits/client/${ids.old}`, { method: 'POST', json: {} }))
    expect(empty.body.code).toBe('empty_visit')
    expect((await json(await o(`/api/supervisory-visits/client/${ids.old}`, { method: 'POST', json: { concerns: 'x', visitDate: day(3) } }))).body.code).toBe('future_date')
    expect((await json(await o(`/api/supervisory-visits/client/${ids.zed}`, { method: 'POST', json: { concerns: 'x' } }))).status).toBe(404)
    const made = await json(await o(`/api/supervisory-visits/client/${ids.old}`, { method: 'POST', json: {
      visitDate: day(-1), visitType: 'phone', clientFeedback: 'Happy with Ann', carePlanFollowed: true, caregiverFeedback: 'On time, kind', concerns: 'Rug in the hall', followUpNotes: 'Ask the family about the rug', caregiverId: ids.ann } }))
    expect(made.status).toBe(201)
    expect(made.body).toMatchObject({ visitType: 'phone', carePlanFollowed: true, concerns: 'Rug in the hall', caregiverId: ids.ann })
    const b = await list()
    expect(row(b, ids.old)).toMatchObject({ lastVisit: day(-1), status: 'ok', daysUntilDue: 89 })
    const hist = (await json(await o(`/api/supervisory-visits/client/${ids.old}`))).body.data
    expect(hist.length).toBe(1)
    expect(hist[0]).toMatchObject({ visitDate: day(-1), clientFeedback: 'Happy with Ann', caregiverName: 'Ann Carer' })
    const items = (await json(await o('/api/dashboard/action-items'))).body.items as any[]
    expect(items.find((i) => i.key === 'supervisory_overdue')).toBeUndefined()
  })

  test('a caregiver can see none of it', async () => {
    const a = as('ann')
    expect((await a('/api/supervisory-visits')).status).toBe(403)
    expect((await a(`/api/supervisory-visits/client/${ids.old}`)).status).toBe(403)
    expect((await a(`/api/supervisory-visits/client/${ids.old}`, { method: 'POST', json: { concerns: 'x' } })).status).toBe(403)
    expect((await a('/api/supervisory-visits/rule', { method: 'PUT', json: { days: 60 } })).status).toBe(403)
  })
})
