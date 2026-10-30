// Item 3 of the field-service depth brief: checklists the OWNER builds per kind of job (/api/checklists), filled in on
// the phone and signed by the customer on site with signing evidence. Through the real server and the real login, on
// BOTH field service and basic (basic has no /api/tech, so this feature carries its own doors).
//   · the owner builds, edits and removes checklists (settings:update); a Staff or Viewer seat is refused;
//   · a checklist is for chosen job types, or for every job when none is chosen;
//   · a job's type can be set (and is refused when too long);
//   · filling one in: required questions, answers in the form the question asks, a photo when the checklist wants one;
//   · a checklist that wants the customer's signature stays "needs signature" until they sign; signing needs their typed
//     name and their agreement, is done once, and keeps who/when/where/what-they-saw;
//   · the evidence (image, address, browser, fingerprint) is for jobs:dispatch; the field seat sees THAT it was signed;
//   · a field seat reaches only its own jobs; a viewer reads but does not fill in;
//   · closed (and the job type box gone) while the feature is off.
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
    const as = async (who: string, path: string, method = 'GET', json?: unknown, headers: Record<string, string> = {}) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}`, ...headers } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
    const newJob = (fields: Record<string, unknown> = {}) => ins(t.schema.job, { companyId: co, number: `J-${Math.random().toString(36).slice(2, 8)}`, title: 'Furnace', status: 'scheduled', ...fields })
    const FIELDS = [
      { label: 'Filter changed', type: 'yes_no', required: true },
      { label: 'Pressure OK', type: 'pass_fail', required: true },
      { label: 'Anything else', type: 'text', required: false },
    ]
    const template = (fields: Record<string, unknown> = {}) => as('owner', '/api/checklists/templates', 'POST', { name: 'Furnace tune-up', fields: FIELDS, jobTypes: ['Furnace tune-up'], ...fields })
    const answers = (tpl: any, over: Record<number, string> = {}) => tpl.fields.map((f: any, i: number) => ({ id: f.id, value: over[i] ?? (f.type === 'yes_no' ? 'yes' : f.type === 'pass_fail' ? 'pass' : '') }))
    const SIGN = { signature: PNG, signedBy: 'Ann Able', consent: true }

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      co = s.company.id
      await features(FEATURES)
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      for (const [key, role] of Object.entries({ tia: 'field', other: 'field', manager: 'manager', viewer: 'viewer' })) {
        const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId: co })
        id[key] = u.id; tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
      id.ann = (await ins(t.schema.contact, { companyId: co, name: 'Ann Able', type: 'client' })).id
    }, 120_000)

    describe('building the checklists', () => {
      test('the owner builds one; its questions get ids and it keeps its job types', async () => {
        const r = await template()
        expect(r.status).toBe(201)
        expect(r.body.fields.length).toBe(3)
        expect(r.body.fields.every((f: any) => typeof f.id === 'string' && f.id.length > 0)).toBe(true)
        expect(r.body.jobTypes).toEqual(['Furnace tune-up'])
        const list = await as('manager', '/api/checklists/templates')
        expect(list.status).toBe(200)
        expect(list.body.data.some((x: any) => x.id === r.body.id)).toBe(true)
      })

      test('the owner edits and removes one; an unused one is deleted, a used one is switched off and kept', async () => {
        const made = (await template({ name: 'Old name' })).body
        const edited = await as('owner', `/api/checklists/templates/${made.id}`, 'PUT', { name: 'New name', fields: made.fields, jobTypes: [] })
        expect(edited.status).toBe(200)
        expect(edited.body.name).toBe('New name')
        expect(edited.body.jobTypes).toEqual([])
        expect((await as('owner', `/api/checklists/templates/${made.id}`, 'DELETE')).status).toBe(200)
        expect((await as('owner', `/api/checklists/templates/${made.id}`, 'PUT', { name: 'x', fields: made.fields })).status).toBe(404)

        const used = (await template({ name: 'Used one', jobTypes: [] })).body
        const j = await newJob({ assignedToId: id.tia })
        expect((await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: used.id, answers: answers(used) })).status).toBe(201)
        const gone = await as('owner', `/api/checklists/templates/${used.id}`, 'DELETE')
        expect(gone.status).toBe(200)
        expect(gone.body.archived).toBe(true)
        const list = (await as('owner', '/api/checklists/templates')).body.data
        expect(list.find((x: any) => x.id === used.id)?.active).toBe(false)
      })

      test('mistakes are refused by field', async () => {
        const empty = await as('owner', '/api/checklists/templates', 'POST', { name: '', fields: [] })
        expect(empty.status).toBe(400)
        const bad = await template({ fields: [{ label: 'Q', type: 'banana' }] })
        expect(bad.status).toBe(400)
        expect((await template({ jobTypes: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400)
      })

      test('the doors: building is settings:update; a Staff or Viewer seat is refused; reading needs jobs:read; signed in only', async () => {
        const body = { name: 'Sneaky', fields: FIELDS }
        for (const who of ['tia', 'viewer']) {
          expect((await as(who, '/api/checklists/templates', 'POST', body)).status).toBe(403)
          expect((await as(who, '/api/checklists/templates/x', 'PUT', body)).status).toBe(403)
          expect((await as(who, '/api/checklists/templates/x', 'DELETE')).status).toBe(403)
        }
        expect((await as('tia', '/api/checklists/templates')).status).toBe(200)
        expect((await t.call('/api/checklists/templates')).status).toBe(401)
      })

      test('not ready: closed to a business that does not have it', async () => {
        await features(FEATURES.filter((f) => f !== 'job_checklists'))
        try { expect([403, 404]).toContain((await as('owner', '/api/checklists/templates')).status) } finally { await features(FEATURES) }
      })
    })

    describe('a job type', () => {
      test('is set on a job, trimmed; one that is too long is refused', async () => {
        const j = (await as('owner', '/api/jobs', 'POST', { title: 'Tune-up', jobType: '  Furnace tune-up ' }))
        expect(j.status).toBe(201)
        expect(j.body.jobType).toBe('Furnace tune-up')
        const moved = await as('owner', `/api/jobs/${j.body.id}`, 'PUT', { title: 'Tune-up', jobType: 'Install' })
        expect(moved.status).toBe(200)
        expect(moved.body.jobType).toBe('Install')
        expect((await as('owner', '/api/jobs', 'POST', { title: 'Tune-up', jobType: 'x'.repeat(41) })).status).toBe(400)
        // With no type given the trade's own default stands (field service: repair; basic: service).
        expect(['repair', 'service']).toContain((await as('owner', '/api/jobs', 'POST', { title: 'No type' })).body.jobType)
      })
    })

    describe('on a job', () => {
      let tpl: any, everyJob: any
      beforeAll(async () => {
        tpl = (await template({ name: 'Tune-up list', jobTypes: ['Tune-up'] })).body
        everyJob = (await template({ name: 'Every job list', jobTypes: [], fields: [{ label: 'Site tidy', type: 'yes_no', required: true }] })).body
      })

      test('a job gets the checklists for its type, and the ones for every job', async () => {
        const a = await newJob({ jobType: 'Tune-up', assignedToId: id.tia })
        const b = await newJob({ jobType: 'Install', assignedToId: id.tia })
        const names = async (j: any) => ((await as('tia', `/api/checklists/job/${j.id}`)).body.templates as any[]).map((x) => x.name)
        expect(await names(a)).toContain('Tune-up list')
        expect(await names(a)).toContain('Every job list')
        expect(await names(b)).not.toContain('Tune-up list')
        expect(await names(b)).toContain('Every job list')
        const view = (await as('tia', `/api/checklists/job/${a.id}`)).body
        expect(view.outstanding.map((o: any) => o.name)).toContain('Tune-up list')
      })

      test('filling one in: required questions, the form of the answer, nothing from another checklist', async () => {
        const j = await newJob({ jobType: 'Tune-up', assignedToId: id.tia })
        const url = `/api/checklists/job/${j.id}/submit`
        const missing = await as('tia', url, 'POST', { templateId: tpl.id, answers: answers(tpl, { 0: '' }) })
        expect(missing.status).toBe(400)
        expect(missing.body.code).toBe('unanswered')
        expect(missing.body.error).toContain('Filter changed')
        const badForm = await as('tia', url, 'POST', { templateId: tpl.id, answers: answers(tpl, { 1: 'yes' }) })
        expect(badForm.status).toBe(400)
        expect(badForm.body.code).toBe('bad_answer')
        const stranger = await as('tia', url, 'POST', { templateId: tpl.id, answers: [...answers(tpl), { id: 'nope', value: 'x' }] })
        expect(stranger.body.code).toBe('unknown_question')
        const wrongJob = await newJob({ jobType: 'Install', assignedToId: id.tia })
        const notFor = await as('tia', `/api/checklists/job/${wrongJob.id}/submit`, 'POST', { templateId: tpl.id, answers: answers(tpl) })
        expect(notFor.status).toBe(409)
        expect(notFor.body.code).toBe('not_for_this_job')

        const ok = await as('tia', url, 'POST', { templateId: tpl.id, answers: answers(tpl, { 2: 'Belt is worn' }), overallNotes: 'Done' })
        expect(ok.status).toBe(201)
        expect(ok.body.status).toBe('submitted')
        expect(ok.body.values.items.find((i: any) => i.label === 'Anything else').value).toBe('Belt is worn')
        const view = (await as('tia', `/api/checklists/job/${j.id}`)).body
        expect(view.submissions.length).toBe(1)
        expect(view.outstanding.map((o: any) => o.name)).not.toContain('Tune-up list')
      })

      test('a checklist that wants a photo is refused until the job has one', async () => {
        const p = (await template({ name: 'Photo list', jobTypes: [], requirePhoto: true })).body
        const j = await newJob({ assignedToId: id.tia })
        const url = `/api/checklists/job/${j.id}/submit`
        const no = await as('tia', url, 'POST', { templateId: p.id, answers: answers(p) })
        expect(no.status).toBe(400)
        expect(no.body.code).toBe('photo_required')
        await ins(t.schema.jobPhoto, { companyId: co, jobId: j.id, url: '/media/photos/x.jpg' })
        expect((await as('tia', url, 'POST', { templateId: p.id, answers: answers(p) })).status).toBe(201)
      })

      test('a checklist that wants the customer: waits for the signature, then keeps the evidence', async () => {
        const s = (await template({ name: 'Signed list', jobTypes: [], requireSignature: true })).body
        const j = await newJob({ assignedToId: id.tia, contactId: id.ann })
        const made = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: s.id, answers: answers(s) })
        expect(made.status).toBe(201)
        expect(made.body.status).toBe('awaiting_signature')
        const waiting = (await as('tia', `/api/checklists/job/${j.id}`)).body.outstanding.find((o: any) => o.templateId === s.id)
        expect(waiting.why).toBe('needs the customer to sign')
        expect(waiting.submissionId).toBe(made.body.id)

        const sign = (body: unknown) => as('tia', `/api/checklists/submissions/${made.body.id}/sign`, 'POST', body, { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'PhoneTest/1' })
        expect((await sign({ ...SIGN, consent: false })).status).toBe(400)
        expect((await sign({ ...SIGN, signedBy: '  ' })).status).toBe(400)
        expect((await sign({ ...SIGN, signature: 'not an image' })).status).toBe(400)
        const signed = await sign(SIGN)
        expect(signed.status).toBe(200)
        expect(signed.body.status).toBe('signed')
        expect(signed.body.signed).toBe(true)
        expect(signed.body.signedBy).toBe('Ann Able')
        // The field seat sees THAT it was signed — not the evidence.
        for (const k of ['signature', 'signedIp', 'signedUserAgent', 'signatureHash', 'consentAt']) expect(signed.body[k]).toBeUndefined()
        const row = (await t.db.select().from(t.schema.formSubmission).where(eq(t.schema.formSubmission.id, made.body.id)))[0] as any
        expect(row.signedIp).toBe('203.0.113.9')
        expect(row.signedUserAgent).toBe('PhoneTest/1')
        expect(row.signatureHash).toMatch(/^[0-9a-f]{64}$/)
        expect(row.consentAt).toBeTruthy()
        expect(row.signature).toBe(PNG)
        // The seat that administers jobs gets the evidence.
        const asManager = (await as('manager', `/api/checklists/job/${j.id}`)).body.submissions.find((x: any) => x.id === made.body.id)
        expect(asManager.signatureHash).toBe(row.signatureHash)
        expect(asManager.signedIp).toBe('203.0.113.9')
        expect(asManager.signature).toBe(PNG)
        // Once signed it is not signed again, and it is no longer owed.
        expect((await sign(SIGN)).status).toBe(409)
        expect((await as('tia', `/api/checklists/job/${j.id}`)).body.outstanding.map((o: any) => o.templateId)).not.toContain(s.id)
      })

      test('signed in one go with the answers; what they saw is fingerprinted', async () => {
        const s = (await template({ name: 'One go list', jobTypes: [], requireSignature: true })).body
        const j = await newJob({ assignedToId: id.tia })
        const url = `/api/checklists/job/${j.id}/submit`
        const noName = await as('tia', url, 'POST', { templateId: s.id, answers: answers(s), signature: { ...SIGN, signedBy: '' } })
        expect(noName.status).toBe(400)
        expect((await t.db.select().from(t.schema.formSubmission).where(eq(t.schema.formSubmission.jobId, j.id))).length).toBe(0)
        const one = await as('tia', url, 'POST', { templateId: s.id, answers: answers(s), signature: SIGN })
        const two = await as('tia', url, 'POST', { templateId: s.id, answers: answers(s, { 1: 'fail' }), signature: SIGN })
        expect(one.body.status).toBe('signed')
        const hash = async (sid: string) => ((await t.db.select().from(t.schema.formSubmission).where(eq(t.schema.formSubmission.id, sid)))[0] as any).signatureHash
        expect(await hash(one.body.id)).not.toBe(await hash(two.body.id))
      })

      test('who can do what: a field seat reaches only its own jobs, a viewer reads and does not fill in', async () => {
        const mine = await newJob({ assignedToId: id.tia })
        const theirs = await newJob({ assignedToId: id.other })
        expect((await as('tia', `/api/checklists/job/${theirs.id}`)).status).toBe(404)
        expect((await as('tia', `/api/checklists/job/${theirs.id}/submit`, 'POST', { templateId: everyJob.id, answers: answers(everyJob) })).status).toBe(404)
        expect((await as('manager', `/api/checklists/job/${theirs.id}`)).status).toBe(200)
        expect((await as('viewer', `/api/checklists/job/${mine.id}`)).status).toBe(200)
        expect((await as('viewer', `/api/checklists/job/${mine.id}/submit`, 'POST', { templateId: everyJob.id, answers: answers(everyJob) })).status).toBe(403)
        expect((await as('viewer', '/api/checklists/submissions/x/sign', 'POST', SIGN)).status).toBe(403)
        expect((await t.call(`/api/checklists/job/${mine.id}`)).status).toBe(401)
      })
    })
  })
}
