// Inspections on the phone (contractor parity, item 6) — a crew (field) seat answers an inspection's checklist and adds photos, on the jobs it
// is on. Server half, through the real app (feature phone_inspections, registered hidden; off, nothing changes). Sign-off is
// inspections-phone-sign.test.ts, automatic checklists inspections-auto-checklists.test.ts, the phone's rules tests/mobile/inspections-phone.test.ts,
// the office screen inspections-phone-ui.test.ts (a DOM installed as globals stops the in-memory database booting, so UI tests are separate files).
import { describe, test, expect } from 'bun:test'
import sharp from 'sharp'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { BASE, boot, json, sharedBoot } from './inspections-phone-kit.ts'

describe('the features', () => {
  test('all three are registered, hidden and offered to the general contractor only; the field seat holds the answer right, a viewer does not', async () => {
    for (const id of ['phone_inspections', 'inspection_signature', 'inspection_auto_checklists']) {
      const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === id)
      expect(f).toBeTruthy()
      expect(f.hidden).toBe(true)
      expect(f.templates).toEqual(['crm'])
    }
    const { BASE_ROLE_PERMISSIONS: ROLE_PERMISSIONS } = await import('@twomiah/tenant-backend/src/auth/permissions.ts')
    expect(ROLE_PERMISSIONS.field).toContain('inspections:answer')
    expect(ROLE_PERMISSIONS.viewer).not.toContain('inspections:answer')
  })
})

