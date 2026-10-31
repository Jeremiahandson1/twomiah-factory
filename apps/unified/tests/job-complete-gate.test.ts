// Follow-up 10/30 to PR #169, fix 1: the SERVER refuses to complete a job while a required checklist is unfinished — the same
// answer for the phone's Complete button (POST /api/jobs/:id/complete), the office status box and Dispatch Board
// (PUT /api/jobs/:id with status completed) and anything calling the API. Through the real server and login, on BOTH field
// service and basic.
//   · refused with a plain sentence that names the checklist and what it still needs; the job stays as it was;
//   · a checklist filled in lets the job complete; one that wants the customer's signature waits for it;
//   · a checklist of only optional questions is offered, never demanded;
//   · a job of another kind is untouched; with Job Checklists off nothing changes; a seat that may not update jobs still gets
//     its ordinary refusal; a job already completed is left to the route.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'job_checklists']
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    const tok: Record<string, string> = {}
    const id: Record<string, string> = {}
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
    const newJob = (fields: Record<string, unknown> = {}) => ins(t.schema.job, { companyId: co, number: `J-${Math.random().toString(36).slice(2, 8)}`, title: 'Furnace', status: 'in_progress', jobType: 'Gate job', assignedToId: id.tia, ...fields })
    const statusOf = async (jobId: string) => ((await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, jobId)))[0] as any).status
    const REQUIRED = [{ label: 'Filter changed', type: 'yes_no', required: true }, { label: 'Pressure OK', type: 'pass_fail', required: true }]
    const template = async (fields: Record<string, unknown> = {}) => (await as('owner', '/api/checklists/templates', 'POST', { name: 'Tune-up sheet', fields: REQUIRED, jobTypes: ['Gate job'], ...fields })).body
    const fill = (jobId: string, tpl: any, extra: Record<string, unknown> = {}) =>
      as('tia', `/api/checklists/job/${jobId}/submit`, 'POST', { templateId: tpl.id, answers: tpl.fields.map((f: any) => ({ id: f.id, value: f.type === 'yes_no' ? 'yes' : f.type === 'pass_fail' ? 'pass' : '' })), ...extra })
    const off = async (tplId: string) => as('owner', `/api/checklists/templates/${tplId}`, 'PUT', { name: 'Tune-up sheet', fields: REQUIRED, jobTypes: ['Gate job'], active: false })

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await features(FEATURES)
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      for (const [key, role] of Object.entries({ tia: 'field', viewer: 'viewer' })) {
        const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId: co })
        id[key] = u.id; tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
    }, 120_000)

    test('Complete is refused in plain words while a required checklist is not filled in; the job stays as it was', async () => {
      const tpl = await template()
      const j = await newJob()
      const r = await as('tia', `/api/jobs/${j.id}/complete`, 'POST')
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('checklist_outstanding')
      expect(r.body.error).toContain('Tune-up sheet')
      expect(r.body.error).toContain('not filled in yet')
      expect(r.body.error).toBe('This job can\'t be completed yet: the checklist “Tune-up sheet” is not filled in yet.')
      expect(await statusOf(j.id)).toBe('in_progress')
      await off(tpl.id)
    })

    test('the office status box and Dispatch Board get the same refusal; other edits still go through', async () => {
      const tpl = await template()
      const j = await newJob()
      const r = await as('owner', `/api/jobs/${j.id}`, 'PUT', { status: 'completed' })
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('checklist_outstanding')
      expect(await statusOf(j.id)).toBe('in_progress')
      expect((await as('owner', `/api/jobs/${j.id}`, 'PUT', { title: 'Furnace — renamed' })).status).toBe(200)
      expect((await as('owner', `/api/jobs/${j.id}`, 'PUT', { status: 'on_hold' })).status).toBe(200)
      await off(tpl.id)
    })

    test('once the checklist is filled in the job completes, by either door', async () => {
      const tpl = await template()
      const a = await newJob(), b = await newJob()
      expect((await fill(a.id, tpl)).status).toBe(201)
      expect((await fill(b.id, tpl)).status).toBe(201)
      expect((await as('tia', `/api/jobs/${a.id}/complete`, 'POST')).status).toBe(200)
      expect(await statusOf(a.id)).toBe('completed')
      expect((await as('owner', `/api/jobs/${b.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
      expect(await statusOf(b.id)).toBe('completed')
      await off(tpl.id)
    })

    test("a checklist that wants the customer's signature holds the job until they sign", async () => {
      const tpl = await template({ requireSignature: true })
      const j = await newJob()
      const filled = await fill(j.id, tpl)
      expect(filled.body.status).toBe('awaiting_signature')
      const waiting = await as('tia', `/api/jobs/${j.id}/complete`, 'POST')
      expect(waiting.status).toBe(400)
      expect(waiting.body.error).toContain('needs the customer to sign')
      expect((await as('tia', `/api/checklists/submissions/${filled.body.id}/sign`, 'POST', { signature: PNG, signedBy: 'Ann Able', consent: true })).status).toBe(200)
      expect((await as('tia', `/api/jobs/${j.id}/complete`, 'POST')).status).toBe(200)
      await off(tpl.id)
    })

    test('the sentence names every checklist that is left', async () => {
      const one = await template({ name: 'Safety sheet' })
      const two = await template({ name: 'Customer sign-off', requireSignature: true })
      const j = await newJob()
      const r = await as('tia', `/api/jobs/${j.id}/complete`, 'POST')
      expect(r.body.error).toContain('Safety sheet')
      expect(r.body.error).toContain('Customer sign-off')
      await off(one.id); await off(two.id)
    })

    test('a checklist of only optional questions is offered, not demanded', async () => {
      const tpl = await template({ fields: [{ label: 'Anything else', type: 'text', required: false }] })
      const j = await newJob()
      expect((await as('tia', `/api/jobs/${j.id}/complete`, 'POST')).status).toBe(200)
      const view = await as('tia', `/api/checklists/job/${j.id}`)
      expect(view.body.outstanding[0].required).toBe(false)
      await off(tpl.id)
    })

    test('a job of another kind, a job already completed, and a business with Job Checklists off are not held', async () => {
      const tpl = await template()
      const other = await newJob({ jobType: 'Something else' })
      expect((await as('tia', `/api/jobs/${other.id}/complete`, 'POST')).status).toBe(200)
      const done = await newJob({ status: 'completed' })
      expect((await as('owner', `/api/jobs/${done.id}`, 'PUT', { title: 'Edited after' })).status).toBe(200)
      expect((await as('owner', `/api/jobs/${done.id}`, 'PUT', { status: 'completed' })).status).toBe(200)
      const held = await newJob()
      expect((await as('tia', `/api/jobs/${held.id}/complete`, 'POST')).status).toBe(400)
      await features(['contacts', 'jobs'])
      expect((await as('tia', `/api/jobs/${held.id}/complete`, 'POST')).status).toBe(200)
      await features(FEATURES)
      await off(tpl.id)
    })

    // 10/30 merge: creating a job straight as completed and the two bulk moves went round the rule. One rule now
    // (checklistRoutes.ts completionRefusal) for every door to "completed".
    test('a job created as completed, and the bulk moves, are held by the same rule', async () => {
      const tpl = await template()
      const customer = (await as('owner', '/api/contacts', 'POST', { name: 'Gate Customer', type: 'client' })).body.id
      const created = await as('owner', '/api/jobs', 'POST', { title: 'Made done', status: 'completed', jobType: 'Gate job', contactId: customer })
      expect([created.status, created.body.code]).toEqual([400, 'checklist_outstanding'])
      // a job of another kind may be created as completed
      expect((await as('owner', '/api/jobs', 'POST', { title: 'Other kind', status: 'completed', jobType: 'Something else', contactId: customer })).status).toBe(201)
      const a = await newJob(), b = await newJob({ jobType: 'Something else' })
      for (const [path, body] of [['/api/bulk/jobs/status', { ids: [a.id, b.id], status: 'completed' }], ['/api/bulk/jobs/update', { ids: [a.id, b.id], updates: { status: 'completed' } }]] as const) {
        const r = await as('owner', path, 'POST', body)
        expect([path, r.status, r.body.code]).toEqual([path, 400, 'checklist_outstanding'])
        expect(r.body.error).toContain(a.number)
        expect([await statusOf(a.id), await statusOf(b.id)]).toEqual(['in_progress', 'in_progress'])
      }
      await fill(a.id, tpl)
      expect((await as('owner', '/api/bulk/jobs/status', 'POST', { ids: [a.id, b.id], status: 'completed' })).status).toBe(200)
      expect([await statusOf(a.id), await statusOf(b.id)]).toEqual(['completed', 'completed'])
      await off(tpl.id)
    })

    test('a seat that may not update jobs gets its ordinary refusal, not the checklist sentence', async () => {
      const tpl = await template()
      const j = await newJob()
      const r = await as('viewer', `/api/jobs/${j.id}/complete`, 'POST')
      expect(r.status).toBe(403)
      expect(r.body.code).toBeUndefined()
      await off(tpl.id)
    })
  })
}
