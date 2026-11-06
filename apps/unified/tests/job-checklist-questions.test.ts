// Parity item 1 (docs/parity/fieldservice-checklists.md rows 2, 3, 9): the kinds of question a checklist can ask and the
// headings that group them — dropdown, multi-select, number, date, a photo and a signature question (Jobber's and Housecall
// Pro's types) and sections — built by the owner, answered the way each asks, and sent from the phone's offline queue.
// Through the real server and the real login, on BOTH field service and basic.
//   · the owner builds every kind; a list needs two different choices; a heading is never required; a checklist of nothing
//     but headings is refused;
//   · each kind of answer is checked (a choice that is not on the list, a number that is not one, a day that is not a day);
//   · a required question of any kind is not left empty (a required photo needs a photo, a required signature a signature);
//   · a photo is uploaded to the job first (the same name twice is one file), and only this job's photos can be attached;
//   · what the phone's queue sends after uploading (photos + photoKeys + notes) lands on the right questions;
//   · a drawn signature on a question is evidence: the field seat sees THAT it was signed, the owner sees the picture;
//   · a checklist with only a required photo question is "required" (blocks completing); one of optional answers is not.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const FEATURES = ['contacts', 'jobs', 'job_checklists']
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG = `data:image/png;base64,${PNG_B64}`
const photoForm = (name?: string) => {
  const fd = new FormData()
  fd.append('photo', new File([new Uint8Array(Buffer.from(PNG_B64, 'base64'))], 'site.png', { type: 'image/png' }))
  if (name) fd.append('name', name)
  return fd
}

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
    const upload = async (who: string, jobId: string, name?: string) => {
      const r = await t.call(`/api/checklists/job/${jobId}/photos`, { method: 'POST', body: photoForm(name), headers: { Authorization: `Bearer ${tok[who]}` } })
      return { status: r.status, body: (await r.json()) as any }
    }
    const newJob = (fields: Record<string, unknown> = {}) => ins(t.schema.job, { companyId: co, number: `J-${Math.random().toString(36).slice(2, 8)}`, title: 'Furnace', status: 'scheduled', ...fields })
    const make = (fields: any[], extra: Record<string, unknown> = {}) => as('owner', '/api/checklists/templates', 'POST', { name: `List ${Math.random().toString(36).slice(2, 6)}`, fields, jobTypes: [], ...extra })
    const ALL = [
      { label: 'Before you start', type: 'section' },
      { label: 'Filter size', type: 'dropdown', options: ['16x25', '20x25', '20x20'], required: true },
      { label: 'Problems found', type: 'multi_select', options: ['Rust', 'Leak', 'Noise'], required: true },
      { label: 'Static pressure', type: 'number', required: true },
      { label: 'Next service due', type: 'date', required: true },
      { label: 'After you finish', type: 'section' },
      { label: 'Photo of the unit', type: 'photo', required: true },
      { label: 'Customer OK', type: 'signature', required: true },
    ]
    const GOOD = (tpl: any, jobId: string, photo: string) => tpl.fields.filter((f: any) => f.type !== 'section').map((f: any) => {
      switch (f.type) {
        case 'dropdown': return { id: f.id, value: '20x25' }
        case 'multi_select': return { id: f.id, choices: ['Rust', 'Noise'] }
        case 'number': return { id: f.id, value: '0.45' }
        case 'date': return { id: f.id, value: '2027-03-15' }
        case 'photo': return { id: f.id, photos: [photo] }
        default: return { id: f.id, signature: PNG }
      }
    })
    const q = (tpl: any, label: string) => tpl.fields.find((f: any) => f.label === label)

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      // The photo store: R2 in production, the harness's in-memory one here (as the other photo tests do).
      Object.assign((t.services as any).crm.storage, {
        storageConfigured: () => true,
        put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
        getObject: async (key: string) => t.store.getObject(key),
        deleteFile: (key: string) => { void t.store.remove(key); return true },
      })
      const s = await seedOwner(t)
      co = s.company.id
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
      const login = async (e: string, p: string) => ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } })).json()) as any).accessToken
      tok.owner = await login('owner@test.example', s.password)
      for (const [key, role] of Object.entries({ tia: 'field', other: 'field', viewer: 'viewer' })) {
        const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: key, lastName: 'Seat', role, companyId: co })
        id[key] = u.id; tok[key] = await login(`${key}@test.example`, 'Seat-pass-1')
      }
    }, 120_000)

    describe('building', () => {
      test('the owner builds every kind of question and headings; choices are kept, a heading is never required', async () => {
        const r = await make(ALL.map((f) => (f.type === 'section' ? { ...f, required: true } : f)))
        expect(r.status).toBe(201)
        expect(r.body.fields.map((f: any) => f.type)).toEqual(ALL.map((f) => f.type))
        expect(q(r.body, 'Filter size').options).toEqual(['16x25', '20x25', '20x20'])
        expect(q(r.body, 'Problems found').options).toEqual(['Rust', 'Leak', 'Noise'])
        expect(q(r.body, 'Before you start').required).toBe(false)
        expect(q(r.body, 'Static pressure').options).toBeUndefined()
        // Read back from the list, as the phone gets it.
        const again = (await as('owner', '/api/checklists/templates')).body.data.find((x: any) => x.id === r.body.id)
        expect(again.fields.map((f: any) => f.label)).toEqual(ALL.map((f) => f.label))
      })

      test('a list needs two different choices; a checklist of only headings is refused; an unknown kind is refused', async () => {
        const one = await make([{ label: 'Size', type: 'dropdown', options: ['Only'] }])
        expect(one.status).toBe(400)
        expect(JSON.stringify(one.body)).toContain('two choices')
        expect((await make([{ label: 'Size', type: 'multi_select' }])).status).toBe(400)
        const same = await make([{ label: 'Size', type: 'dropdown', options: ['A', 'a'] }])
        expect(same.status).toBe(400)
        expect(JSON.stringify(same.body)).toContain('different')
        expect((await make([{ label: 'Part one', type: 'section' }])).status).toBe(400)
        expect((await make([{ label: 'Q', type: 'banana' }])).status).toBe(400)
      })
    })

    describe('filling one in', () => {
      let tpl: any
      beforeAll(async () => { tpl = (await make(ALL)).body })

      test('every kind of answer is accepted and kept as the question asks, headings kept in order', async () => {
        const j = await newJob({ assignedToId: id.tia })
        const photo = (await upload('tia', j.id)).body.url
        const r = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: tpl.id, answers: GOOD(tpl, j.id, photo) })
        expect(r.status).toBe(201)
        const items = r.body.values.items
        expect(items.map((i: any) => i.label)).toEqual(ALL.map((f) => f.label))
        expect(items.find((i: any) => i.label === 'Before you start')).toEqual({ id: q(tpl, 'Before you start').id, label: 'Before you start', type: 'section' })
        expect(items.find((i: any) => i.label === 'Filter size').value).toBe('20x25')
        expect(items.find((i: any) => i.label === 'Problems found')).toMatchObject({ value: 'Rust, Noise', choices: ['Rust', 'Noise'] })
        expect(items.find((i: any) => i.label === 'Static pressure').value).toBe('0.45')
        expect(items.find((i: any) => i.label === 'Next service due').value).toBe('2027-03-15')
        expect(items.find((i: any) => i.label === 'Photo of the unit').photos).toEqual([photo])
        expect(r.body.status).toBe('submitted')
      })

      test('an answer that is not what the question asks is refused, naming the question', async () => {
        const j = await newJob({ assignedToId: id.tia })
        const photo = (await upload('tia', j.id)).body.url
        const send = (swap: (a: any[]) => any[]) => as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: tpl.id, answers: swap(GOOD(tpl, j.id, photo)) })
        const patch = (label: string, over: any) => (a: any[]) => a.map((x) => (x.id === q(tpl, label).id ? { ...x, ...over } : x))
        const cases: Array<[string, any]> = [
          ['Filter size', { value: '30x30' }],
          ['Problems found', { choices: ['Rust', 'Fire'] }],
          ['Problems found', { choices: ['Rust', 'Rust'] }],
          ['Static pressure', { value: 'lots' }],
          ['Next service due', { value: '2027-02-30' }],
          ['Next service due', { value: 'tomorrow' }],
        ]
        for (const [label, over] of cases) {
          const r = await send(patch(label, over))
          expect(r.status, `${label} ${JSON.stringify(over)}`).toBe(400)
          expect(r.body.code).toBe('bad_answer')
          expect(r.body.fields[q(tpl, label).id]).toBeTruthy()
        }
        // An answer for a heading is not an answer.
        const head = await send((a) => [...a, { id: q(tpl, 'Before you start').id, value: 'x' }])
        expect(head.status).toBe(400)
        expect(head.body.code).toBe('unknown_question')
        expect((await t.db.select().from(t.schema.formSubmission).where(eq(t.schema.formSubmission.jobId, j.id))).length).toBe(0)
      })

      test('a required question of any kind is not left empty', async () => {
        const j = await newJob({ assignedToId: id.tia })
        const photo = (await upload('tia', j.id)).body.url
        for (const label of ['Filter size', 'Problems found', 'Static pressure', 'Next service due', 'Photo of the unit', 'Customer OK']) {
          const without = GOOD(tpl, j.id, photo).filter((x: any) => x.id !== q(tpl, label).id)
          const r = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: tpl.id, answers: without })
          expect(r.status, label).toBe(400)
          expect(r.body.code).toBe('unanswered')
          expect(r.body.fields[q(tpl, label).id]).toBe('Required')
        }
        // Present but empty counts as left empty.
        const empties = GOOD(tpl, j.id, photo).map((x: any) => (x.id === q(tpl, 'Photo of the unit').id ? { id: x.id, photos: [] } : x.id === q(tpl, 'Problems found').id ? { id: x.id, choices: [] } : x))
        expect((await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: tpl.id, answers: empties })).status).toBe(400)
      })

      test('an optional question of each kind may be left empty', async () => {
        const opt = (await make(ALL.filter((f) => f.type !== 'section').map((f) => ({ ...f, required: false })))).body
        const j = await newJob({ assignedToId: id.tia })
        expect((await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: opt.id, answers: [] })).status).toBe(201)
      })
    })

    describe('a photo question', () => {
      test('a photo is uploaded to the job: its address is this business’s and this job’s; the same name twice is one file', async () => {
        const j = await newJob({ assignedToId: id.tia })
        const a = await upload('tia', j.id, 'ck_save-0')
        expect(a.status).toBe(201)
        expect(a.body.url).toBe(`/media/photos/${co}/checklist/${j.id}/ck_save-0.png`)
        const b = await upload('tia', j.id, 'ck_save-0')
        expect(b.body.url).toBe(a.body.url)
        expect([...t.store.objects.keys()].filter((k) => k.startsWith(`photos/${co}/checklist/${j.id}/`)).length).toBe(1)
        // The type comes from the bytes: text is refused.
        const fd = new FormData(); fd.append('photo', new File(['hello'], 'a.png', { type: 'image/png' }))
        const bad = await t.call(`/api/checklists/job/${j.id}/photos`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${tok.tia}` } })
        expect(bad.status).toBe(400)
        const none = await t.call(`/api/checklists/job/${j.id}/photos`, { method: 'POST', body: new FormData(), headers: { Authorization: `Bearer ${tok.tia}` } })
        expect(none.status).toBe(400)
      })

      test('who may upload: a field seat only on its own jobs, a viewer not at all, signed in only', async () => {
        const theirs = await newJob({ assignedToId: id.other })
        expect((await upload('tia', theirs.id)).status).toBe(404)
        expect((await upload('viewer', theirs.id)).status).toBe(403)
        expect((await upload('owner', theirs.id)).status).toBe(201)
        const anon = await t.call(`/api/checklists/job/${theirs.id}/photos`, { method: 'POST', body: photoForm() })
        expect(anon.status).toBe(401)
      })

      test('only this job’s photos can be attached to its answer', async () => {
        const tpl = (await make([{ label: 'Photo', type: 'photo', required: true }])).body
        const mine = await newJob({ assignedToId: id.tia })
        const theirs = await newJob({ assignedToId: id.tia })
        const elsewhere = (await upload('tia', theirs.id)).body.url
        const r = await as('tia', `/api/checklists/job/${mine.id}/submit`, 'POST', { templateId: tpl.id, answers: [{ id: tpl.fields[0].id, photos: [elsewhere] }] })
        expect(r.status).toBe(400)
        expect(r.body.code).toBe('bad_photo')
        const web = await as('tia', `/api/checklists/job/${mine.id}/submit`, 'POST', { templateId: tpl.id, answers: [{ id: tpl.fields[0].id, photos: ['https://evil.example/x.png'] }] })
        expect(web.status).toBe(400)
        const dots = await as('tia', `/api/checklists/job/${mine.id}/submit`, 'POST', { templateId: tpl.id, answers: [{ id: tpl.fields[0].id, photos: [`/media/photos/${co}/checklist/${mine.id}/../${theirs.id}/x.png`] }] })
        expect(dots.status).toBe(400)
      })

      test('what the offline queue sends (photos, photoKeys, notes) is folded onto the right questions', async () => {
        const tpl = (await make([
          { label: 'Front', type: 'photo', required: true }, { label: 'Back', type: 'photo', required: true }, { label: 'Note', type: 'text', required: false },
        ])).body
        const j = await newJob({ assignedToId: id.tia })
        const p0 = (await upload('tia', j.id, 'ck_one-0')).body.url
        const p1 = (await upload('tia', j.id, 'ck_one-1')).body.url
        const p2 = (await upload('tia', j.id, 'ck_one-2')).body.url
        const [front, back] = [q(tpl, 'Front'), q(tpl, 'Back')]
        const r = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', {
          id: 'ck_one_send_0001', templateId: tpl.id, answers: [{ id: front.id }, { id: back.id }],
          photos: [p0, p1, p2], photoKeys: [front.id, back.id, back.id], notes: '(1 photo could not be sent from the phone)', overallNotes: 'Ran long',
        })
        expect(r.status).toBe(201)
        const items = r.body.values.items
        expect(items.find((i: any) => i.label === 'Front').photos).toEqual([p0])
        expect(items.find((i: any) => i.label === 'Back').photos).toEqual([p1, p2])
        expect(r.body.values.overallNotes).toBe('Ran long\n(1 photo could not be sent from the phone)')
        // A photo the phone left off leaves the required question empty: refused, in the question's words, not saved.
        const short = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { id: 'ck_one_send_0002', templateId: tpl.id, answers: [], photos: [p0], photoKeys: [front.id], notes: '(1 photo could not be sent from the phone)' })
        expect(short.status).toBe(400)
        expect(short.body.fields[back.id]).toBe('Required')
        // The same send again after a lost reply is still one copy.
        const again = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', {
          id: 'ck_one_send_0001', templateId: tpl.id, answers: [{ id: front.id }, { id: back.id }], photos: [p0, p1, p2], photoKeys: [front.id, back.id, back.id],
        })
        expect(again.status).toBe(200)
        expect(again.body.id).toBe(r.body.id)
      })
    })

    describe('a signature question', () => {
      test('the picture is evidence: the field seat sees that it was signed, the owner sees the picture, the record keeps when', async () => {
        const tpl = (await make([{ label: 'Customer OK', type: 'signature', required: true }, { label: 'Where', type: 'text', required: false }])).body
        const j = await newJob({ assignedToId: id.tia })
        const sig = tpl.fields[0].id
        const r = await as('tia', `/api/checklists/job/${j.id}/submit`, 'POST', { templateId: tpl.id, answers: [{ id: sig, signature: PNG }] })
        expect(r.status).toBe(201)
        const mine = r.body.values.items.find((i: any) => i.label === 'Customer OK')
        expect(mine.signature).toBeUndefined()
        expect(mine.signed).toBe(true)
        const seen = (await as('owner', `/api/checklists/job/${j.id}`)).body.submissions[0].values.items.find((i: any) => i.label === 'Customer OK')
        expect(seen.signature).toBe(PNG)
        expect(typeof seen.signedAt).toBe('string')
        const viewer = (await as('viewer', `/api/checklists/job/${j.id}`)).body.submissions[0].values.items.find((i: any) => i.label === 'Customer OK')
        expect(viewer.signature).toBeUndefined()
        expect(viewer.signed).toBe(true)
        // Not a picture: refused.
        const j2 = await newJob({ assignedToId: id.tia })
        expect((await as('tia', `/api/checklists/job/${j2.id}/submit`, 'POST', { templateId: tpl.id, answers: [{ id: sig, signature: 'not a picture' }] })).status).toBe(400)
      })
    })

    describe('what a job still owes', () => {
      test('a checklist whose only question is a required photo is required; one of optional answers and headings is not', async () => {
        const must = (await make([{ label: 'Photo', type: 'photo', required: true }])).body
        const may = (await make([{ label: 'Part one', type: 'section' }, { label: 'Notes', type: 'dropdown', options: ['a', 'b'], required: false }])).body
        const j = await newJob({ assignedToId: id.tia })
        const owed = (await as('tia', `/api/checklists/job/${j.id}`)).body.outstanding
        expect(owed.find((o: any) => o.templateId === must.id).required).toBe(true)
        expect(owed.find((o: any) => o.templateId === may.id).required).toBe(false)
      })
    })
  })
}
