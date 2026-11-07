// Roofing parity row 20 — company statuses and checklists under the fixed milestones (AccuLynx Workflow Manager; server/crm/roof/
// pipeline.ts; pipeline_statuses, not ready). Fails without the change: a company could only rename the milestones.
//   · statuses under a milestone, for every job type or only some, each with its checklist; the office sets them;
//   · a job takes one of its milestone's statuses for its type, ticks the checklist; another milestone's status is read as none;
//   · the milestone keys never change (Advance, texts, "paid → Collected" untouched);
//   · off: the routes are shut; the switch is hidden.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { statusesFor } from '../server/crm/roof/pipeline.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let field = ''
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const as = (token: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const newJob = async (status: string, jobType: string) => ((await t.db.insert(t.schema.job).values({ companyId, number: `J-${Math.random().toString(36).slice(2, 7)}`, title: 'Roof', status, jobType } as any).returning()) as any[])[0].id as string

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['pipeline_statuses'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const password = 'Correct-horse-1'
  await t.db.insert(t.schema.user).values({ companyId, email: 'crew@test.example', firstName: 'Cy', lastName: 'Crew', role: 'field', passwordHash: await Bun.password.hash(password, 'bcrypt') } as any)
  field = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'crew@test.example', password } })).json()).accessToken
}, 120_000)

describe('row 20', () => {
  test('the rule: a milestone’s statuses for the job’s type', () => {
    const all: any[] = [
      { id: 'a', milestone: 'inspected', name: 'Claim filed', jobTypes: ['insurance'], checklist: [], sortOrder: 1 },
      { id: 'b', milestone: 'inspected', name: 'Photos sent', jobTypes: [], checklist: [], sortOrder: 0 },
      { id: 'c', milestone: 'signed', name: 'Deposit in', jobTypes: [], checklist: [], sortOrder: 0 },
    ]
    expect(statusesFor(all, { status: 'inspected', jobType: 'insurance' }).map((s) => s.id)).toEqual(['b', 'a'])
    expect(statusesFor(all, { status: 'inspected', jobType: 'retail' }).map((s) => s.id)).toEqual(['b'])
  })

  test('the office sets statuses with checklists; a crew seat may not; a job takes one and ticks it; the milestone is untouched', async () => {
    const made = await json(await as(owner, '/api/roof-pipeline/statuses', { method: 'POST', json: { milestone: 'inspected', name: 'Adjuster meeting set', jobTypes: ['insurance'], checklist: ['Meeting booked', { text: 'Homeowner told' }] } }))
    expect(made.status).toBe(201)
    expect(made.body.checklist.map((c: any) => c.text)).toEqual(['Meeting booked', 'Homeowner told'])
    expect((await as(owner, '/api/roof-pipeline/statuses', { method: 'POST', json: { milestone: 'inspected', name: 'adjuster meeting set' } })).status).toBe(409)
    expect((await as(owner, '/api/roof-pipeline/statuses', { method: 'POST', json: { milestone: 'nope', name: 'X' } })).status).toBe(400)
    expect((await as(field, '/api/roof-pipeline/statuses', { method: 'POST', json: { milestone: 'inspected', name: 'Mine' } })).status).toBe(403)

    const ins = await newJob('inspected', 'insurance')
    const view = await json(await as(field, `/api/roof-pipeline/jobs/${ins}/status`))
    expect(view.body.choices.map((s: any) => s.name)).toEqual(['Adjuster meeting set'])
    const set = await json(await as(field, `/api/roof-pipeline/jobs/${ins}/status`, { method: 'PUT', json: { statusId: made.body.id } }))
    expect(set.body.current.name).toBe('Adjuster meeting set')
    const ticked = await json(await as(field, `/api/roof-pipeline/jobs/${ins}/checks`, { method: 'PUT', json: { itemId: made.body.checklist[0].id, done: true } }))
    expect(Object.keys(ticked.body.checks)).toEqual([made.body.checklist[0].id])
    expect((await as(field, `/api/roof-pipeline/jobs/${ins}/checks`, { method: 'PUT', json: { itemId: 'nope', done: true } })).status).toBe(400)
    // The milestone itself never changed.
    expect((await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ins)))[0].status).toBe('inspected')

    // A retail job at the same milestone may not take an insurance-only status.
    const ret = await newJob('inspected', 'retail')
    expect((await as(owner, `/api/roof-pipeline/jobs/${ret}/status`, { method: 'PUT', json: { statusId: made.body.id } })).status).toBe(400)

    // The job moves on: its old status is read as none.
    await t.db.update(t.schema.job).set({ status: 'proposal_sent' } as any).where(eq(t.schema.job.id, ins))
    expect((await json(await as(owner, `/api/roof-pipeline/jobs/${ins}/status`))).body.current).toBeNull()

    // A checklist edit keeps the ticks of the items it keeps.
    const edited = await json(await as(owner, `/api/roof-pipeline/statuses/${made.body.id}`, { method: 'PUT', json: { checklist: [made.body.checklist[0], 'New item'] } }))
    expect(edited.body.checklist[0].id).toBe(made.body.checklist[0].id)
    expect(edited.body.checklist.length).toBe(2)
    // Deleted: jobs at it go back to no status.
    expect((await as(owner, `/api/roof-pipeline/statuses/${made.body.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, ins)))[0].roofStatusId).toBeNull()
  })

  test('off: shut; the switch is hidden and roofing’s', async () => {
    await setFeatures(['pipeline_custom_boards'])
    try { expect((await as(owner, '/api/roof-pipeline/statuses')).status).toBe(404) } finally { await setFeatures(['pipeline_statuses']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'pipeline_statuses') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
