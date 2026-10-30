// Inspection checklists (brief item 7, contractors): a saved checklist is copied onto a visit, each line is answered
// pass / fail / n.a. with a note and photos, and a FAILED line puts a snag on the project's punch list by itself.
// The feature is inspection_checklists (registered not ready). Without it nothing about an inspection changes.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY, getAdvertisableFeaturesForTemplate } from '@twomiah/tenant-backend'

const json = async (r: Response) => (await r.json()) as any
const ON = ['contacts', 'projects', 'inspections', 'punch_lists', 'inspection_checklists']
const today = () => new Date().toISOString().slice(0, 10)

async function boot(vertical = 'contractor', features = ON) {
  const t = await bootTenant({ vertical })
  // The file store: R2 in production, the harness's in-memory one here (as the other photo tests do).
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: (key: string) => { void t.store.remove(key); return true },
  })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const seat = async (role: string) => {
    await ins(t.schema.user, { companyId: s.company.id, email: `${role}@test.example`, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return as(await login(`${role}@test.example`, 'Correct-horse-1'))
  }
  const companyId = s.company.id as string
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ruiz Family' })
  const house = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Ruiz addition', type: 'renovation', contactId: customer.id })
  const visit = async (over: any = {}) => json(await owner('/api/inspections', { method: 'POST', json: { type: 'Framing', projectId: house.id, scheduledDate: today(), ...over } }))
  const framing = async () => json(await owner('/api/inspection-templates', { method: 'POST', json: { name: 'Framing walk-through', type: 'Framing', items: ['Hangers at every joist', 'Firestopping complete', 'Hold-downs at the shear walls'] } }))
  const start = async (inspectionId: string, templateId: string, who = owner) => who(`/api/inspection-checklists/${inspectionId}/start`, { method: 'POST', json: { templateId } })
  const answer = (inspectionId: string, itemId: string, body: any, who = owner) => who(`/api/inspection-checklists/${inspectionId}/items/${itemId}`, { method: 'PUT', json: body })
  const lines = async (inspectionId: string) => (await json(await owner(`/api/inspection-checklists/${inspectionId}`))).items as any[]
  const snags = async () => (await json(await owner('/api/punch-lists'))).data.map((r: any) => r.punchListItem)
  return { t, ins, owner, seat, companyId, house, visit, framing, start, answer, lines, snags }
}

describe('a checklist is copied onto the visit', () => {
  test('starting from a saved checklist puts its lines on the visit, in order, unanswered — and editing the template later does not change the visit', async () => {
    const x = await boot()
    const tpl = await x.framing()
    expect(tpl.items.map((i: any) => i.label)).toEqual(['Hangers at every joist', 'Firestopping complete', 'Hold-downs at the shear walls'])
    const v = await x.visit()
    const started = await x.start(v.id, tpl.id)
    expect(started.status).toBe(201)
    const l = await x.lines(v.id)
    expect(l.map((i: any) => [i.label, i.result])).toEqual([['Hangers at every joist', 'pending'], ['Firestopping complete', 'pending'], ['Hold-downs at the shear walls', 'pending']])

    await x.owner(`/api/inspection-templates/${tpl.id}`, { method: 'PUT', json: { items: ['Something else entirely'] } })
    expect((await x.lines(v.id)).map((i: any) => i.label)).toContain('Firestopping complete')   // the visit keeps its own copy
    // a second start is refused rather than doubling the lines
    expect((await x.start(v.id, tpl.id)).status).toBe(409)
  }, 90_000)

  test('lines can also be typed on the spot, and one more can be added to a visit', async () => {
    const x = await boot()
    const v = await x.visit()
    expect((await x.owner(`/api/inspection-checklists/${v.id}/start`, { method: 'POST', json: { items: ['Anchor bolts', 'Sill plate'] } })).status).toBe(201)
    expect((await x.owner(`/api/inspection-checklists/${v.id}/items`, { method: 'POST', json: { label: 'Rebar in the footing' } })).status).toBe(201)
    expect((await x.lines(v.id)).map((i: any) => i.label)).toEqual(['Anchor bolts', 'Sill plate', 'Rebar in the footing'])
  }, 90_000)

  test('checklists belong to the business: a name can be used once, and another business cannot see them', async () => {
    const x = await boot()
    await x.framing()
    expect((await x.owner('/api/inspection-templates', { method: 'POST', json: { name: 'Framing walk-through', items: ['x'] } })).status).toBe(409)
    expect((await x.owner('/api/inspection-templates', { method: 'POST', json: { name: ' ', items: ['x'] } })).status).toBe(400)
    expect((await x.owner('/api/inspection-templates', { method: 'POST', json: { name: 'Empty', items: [] } })).status).toBe(400)
    const y = await boot()
    expect((await json(await y.owner('/api/inspection-templates'))).data).toEqual([])
  }, 90_000)
})

describe('a failed line puts a snag on the punch list', () => {
  test('failing a line adds one punch-list item, worded from the line and its note, once however often it is marked', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [hangers] = await x.lines(v.id)
    const r = await x.answer(v.id, hangers.id, { result: 'fail', note: 'Two missing at grid C' })
    expect(r.status).toBe(200)
    const body = await json(r)
    expect(body.punchItem).toMatchObject({ projectId: x.house.id, priority: 'high', status: 'open' })
    expect(body.punchItem.description).toContain('Hangers at every joist')
    expect(body.punchItem.description).toContain(v.number)
    expect(body.punchItem.notes).toBe('Two missing at grid C')

    await x.answer(v.id, hangers.id, { result: 'fail', note: 'Two missing at grid C, one at D' })    // marked again
    const snags = await x.snags()
    expect(snags.length).toBe(1)
    expect(snags[0].notes).toBe('Two missing at grid C, one at D')
  }, 90_000)

  test('failing a line needs a few words on what is wrong', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [first] = await x.lines(v.id)
    const r = await x.answer(v.id, first.id, { result: 'fail' })
    expect(r.status).toBe(400)
    expect((await json(r)).code).toBe('checklist_fail_needs_note')
    expect((await x.snags()).length).toBe(0)
  }, 90_000)

  test('changing the answer takes the snag back off — unless somebody has already started on it', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [a, b] = await x.lines(v.id)
    await x.answer(v.id, a.id, { result: 'fail', note: 'wrong spacing' })
    await x.answer(v.id, b.id, { result: 'fail', note: 'gap above ceiling' })
    expect((await x.snags()).length).toBe(2)

    await x.answer(v.id, a.id, { result: 'pass' })                    // a mistake, put right
    expect((await x.snags()).map((s: any) => s.description).join()).not.toContain('Hangers at every joist')

    const snagB = (await x.snags())[0]
    await x.owner(`/api/punch-lists/${snagB.id}/complete`, { method: 'POST' })   // the crew has fixed it
    const r = await json(await x.answer(v.id, b.id, { result: 'pass' }))
    expect(r.note).toContain('already been worked on')
    expect((await x.snags()).length).toBe(1)
  }, 90_000)

  test('with Punch Lists switched off the line still fails, and the answer says no punch-list item was made', async () => {
    const x = await boot('contractor', ['contacts', 'projects', 'inspections', 'inspection_checklists'])
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [a] = await x.lines(v.id)
    const r = await json(await x.answer(v.id, a.id, { result: 'fail', note: 'missing hangers' }))
    expect(r.item.result).toBe('fail')
    expect(r.punchItem).toBeNull()
    expect(r.note).toContain('Punch Lists is not switched on')
  }, 90_000)
})

