// Contractor parity row 11 (part a) — the contractor's phone against a real tenant (contractor_phone, not ready): the specs' own
// requests (apps/mobile/src/trades/contractor.ts) sent as the phone sends them, TWICE where the offline queue may resend — today's
// daily log is one log however often it is sent; a new punch item names its own id and is one item; photos go in two steps and
// are one photo each; the clock takes a project and a cost code; a field seat reads the cost codes by name only.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { CONTRACTOR, clockInExtras } from '../../mobile/src/trades/contractor.ts'

const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const ON = ['contacts', 'projects', 'daily_logs', 'punch_lists', 'time_tracking', 'job_costing', 'job_budgets', 'change_orders', 'inspections', 'selections', 'documents', 'contractor_phone']
let t: any, companyId = '', owner: any, field: any, proj: any
const spec = (id: string) => CONTRACTOR.find((s) => s.id === id)!
const act = (specId: string, actionId: string, where: 'detail' | 'list' = 'detail') => (where === 'detail' ? spec(specId).detail!.actions! : spec(specId).actions!).find((a) => a.id === actionId)!
const send = (as: any, r: { method: string; path: string; body?: any }) => as(r.path, { method: r.method, json: r.body })
/** As the phone's offline queue sends a save: the same Idempotency-Key on every try (src/offline/OfflineQueue.ts). */
const queued = (as: any, r: { method: string; path: string; body?: any }, key: string) => as(r.path, { method: r.method, json: r.body, headers: { 'Idempotency-Key': key } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ON } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, type: string) => { await t.store.put(key, body, type) },
    getObject: async (key: string) => t.store.getObject(key),
  })
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  owner = as(await login('owner@test.example', s.password))
  await t.db.insert(t.schema.user).values({ companyId, email: 'crew@test.example', firstName: 'Crew', lastName: 'Seat', role: 'field', passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') } as any)
  field = as(await login('crew@test.example', 'Correct-horse-1'))
  proj = (await t.db.insert(t.schema.project).values({ companyId, number: 'PRJ-0001', name: 'Kitchen', status: 'active' } as any).returning())[0]
  await t.db.insert(t.schema.projectBudgetLine).values([
    { companyId, projectId: proj.id, costCode: '06-Framing', estimatedCost: '4000', estimatedPrice: '6000' },
    { companyId, projectId: proj.id, costCode: '02-Demo', estimatedCost: '800', estimatedPrice: '1000' },
  ] as any)
}, 120_000)

describe('contractor phone', () => {
  test('is registered, not ready, and the general contractor’s', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'contractor_phone')
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm']])
  })

  test('today’s daily log: the spec’s request twice is one log, the second send writing over the first', async () => {
    const a = act('con-projects', 'today-log')
    const first = await json(await send(field, a.request(proj, { weather: 'Sunny', workPerformed: 'Demo done', crewSize: '3', delays: '', safetyNotes: '' })))
    expect(first.status).toBe(201)
    const again = await json(await send(field, a.request(proj, { weather: 'Sunny, windy', workPerformed: 'Demo done, framing started', crewSize: '4', delays: '', safetyNotes: '' })))
    expect(again.status).toBe(200)
    expect(again.body.id).toBe(first.body.id)
    const logs = await t.db.select().from(t.schema.dailyLog).where(eq(t.schema.dailyLog.projectId, proj.id)) as any[]
    expect(logs.map((l) => [l.weather, l.workPerformed, l.crewSize])).toEqual([['Sunny, windy', 'Demo done, framing started', 4]])
    // the list a project link opens, filtered by the project
    const list = await json(await field(`/api/daily-logs?projectId=${proj.id}`))
    expect(list.body.data.map((r: any) => spec('con-daily-logs').rows(r, {}).id)).toEqual([first.body.id])
  }, 90_000)

  test('photos in two steps, as the queue sends them: the file named from the save, then the save — one photo however often', async () => {
    const [log] = await t.db.select().from(t.schema.dailyLog).where(eq(t.schema.dailyLog.projectId, proj.id)) as any[]
    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#888' } }).jpeg().toBuffer()
    const upload = async () => { const fd = new FormData(); fd.append('photo', new File([jpeg], 'p.jpg', { type: 'image/jpeg' })); fd.append('name', 'save1234abcd-0'); return json(await field(`/api/daily-logs/${log.id}/photos/file`, { method: 'POST', body: fd })) }
    const up = await upload()
    expect([up.status, up.body.url]).toEqual([201, 'phone:save1234abcd-0'])
    expect((await upload()).body.url).toBe('phone:save1234abcd-0')
    const req = act('con-daily-logs', 'add-photos').request({ dailyLog: log }, { photos: JSON.stringify(['file:///x.jpg']), caption: 'Framing' })
    expect(req.body.$photos).toEqual({ uploadTo: `/api/daily-logs/${log.id}/photos/file`, uris: ['file:///x.jpg'] })
    // the queue replaces $photos with the uploaded addresses before the save goes
    const saved = { ...req.body, photos: [up.body.url] }; delete saved.$photos
    const s1 = await json(await field(req.path, { method: 'POST', json: saved }))
    const s2 = await json(await field(req.path, { method: 'POST', json: saved }))
    expect([s1.body.saved, s2.body.saved]).toEqual([1, 0])
    const [after] = await t.db.select().from(t.schema.dailyLog).where(eq(t.schema.dailyLog.id, log.id)) as any[]
    expect(after.photos.map((p: any) => [p.id, p.caption])).toEqual([['save1234abcd-0', 'Framing']])
    expect((await field(`/api/daily-logs/${log.id}/photos/saved`, { method: 'POST', json: { photos: ['https://evil.example/x.jpg'] } })).status).toBe(400)
  }, 90_000)

  test('a new punch item names its own id: sent twice it is one item; marking it done twice is done', async () => {
    const r = act('con-projects', 'add-punch').request(proj, { description: 'Caulk the backsplash', location: 'Kitchen', priority: 'high' })
    const a = await json(await send(field, r))
    const b = await json(await send(field, r))
    expect([a.status, b.status, b.body.id]).toEqual([201, 200, r.body.id])
    const items = await t.db.select().from(t.schema.punchListItem).where(eq(t.schema.punchListItem.projectId, proj.id)) as any[]
    expect(items.length).toBe(1)
    const done = act('con-punch', 'complete').request({ punchListItem: items[0] }, {})
    expect((await send(field, done)).status).toBe(200)
    expect((await send(field, done)).status).toBe(200)
  }, 90_000)

  test('the clock takes a project and a cost code; a field seat reads the codes by name only', async () => {
    const codes = await json(await field(`/api/project-phone/${proj.id}/cost-codes`))
    expect(codes.body).toEqual({ codes: ['02-Demo', '06-Framing'] })
    expect(JSON.stringify(codes.body)).not.toMatch(/4000|6000/)
    expect(clockInExtras(null, null, '06-Framing')).toEqual({})
    const inn = await json(await field('/api/time/clock-in', { method: 'POST', json: { source: 'phone', ...clockInExtras(null, proj.id, '06-Framing') } }))
    expect(inn.status).toBe(201)
    expect([inn.body.projectId, inn.body.costCode]).toEqual([proj.id, '06-Framing'])
  }, 90_000)

  test('off: the cost codes route is not there', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: ON.filter((f) => f !== 'contractor_phone') } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await field(`/api/project-phone/${proj.id}/cost-codes`)).status).toBe(404)
  }, 90_000)
})

