// Parity item 2 (docs/parity/fieldservice-checklists.md rows 4, 5, 11, 12, 13): a checklist through the job's life.
// Through the real server and the real login, on BOTH field service and basic.
//   · a job MADE gets a row for each active checklist that fits its type (not only offered); one that does not fit, or is switched
//     off, gets none; a job made another way gets its rows when its checklists are first opened; opening twice adds nothing;
//   · filling the checklist in turns that row into the filled-in copy (never two), and the rows never show to the customer's portal;
//   · the server still refuses completing the job while a required checklist is open — through the Complete button and the edit —
//     and allows it once the checklist is filled in (the rule is the one gate for every door);
//   · the finished checklist is a PDF; one that is not finished is refused; a seat that cannot reach the job gets nothing;
//   · it is emailed to the customer with the PDF attached (to the address typed, else the customer's; none → asked for one);
//   · it is attached to the invoice of its job (once), listed there, downloaded, removed, and goes out with the invoice email;
//   · a move a checklist asks to be prompted on tells the people on the job; a move it did not ask for tells no one;
//   · a visit done with an optional checklist unfilled tells the office, and the report lists it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'job_checklists', 'invoices']
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    const tok: Record<string, string> = {}
    const id: Record<string, string> = {}
    const pushes: Array<{ ids: string[]; title: string; body: string }> = []
    const mails: any[] = []
    const invoiceMails: any[] = []
    const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
    const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok[who]}` } })
      const buf = Buffer.from(await r.arrayBuffer()); const text = buf.toString('utf8'); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body, type: r.headers.get('content-type') || '', bytes: buf }
    }
    const rows = (jobId: string) => t.db.select().from(t.schema.formSubmission).where(eq(t.schema.formSubmission.jobId, jobId)) as Promise<any[]>
    const make = (name: string, extra: Record<string, unknown> = {}) => as('owner', '/api/checklists/templates', 'POST', {
      name, fields: [{ label: 'Filter changed', type: 'yes_no', required: true }], jobTypes: [], ...extra,
    })
    let invoiceNo = 0
    const newInvoice = (fields: Record<string, unknown> = {}) => ins(t.schema.invoice, {
      companyId: co, number: `INV-T${++invoiceNo}`, contactId: id.customer, status: 'draft', subtotal: '100', total: '100', lineItems: [{ description: 'Tune-up', quantity: 1, unitPrice: 100, total: 100 }], ...fields,
    })
    const newJob = (jobType: string | null, fields: Record<string, unknown> = {}) =>
      as('owner', '/api/jobs', 'POST', { title: 'Furnace', contactId: id.customer, ...(jobType ? { jobType } : {}), ...fields }).then((r) => r.body)
    const fill = async (jobId: string, tplId: string, who = 'owner') => {
      const tpl = (await as('owner', '/api/checklists/templates')).body.data.find((x: any) => x.id === tplId)
      return as(who, `/api/checklists/job/${jobId}/submit`, 'POST', { templateId: tplId, answers: tpl.fields.filter((f: any) => f.type !== 'section').map((f: any) => ({ id: f.id, value: f.type === 'yes_no' ? 'yes' : 'ok' })) })
    }

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      Object.assign((t.services as any).crm.storage, {
        storageConfigured: () => true,
        put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
        getObject: async (key: string) => t.store.getObject(key),
        deleteFile: (key: string) => { void t.store.remove(key); return true },
      })
      // Mail and phone notices are recorded, not sent.
      Object.assign((t.services as any).crm.emailService, {
        sendRaw: async (m: any) => { mails.push(m); return { success: true } },
        send: async (to: string, template: string, data: any, options: any) => { invoiceMails.push({ to, template, data, options }); return { success: true } },
      })
      ;(t.services as any).phonePush.send = async (_co: string, ids: string[], m: any) => { pushes.push({ ids, title: m.title, body: m.body }); return ids.length }
      const s = await seedOwner(t)
      co = s.company.id
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      for (const [key, role] of Object.entries({ tia: 'field', other: 'field' })) {
        const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId: co })
        id[key] = u.id; tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
      id.customer = (await as('owner', '/api/contacts', 'POST', { name: 'Pat Customer', email: 'pat@example.com', type: 'client' })).body.id
      id.nomail = (await as('owner', '/api/contacts', 'POST', { name: 'No Mail', type: 'client' })).body.id
    }, 120_000)

    describe('a job gets its checklists as rows', () => {
      test('made with a type: a row per active checklist that fits; none for one that does not fit or is switched off', async () => {
        const fits = (await make('Tune-up', { jobTypes: ['Tune-up'] })).body
        const everyJob = (await make('Arrival photo check')).body
        const other = (await make('Install only', { jobTypes: ['Install'] })).body
        const off = (await make('Retired', { jobTypes: ['Tune-up'], active: false })).body
        id.fits = fits.id; id.everyJob = everyJob.id
        const j = await newJob('Tune-up')
        const have = (await rows(j.id)).map((r) => r.templateId).sort()
        expect(have).toEqual([fits.id, everyJob.id].sort())
        expect(have).not.toContain(other.id)
        expect(have).not.toContain(off.id)
        expect((await rows(j.id)).every((r) => r.status === 'assigned')).toBe(true)
        id.job = j.id
      })

      test('each visit of a repeating job gets its rows', async () => {
        const r = await as('owner', '/api/jobs', 'POST', { title: 'Weekly', contactId: id.customer, jobType: 'Tune-up', scheduledDate: '2027-02-01', repeat: { frequency: 'weekly', interval: 1, count: 3 } })
        expect(r.status).toBe(201)
        const all = await t.db.select().from(t.schema.job).where(eq(t.schema.job.seriesId, r.body.series.id)) as any[]
        expect(all.length).toBe(3)
        for (const v of all) expect((await rows(v.id)).length).toBe(2)
      })

      test('a job made another way gets its rows when its checklists are first opened — once', async () => {
        const j = await ins(t.schema.job, { companyId: co, number: 'J-DIRECT', title: 'Direct', status: 'scheduled', jobType: 'Tune-up', contactId: id.customer })
        expect((await rows(j.id)).length).toBe(0)
        const first = await as('owner', `/api/checklists/job/${j.id}`)
        expect(first.status).toBe(200)
        expect((await rows(j.id)).length).toBe(2)
        await as('owner', `/api/checklists/job/${j.id}`)
        expect((await rows(j.id)).length).toBe(2)
        // The waiting rows are not filled-in checklists: the job's list of what was submitted has none.
        expect(first.body.submissions).toEqual([])
        expect(first.body.outstanding.map((o: any) => o.name).sort()).toEqual(['Arrival photo check', 'Tune-up'])
      })

      test('filling it in turns the row into the filled-in copy: never two', async () => {
        const r = await fill(id.job, id.fits)
        expect(r.status).toBe(201)
        const mine = (await rows(id.job)).filter((x) => x.templateId === id.fits)
        expect(mine.length).toBe(1)
        expect(mine[0].status).toBe('submitted')
        // The same send repeated (a lost reply) is still one.
        const again = await as('owner', `/api/checklists/job/${id.job}/submit`, 'POST', { id: r.body.id, templateId: id.fits, answers: [{ id: (await as('owner', '/api/checklists/templates')).body.data.find((x: any) => x.id === id.fits).fields[0].id, value: 'yes' }] })
        expect(again.status).toBe(200)
        expect((await rows(id.job)).filter((x) => x.templateId === id.fits).length).toBe(1)
      })

      test('removing a checklist nobody filled in takes its waiting rows with it', async () => {
        const gone = (await make('Short lived', { jobTypes: ['Gone'] })).body
        const j = await newJob('Gone')
        expect((await rows(j.id)).map((x) => x.templateId)).toContain(gone.id)
        const r = await as('owner', `/api/checklists/templates/${gone.id}`, 'DELETE')
        expect(r.status).toBe(200)
        expect((await rows(j.id)).map((x) => x.templateId)).not.toContain(gone.id)
      })
    })

    describe('the server stops completing a job with a required checklist open', () => {
      test('refused by Complete and by the edit; allowed once it is filled in', async () => {
        const j = await newJob('Tune-up')
        const refused = await as('owner', `/api/jobs/${j.id}/complete`, 'POST', {})
        expect(refused.status).toBe(400)
        expect(refused.body.code).toBe('checklist_outstanding')
        expect(refused.body.error).toContain('Tune-up')
        const edit = await as('owner', `/api/jobs/${j.id}`, 'PUT', { status: 'completed' })
        expect(edit.status).toBe(400)
        await fill(j.id, id.fits); await fill(j.id, id.everyJob)
        const ok = await as('owner', `/api/jobs/${j.id}/complete`, 'POST', {})
        expect(ok.status).toBe(200)
      })
    })

    describe('the PDF', () => {
      test('a finished checklist is a PDF; one not finished is refused; a seat off the job gets nothing', async () => {
        const sub = (await rows(id.job)).find((r) => r.templateId === id.fits)
        const r = await as('owner', `/api/checklists/submissions/${sub.id}/pdf`)
        expect(r.status).toBe(200)
        expect(r.type).toContain('application/pdf')
        expect(r.bytes.subarray(0, 4).toString()).toBe('%PDF')
        const waiting = (await rows(id.job)).find((x) => x.templateId === id.everyJob)
        const no = await as('owner', `/api/checklists/submissions/${waiting.id}/pdf`)
        expect(no.status).toBe(409)
        expect(no.body.code).toBe('not_finished')
        // A field seat that is not on the job cannot reach it.
        expect((await as('other', `/api/checklists/submissions/${sub.id}/pdf`)).status).toBe(404)
      })

      test('the checklist is on the PDF in words, with its photo question and signature', async () => {
        const tpl = (await as('owner', '/api/checklists/templates', 'POST', {
          name: 'Full list', jobTypes: ['Full'],
          fields: [{ label: 'Part one', type: 'section' }, { label: 'Result', type: 'pass_fail', required: true }, { label: 'Unit photo', type: 'photo', required: false }, { label: 'Customer OK', type: 'signature', required: false }],
        })).body
        const j = await newJob('Full')
        const up = new FormData(); up.append('photo', new File([new Uint8Array(Buffer.from(PNG_B64, 'base64'))], 'p.png', { type: 'image/png' }))
        const photo = (await (await t.call(`/api/checklists/job/${j.id}/photos`, { method: 'POST', body: up, headers: { Authorization: `Bearer ${tok.owner}` } })).json() as any).url
        const f = (label: string) => tpl.fields.find((x: any) => x.label === label).id
        const sent = await as('owner', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: tpl.id, answers: [{ id: f('Result'), value: 'attention' }, { id: f('Unit photo'), photos: [photo] }, { id: f('Customer OK'), signature: `data:image/png;base64,${PNG_B64}` }] })
        expect(sent.status).toBe(201)
        const pdf = await as('owner', `/api/checklists/submissions/${sent.body.id}/pdf`)
        expect(pdf.status).toBe(200)
        expect(pdf.bytes.length).toBeGreaterThan(1500)
      })
    })

    describe('emailed to the customer', () => {
      test('goes to the customer with the PDF attached; to a typed address; none known → asked for one', async () => {
        const sub = (await rows(id.job)).find((r) => r.templateId === id.fits)
        // The job's customer has an email.
        const ok = await as('owner', `/api/checklists/submissions/${sub.id}/email`, 'POST', {})
        expect(ok.status).toBe(200)
        expect(ok.body.sentTo).toBe('pat@example.com')
        const m = mails.at(-1)
        expect(m.to).toBe('pat@example.com')
        expect(m.attachments[0].filename).toMatch(/\.pdf$/)
        expect(Buffer.from(m.attachments[0].content).subarray(0, 4).toString()).toBe('%PDF')
        // An address typed in wins.
        const typed = await as('owner', `/api/checklists/submissions/${sub.id}/email`, 'POST', { to: 'office@example.com' })
        expect(typed.body.sentTo).toBe('office@example.com')
        expect((await as('owner', `/api/checklists/submissions/${sub.id}/email`, 'POST', { to: 'not an address' })).status).toBe(400)
        // A customer with no email: asked for one, nothing sent.
        const j = await newJob('Tune-up', { contactId: id.nomail })
        await fill(j.id, id.fits)
        const s2 = (await rows(j.id)).find((r) => r.templateId === id.fits)
        const before = mails.length
        const none = await as('owner', `/api/checklists/submissions/${s2.id}/email`, 'POST', {})
        expect(none.status).toBe(400)
        expect(none.body.code).toBe('no_email')
        expect(mails.length).toBe(before)
      })
    })

    describe('attached to the invoice', () => {
      test('listed, attached once, downloaded, removed; it must be the invoice of the same job; it goes out with the invoice email', async () => {
        const sub = (await rows(id.job)).find((r) => r.templateId === id.fits)
        const inv = await newInvoice({ jobId: id.job })
        expect(inv.id).toBeTruthy()
        const list = await as('owner', `/api/checklists/invoice/${inv.id}`)
        expect(list.body.available.map((a: any) => a.submissionId)).toContain(sub.id)
        expect(list.body.attached).toEqual([])
        const a1 = await as('owner', `/api/checklists/submissions/${sub.id}/attach`, 'POST', { invoiceId: inv.id })
        expect(a1.status).toBe(201)
        const a2 = await as('owner', `/api/checklists/submissions/${sub.id}/attach`, 'POST', { invoiceId: inv.id })
        expect(a2.body.id).toBe(a1.body.id)
        const after = (await as('owner', `/api/checklists/invoice/${inv.id}`)).body
        expect(after.attached.length).toBe(1)
        expect(after.available.map((a: any) => a.submissionId)).not.toContain(sub.id)
        const file = await as('owner', `/api/checklists/attached/${a1.body.id}/file`)
        expect(file.status).toBe(200)
        expect(file.bytes.subarray(0, 4).toString()).toBe('%PDF')
        // The invoice email carries it.
        const sent = await as('owner', `/api/invoices/${inv.id}/send`, 'POST', {})
        expect(sent.status).toBe(200)
        const mail = invoiceMails.at(-1)
        expect(mail.template).toBe('invoiceSent')
        expect(mail.options.attachments.length).toBe(1)
        expect(mail.options.attachments[0].filename).toMatch(/\.pdf$/)
        // Another job's invoice refuses it.
        const otherJob = await newJob('Tune-up')
        const otherInv = await newInvoice({ jobId: otherJob.id })
        const wrong = await as('owner', `/api/checklists/submissions/${sub.id}/attach`, 'POST', { invoiceId: otherInv.id })
        expect(wrong.status).toBe(409)
        // Removed.
        expect((await as('owner', `/api/checklists/attached/${a1.body.id}`, 'DELETE')).status).toBe(200)
        expect((await as('owner', `/api/checklists/invoice/${inv.id}`)).body.attached).toEqual([])
      })

      test('an invoice with nothing attached is sent as it always was', async () => {
        const inv = await newInvoice()
        const before = invoiceMails.length
        expect((await as('owner', `/api/invoices/${inv.id}/send`, 'POST', {})).status).toBe(200)
        expect(invoiceMails.length).toBe(before + 1)
        expect(invoiceMails.at(-1).options?.attachments).toBeUndefined()
      })
    })

    describe('a status change prompts the form', () => {
      test('moving into a status the checklist asked for tells the people on the job; another move tells no one', async () => {
        const asked = (await make('On site form', { jobTypes: ['Prompted'], promptOn: ['in_progress'], fields: [{ label: 'Photo taken', type: 'yes_no', required: false }] })).body
        expect(asked.promptOn).toEqual(['in_progress'])
        const j = await newJob('Prompted', { assignedToId: id.tia })
        pushes.length = 0
        await as('owner', `/api/jobs/${j.id}/dispatch`, 'POST', {})
        expect(pushes.filter((p) => p.title.includes('On site form'))).toEqual([])
        const start = await as('owner', `/api/jobs/${j.id}/start`, 'POST', {})
        expect(start.status).toBe(200)
        const note = pushes.find((p) => p.title.includes('On site form'))
        expect(note).toBeTruthy()
        expect(note!.ids).toContain(id.tia)
        expect(note!.body).toContain('started')
      })
    })

    describe('a visit done with a checklist not done', () => {
      test('tells the office, and the report lists it', async () => {
        await make('Optional note', { jobTypes: ['Optional'], fields: [{ label: 'Anything to add', type: 'text', required: false }] })
        const j = await newJob('Optional', { scheduledDate: '2027-03-01' })
        await fill(j.id, id.everyJob) // the one every job gets has a required question
        pushes.length = 0
        const done = await as('owner', `/api/jobs/${j.id}/complete`, 'POST', {})
        expect(done.status).toBe(200)
        const alert = pushes.find((p) => p.title === 'Checklist not done')
        expect(alert).toBeTruthy()
        expect(alert!.ids).toContain((await t.db.select().from(t.schema.user) as any[]).find((u) => u.email === 'owner@test.example').id)
        expect(alert!.ids).not.toContain(id.tia)
        expect(alert!.body).toContain('Optional note')
        const rep = await as('owner', '/api/checklists/report')
        expect(rep.status).toBe(200)
        const line = rep.body.notDone.find((n: any) => n.jobId === j.id)
        expect(line).toBeTruthy()
        expect(line.checklist).toBe('Optional note')
        expect(line.why).toBe('Not filled in')
        const per = rep.body.byChecklist.find((r: any) => r.name === 'Optional note')
        expect(per.added).toBe(1); expect(per.filled).toBe(0); expect(per.notFilled).toBe(1)
        const tune = rep.body.byChecklist.find((r: any) => r.name === 'Tune-up')
        expect(tune.filled).toBeGreaterThan(0)
        // A field seat cannot read the report.
        expect((await as('tia', '/api/checklists/report')).status).toBe(403)
        expect((await as('owner', '/api/checklists/report?startDate=nope')).status).toBe(400)
      })
    })

    test('the feature is off: no routes', async () => {
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs'] } as any).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
      expect((await as('owner', '/api/checklists/report')).status).toBe(403)
      const before = (await t.db.select().from(t.schema.formSubmission)).length
      await newJob('Tune-up')
      expect((await t.db.select().from(t.schema.formSubmission)).length).toBe(before)
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
    })
  })
}