describe('passing and failing the visit', () => {
  test('a visit with a failed or an unanswered line cannot pass; answered and clear, it can', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [a, b, c] = await x.lines(v.id)
    const open = await x.owner(`/api/inspections/${v.id}/pass`, { method: 'POST' })
    expect(open.status).toBe(400); expect((await json(open)).code).toBe('inspection_checklist_incomplete')

    await x.answer(v.id, a.id, { result: 'pass' }); await x.answer(v.id, b.id, { result: 'fail', note: 'gap' }); await x.answer(v.id, c.id, { result: 'na' })
    const bad = await x.owner(`/api/inspections/${v.id}/pass`, { method: 'POST' })
    expect(bad.status).toBe(400); expect((await json(bad)).code).toBe('inspection_has_failed_lines')

    await x.answer(v.id, b.id, { result: 'pass' })
    expect((await x.owner(`/api/inspections/${v.id}/pass`, { method: 'POST' })).status).toBe(200)
  }, 90_000)

  test('failing the visit with no typed list uses the failed lines as the list; the re-inspection checks just those', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [a, b, c] = await x.lines(v.id)
    await x.answer(v.id, a.id, { result: 'fail', note: 'two missing at C' }); await x.answer(v.id, b.id, { result: 'pass' }); await x.answer(v.id, c.id, { result: 'fail', note: 'none at east wall' })
    const failed = await x.owner(`/api/inspections/${v.id}/fail`, { method: 'POST', json: {} })
    expect(failed.status).toBe(200)
    const rec = await json(failed)
    expect(rec.deficiencies).toContain('Hangers at every joist — two missing at C')
    expect(rec.deficiencies).toContain('Hold-downs at the shear walls — none at east wall')
    expect(rec.deficiencies).not.toContain('Firestopping')

    const again = await json(await x.owner(`/api/inspections/${v.id}/reinspect`, { method: 'POST', json: {} }))
    const re = await x.lines(again.inspection.id)
    expect(re.map((i: any) => [i.label, i.result])).toEqual([['Hangers at every joist', 'pending'], ['Hold-downs at the shear walls', 'pending']])
  }, 90_000)

  test('once the visit has a result its checklist is final', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const ls = await x.lines(v.id)
    for (const l of ls) await x.answer(v.id, l.id, { result: 'pass' })
    expect((await x.owner(`/api/inspections/${v.id}/pass`, { method: 'POST' })).status).toBe(200)
    const r = await x.answer(v.id, ls[0].id, { result: 'fail', note: 'changed my mind' })
    expect(r.status).toBe(400); expect((await json(r)).code).toBe('inspection_already_resulted')
    expect((await x.owner(`/api/inspection-checklists/${v.id}/items`, { method: 'POST', json: { label: 'late' } })).status).toBe(400)
  }, 90_000)

  test('the list says how far each checklist is', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [a, b] = await x.lines(v.id)
    await x.answer(v.id, a.id, { result: 'pass' }); await x.answer(v.id, b.id, { result: 'fail', note: 'gap' })
    const row = (await json(await x.owner('/api/inspections'))).data.find((r: any) => r.id === v.id)
    expect(row.checklist).toEqual({ total: 3, answered: 2, failed: 1 })
  }, 90_000)
})