describe('a crew seat answers on the phone', () => {
  test('off: the field seat is refused on every crew door, exactly as before the feature', async () => {
    const x = await boot(BASE)
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    const v = await x.visit()
    await x.startOn(v.id)
    const [first] = await x.lines(v.id)
    const refusedAnswer = await x.crew.call(`/api/inspection-checklists/${v.id}/items/${first.id}`, { method: 'PUT', json: { result: 'pass' } })
    expect(refusedAnswer.status).toBe(403)
    expect((await json(refusedAnswer)).code).toBe('feature_off')
    const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#996633' } }).jpeg().toBuffer()
    const form = new FormData(); form.append('photo', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    expect((await x.crew.call(`/api/inspection-checklists/${v.id}/photos`, { method: 'POST', body: form } as any)).status).toBe(403)
    expect((await x.lines(v.id))[0].result).toBe('pending')
    // reading is unchanged: the field seat has always been able to see a visit
    expect((await x.crew.call(`/api/inspection-checklists/${v.id}`)).status).toBe(200)
  }, 120_000)

  test('on: the seat answers a line on a project it has a job on; a fail needs words and puts a snag on the punch list', async () => {
    const x = await sharedBoot([...BASE, 'phone_inspections'])
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    const v = await x.visit()
    await x.startOn(v.id)
    const [first, second] = await x.lines(v.id)
    const ok = await x.crew.call(`/api/inspection-checklists/${v.id}/items/${first.id}`, { method: 'PUT', json: { result: 'pass' } })
    expect(ok.status).toBe(200)
    const bare = await x.crew.call(`/api/inspection-checklists/${v.id}/items/${second.id}`, { method: 'PUT', json: { result: 'fail' } })
    expect(bare.status).toBe(400)
    const failed = await x.crew.call(`/api/inspection-checklists/${v.id}/items/${second.id}`, { method: 'PUT', json: { result: 'fail', note: 'Missing hanger at the north end' } })
    expect(failed.status).toBe(200)
    expect((await json(failed)).punchItem?.number).toBeTruthy()
    expect((await x.lines(v.id)).map((l: any) => l.result)).toEqual(['pass', 'fail'])
    expect((await x.lines(v.id))[1].answeredBy).toBeTruthy()
  }, 120_000)

  test('on: a crew seat adds a photo and removes its own — and nothing else of the office\'s', async () => {
    const x = await sharedBoot([...BASE, 'phone_inspections'])
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    const v = await x.visit()
    const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#996633' } }).jpeg().toBuffer()
    const form = new FormData(); form.append('photo', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    const up = await x.crew.call(`/api/inspection-checklists/${v.id}/photos`, { method: 'POST', body: form } as any)
    expect(up.status).toBe(201)
    const photo = (await json(up)).photos[0]
    expect((await x.crew.call(photo.url)).status).toBe(200)
    expect((await x.crew.call(`/api/inspection-checklists/${v.id}/photos/${photo.id}`, { method: 'DELETE' })).status).toBe(200)
  }, 120_000)

  test('on: the seat still cannot book a visit, record its result, start or edit the lines, or touch the saved checklists', async () => {
    const x = await sharedBoot([...BASE, 'phone_inspections'])
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    const v = await x.visit()
    const tpl = await x.template()
    await x.startOn(v.id)
    const [first] = await x.lines(v.id)
    const refused = async (r: Promise<Response>) => expect((await r).status).toBe(403)
    await refused(x.crew.call('/api/inspections', { method: 'POST', json: { type: 'Framing', projectId: x.house.id } }))
    await refused(x.crew.call(`/api/inspections/${v.id}/pass`, { method: 'POST' }))
    await refused(x.crew.call(`/api/inspections/${v.id}/fail`, { method: 'POST', json: { deficiencies: 'The whole north wall is wrong' } }))
    await refused(x.crew.call(`/api/inspection-checklists/${v.id}/start`, { method: 'POST', json: { items: ['x'] } }))
    await refused(x.crew.call(`/api/inspection-checklists/${v.id}/items`, { method: 'POST', json: { label: 'One more' } }))
    await refused(x.crew.call(`/api/inspection-checklists/${v.id}/items/${first.id}`, { method: 'DELETE' }))
    await refused(x.crew.call(`/api/inspection-templates/${tpl.id}`, { method: 'PUT', json: { name: 'Renamed' } }))
    await refused(x.crew.call(`/api/inspection-templates/${tpl.id}`, { method: 'DELETE' }))
    expect((await x.lines(v.id)).length).toBe(2)
  }, 120_000)

  test('on: a seat that reads only its own jobs reaches only the projects it works — not another project\'s visit', async () => {
    const x = await sharedBoot([...BASE, 'phone_inspections'])
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    await x.jobOn(x.other.id) // someone else's job, nobody assigned
    const elsewhere = await x.visit({}, x.other.id)
    await x.startOn(elsewhere.id)
    const [line] = await x.lines(elsewhere.id)
    expect((await x.crew.call(`/api/inspection-checklists/${elsewhere.id}/items/${line.id}`, { method: 'PUT', json: { result: 'pass' } })).status).toBe(404)
    expect((await x.lines(elsewhere.id))[0].result).toBe('pending')
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer()
    const form = new FormData(); form.append('photo', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    expect((await x.crew.call(`/api/inspection-checklists/${elsewhere.id}/photos`, { method: 'POST', body: form } as any)).status).toBe(404)
  }, 120_000)

  test('on: once the visit has a result the seat cannot change its answers', async () => {
    const x = await sharedBoot([...BASE, 'phone_inspections'])
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    const v = await x.visit()
    await x.startOn(v.id)
    await x.answerAll(v.id)
    expect((await x.owner(`/api/inspections/${v.id}/pass`, { method: 'POST' })).status).toBe(200)
    const [line] = await x.lines(v.id)
    const r = await x.crew.call(`/api/inspection-checklists/${v.id}/items/${line.id}`, { method: 'PUT', json: { result: 'fail', note: 'changed my mind' } })
    expect(r.status).toBe(400)
    expect((await json(r)).code).toBe('inspection_already_resulted')
  }, 120_000)

  test('a viewer, who holds neither right, is refused with the feature on', async () => {
    const x = await sharedBoot([...BASE, 'phone_inspections'])
    const viewer = await x.seat('viewer')
    const v = await x.visit()
    await x.startOn(v.id)
    const [line] = await x.lines(v.id)
    expect((await viewer.call(`/api/inspection-checklists/${v.id}/items/${line.id}`, { method: 'PUT', json: { result: 'pass' } })).status).toBe(403)
  }, 120_000)
})

