// Roofing parity row 28 — crew scheduling and on site (AccuLynx scheduler + Crew App, Roofr calendar; data/crewScheduling.ts,
// crm/roof/workOrders.ts, crewLink.ts; crew_scheduling, not ready). Fails without the change.
//   · sent orders on the schedule; a sent order's start moved → the crew texted;
//   · the crew: I'm here (in progress) / Leaving for now, each noted on the job and emailed to the office; an on-site checklist ticked;
//     done from in progress; the office may mark one in progress by hand; in progress still counts as labour;
//   · the roster: trades and certificates; a run-out certificate warned on send;
//   · off: shut, and the crew page is as before.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { certificateWarnings, readChecklist } from '../server/data/crewScheduling.ts'
import { PRICED_WORK_ORDER_STATUSES } from '../server/crm/roof/jobCosts.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let jobId = ''
const texts: any[] = []
const mails: any[] = []
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const ins = async (table: any, v: any) => ((await t.db.insert(table).values(v).returning()) as any[])[0]
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'roof_work_orders', 'crews', 'two_way_texting', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const sentOrder = async (extra: any = {}) => {
  const o = (await json(await auth('/api/work-orders', { method: 'POST', json: { jobId, title: 'Tear-off', recipientName: 'Carlos', recipientPhone: '715-555-0199', startDate: '2026-11-20', ...extra } }))).body
  await auth(`/api/work-orders/${o.id}/send`, { method: 'POST', json: {} })
  const row = (await t.db.select().from(t.schema.workOrder).where(eq(t.schema.workOrder.id, o.id)))[0]
  return { id: o.id as string, token: row.publicToken as string }
}
const crewPost = async (token: string, path: string, body: any = {}) => json(await t.call(`/api/crew-link/${token}${path}`, { method: 'POST', json: body }))

beforeAll(async () => {
  process.env.FRONTEND_URL = 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['crew_scheduling'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  ;(t.services as any).crm.sms.sendSMS = async (_c: string, a: any) => { texts.push(a); return { success: true } }
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  const ct = await ins(t.schema.contact, { companyId, name: 'Lee', type: 'client' })
  jobId = (await ins(t.schema.job, { companyId, number: 'J-1', title: 'Roof', contactId: ct.id, address: '1 Oak' })).id
}, 120_000)

describe('row 28: the rules', () => {
  test('certificates that ran out or soon will; checklists', () => {
    expect(certificateWarnings([{ name: 'OSHA 10', expiresOn: '2026-11-01' }, { name: 'Lift', expiresOn: '2026-11-20' }, { name: 'Far', expiresOn: '2027-06-01' }], '2026-11-06'))
      .toEqual([{ name: 'OSHA 10', expiresOn: '2026-11-01', expired: true }, { name: 'Lift', expiresOn: '2026-11-20', expired: false }])
    expect(readChecklist(['Tarp the beds', { text: 'Magnet sweep' }, ''])).toMatchObject([{ text: 'Tarp the beds' }, { text: 'Magnet sweep' }])
    expect(PRICED_WORK_ORDER_STATUSES).toContain('in_progress')
  })
})

describe('row 28: the office and the crew', () => {
  test('on the schedule; moving a sent order’s start texts the crew', async () => {
    const o = await sentOrder()
    const sched = await json(await auth('/api/work-orders/schedule?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z'))
    expect(sched.body.data.map((x: any) => x.id)).toContain(o.id)
    texts.length = 0
    const moved = await json(await auth(`/api/work-orders/${o.id}`, { method: 'PUT', json: { startDate: '2026-11-24' } }))
    expect(moved.body.rescheduleNotice).toBe('The crew was texted the new start.')
    expect(texts.at(-1).message).toMatch(/is rescheduled to Tuesday, November 24/)
  })

  test('I’m here → in progress, the office told; the checklist ticked; Leaving for now; done from in progress', async () => {
    const o = await sentOrder()
    await auth(`/api/work-orders/${o.id}/checklist`, { method: 'PUT', json: { checklist: ['Tarp the beds', 'Magnet sweep'] } })
    await crewPost(o.token, '/accept', { name: 'Carlos Ruiz' })
    mails.length = 0
    const here = await crewPost(o.token, '/arrive')
    expect(here.body.status).toBe('in_progress')
    expect(here.body.arrivedAt).toBeTruthy()
    expect(mails.some((m) => /Carlos Ruiz arrived for work order "Tear-off"/.test(m.subject))).toBe(true)
    const item = here.body.checklist[0]
    const ticked = await crewPost(o.token, '/check', { itemId: item.id, done: true })
    expect(Object.keys(ticked.body.checks)).toEqual([item.id])
    const left = await crewPost(o.token, '/leave')
    expect(left.body.leftAt).toBeTruthy()
    const done = await crewPost(o.token, '/complete', { note: 'All done' })
    expect(done.body.status).toBe('completed')
    const notes = await t.db.select().from(t.schema.jobNote).where(eq(t.schema.jobNote.jobId, jobId))
    expect(notes.some((n: any) => /left work order "Tear-off" \(not done yet\)/.test(n.body))).toBe(true)
  })

  test('the office marks one in progress by hand; the roster’s run-out certificate is warned on send', async () => {
    const o = await sentOrder()
    expect((await json(await auth(`/api/work-orders/${o.id}/in-progress`, { method: 'POST' }))).body.status).toBe('in_progress')
    const cr = await ins(t.schema.crew, { companyId, name: 'Sub B', foremanName: 'Bo', foremanPhone: '715-555-0197', size: 2 })
    const roster = await json(await auth(`/api/work-orders/crew-roster/${cr.id}`, { method: 'PUT', json: { trades: ['Roofing', 'Gutters'], certificates: [{ name: 'OSHA 10', expiresOn: '2020-01-01' }] } }))
    expect(roster.body.trades).toEqual(['Roofing', 'Gutters'])
    expect(roster.body.warnings[0]).toMatchObject({ name: 'OSHA 10', expired: true })
    const o2 = (await json(await auth('/api/work-orders', { method: 'POST', json: { jobId, title: 'Gutters', crewId: cr.id } }))).body
    const sent = await json(await auth(`/api/work-orders/${o2.id}/send`, { method: 'POST', json: {} }))
    expect(sent.body.certNotice).toBe('Heads up: OSHA 10 ran out 2020-01-01.')
  })

  test('off: shut, and the crew page offers no I’m here; the switch is hidden and roofing’s', async () => {
    const o = await sentOrder()
    await setFeatures([])
    try {
      expect((await auth('/api/work-orders/schedule?from=2026-11-01&to=2026-11-30')).status).toBe(404)
      const page = await json(await t.call(`/api/crew-link/${o.token}`))
      expect(page.body.can.arrive).toBeUndefined()
      expect(page.body.checklist).toBeUndefined()
      expect((await crewPost(o.token, '/arrive')).status).toBe(404)
    } finally { await setFeatures(['crew_scheduling']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'crew_scheduling') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