describe('photos on a visit', () => {
  test('a photo is added, served back, and removed — through the same record-photo rules as a daily log', async () => {
    const x = await boot()
    const v = await x.visit()
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#996633' } }).jpeg().toBuffer()
    const form = new FormData(); form.append('photo', new File([jpeg], 'framing.jpg', { type: 'image/jpeg' })); form.append('caption', 'East wall')
    const up = await x.owner(`/api/inspection-checklists/${v.id}/photos`, { method: 'POST', body: form } as any)
    expect(up.status).toBe(201)
    const rec = await json(up)
    expect(rec.photos.length).toBe(1)
    expect(rec.photos[0]).toMatchObject({ caption: 'East wall' })
    const file = await x.owner(rec.photos[0].url)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('image/jpeg')

    const detail = await json(await x.owner(`/api/inspection-checklists/${v.id}`))
    expect(detail.photos.length).toBe(1)
    const gone = await x.owner(`/api/inspection-checklists/${v.id}/photos/${rec.photos[0].id}`, { method: 'DELETE' })
    expect(gone.status).toBe(200)
    expect((await json(await x.owner(`/api/inspection-checklists/${v.id}`))).photos).toEqual([])
  }, 90_000)
})

describe('who may do what, and what is off by default', () => {
  test('a read-only seat reads the checklist and is refused every change; a field seat, who holds only inspections:read today, is refused too', async () => {
    const x = await boot()
    const tpl = await x.framing(); const v = await x.visit(); await x.start(v.id, tpl.id)
    const [a] = await x.lines(v.id)
    const viewer = await x.seat('viewer')
    expect((await viewer(`/api/inspection-checklists/${v.id}`)).status).toBe(200)
    expect((await viewer('/api/inspection-templates')).status).toBe(200)
    expect((await x.answer(v.id, a.id, { result: 'pass' }, viewer)).status).toBe(403)
    expect((await viewer(`/api/inspection-checklists/${v.id}/items`, { method: 'POST', json: { label: 'x' } })).status).toBe(403)
    expect((await viewer('/api/inspection-templates', { method: 'POST', json: { name: 'N', items: ['x'] } })).status).toBe(403)
    expect((await viewer(`/api/inspection-templates/${tpl.id}`, { method: 'DELETE' })).status).toBe(403)

    const field = await x.seat('field')
    expect((await field(`/api/inspection-checklists/${v.id}`)).status).toBe(200)
    expect((await x.answer(v.id, a.id, { result: 'fail', note: 'missing hangers' }, field)).status).toBe(403)
    expect((await field(`/api/inspection-templates/${tpl.id}`, { method: 'DELETE' })).status).toBe(403)
    expect((await x.snags()).length).toBe(0)
    // a manager (inspections:*) answers, and the snag appears
    const manager = await x.seat('manager')
    expect((await x.answer(v.id, a.id, { result: 'fail', note: 'missing hangers' }, manager)).status).toBe(200)
    expect((await x.snags()).length).toBe(1)
  }, 120_000)

  test('without the feature there is no checklist route, and the inspection list is exactly as before', async () => {
    const x = await boot('contractor', ['contacts', 'projects', 'inspections', 'punch_lists'])
    const v = await x.visit()
    expect((await x.owner(`/api/inspection-checklists/${v.id}`)).status).toBe(403)
    expect((await x.owner('/api/inspection-templates')).status).toBe(403)
    const row = (await json(await x.owner('/api/inspections'))).data[0]
    expect(row.checklist).toBeUndefined()
    expect((await x.owner(`/api/inspections/${v.id}/pass`, { method: 'POST' })).status).toBe(200)       // no checklist rules apply
  }, 90_000)

  test('a failing a visit still needs words when there is no checklist (unchanged)', async () => {
    const x = await boot('contractor', ['contacts', 'projects', 'inspections'])
    const v = await x.visit()
    const r = await x.owner(`/api/inspections/${v.id}/fail`, { method: 'POST', json: {} })
    expect(r.status).toBe(400); expect((await json(r)).code).toBe('deficiencies_required')
  }, 90_000)

  test('the feature is registered not ready: never advertised, named for the contractor template only', () => {
    const f = FEATURE_REGISTRY.find((r: any) => r.id === 'inspection_checklists') as any
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm'])
    expect(getAdvertisableFeaturesForTemplate('crm').map((r: any) => r.id)).not.toContain('inspection_checklists')
  })
})