// Row 11b — change orders raised on the phone (one however often sent), sent to the client; inspections resulted on site (the
// same result twice is that result); selections read by the project path the list fills in; files open in the signed-in browser.
describe('contractor phone, 11b', () => {
  test('a change order raised twice is one change order with one number; sending it to the client', async () => {
    const r = act('con-projects', 'add-co').request(proj, { title: 'Move the island', description: 'Two feet north', amount: '1250', daysAdded: '2' })
    const a = await json(await send(owner, r))
    const b = await json(await send(owner, r))
    expect([a.status, b.status, b.body.id, b.body.number]).toEqual([201, 200, r.body.id, a.body.number])
    const cos = await t.db.select().from(t.schema.changeOrder).where(eq(t.schema.changeOrder.projectId, proj.id)) as any[]
    expect(cos.map((o) => [o.title, Number(o.amount), o.daysAdded, o.status])).toEqual([['Move the island', 1250, 2, 'draft']])
    const sub = act('con-change-orders', 'submit')
    expect(sub.offline).toBeUndefined() // a second send would be refused: it needs signal
    expect((await json(await send(owner, sub.request(cos[0], {})))).body.status).toBe('submitted')
  }, 90_000)

  test('an inspection passed twice from the phone is passed, once', async () => {
    const insp = (await t.db.insert(t.schema.inspection).values({ companyId, projectId: proj.id, number: 'INS-001', type: 'framing', status: 'scheduled', scheduledDate: new Date('2026-01-05T00:00:00Z') } as any).returning())[0]
    const pass = act('con-inspections', 'pass').request(insp, {})
    const one1 = await json(await queued(owner, pass, 'q-insp-1'))
    const one2 = await json(await queued(owner, pass, 'q-insp-1'))
    expect([one1.status, one2.status, one2.body.status]).toEqual([200, 200, 'passed'])
    // not the queue's repeat (a person resulting it again): refused, as the desk's rule says
    expect((await send(owner, pass)).status).toBe(400)
    // a different result afterwards is still refused: a result is not edited
    expect((await send(owner, act('con-inspections', 'fail').request(insp, { deficiencies: 'x' }))).status).toBe(400)
  }, 90_000)

  test('selections read by the path the list fills in; a file opens in the signed-in browser', async () => {
    const { fillPath } = await import('../../mobile/src/trades/kit.ts')
    const q: Record<string, string> = { projectId: proj.id }
    const path = fillPath(spec('con-selections').list.path, q)
    expect([path, q]).toEqual([`/api/selections/project/${proj.id}`, {}])
    expect((await owner(path!)).status).toBe(200)
    expect(fillPath('/api/selections/project/{projectId}', {})).toBeNull()
    const links = spec('con-files').detail!.sections[0].links!({ id: 'doc1', name: 'Plans.pdf' })
    expect(links[0].route).toBe('/(details)/web?path=%2Fapi%2Fdocuments%2Fdoc1%2Ffile&title=Plans.pdf')
  }, 90_000)
})
