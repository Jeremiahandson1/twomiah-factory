// Inspections on the phone (contractor parity, item 6) — the customer signs the checklist as it stands (feature inspection_signature, registered
// hidden; off, the route answers that it is not switched on). Server half, through the real app.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { BASE, SIGN, INK, json, sharedBoot } from './inspections-phone-kit.ts'

describe('the customer signs', () => {
  async function ready(features: string[], answered = true) {
    const x = await sharedBoot(features)
    await x.jobOn(x.house.id, { assignedToId: x.crew.id })
    const v = await x.visit()
    await x.startOn(v.id)
    if (answered) await x.answerAll(v.id)
    return { ...x, v, sign: (body: any = SIGN, who = x.crew.call) => who(`/api/inspection-checklists/${v.id}/sign`, { method: 'POST', json: body }) }
  }

  test('off: the sign door answers that it is not switched on, and nothing is stored', async () => {
    const x = await ready([...BASE, 'phone_inspections'])
    const r = await x.sign()
    expect(r.status).toBe(403)
    expect((await json(r)).code).toBe('feature_off')
    const [row] = await x.t.db.select().from(x.t.schema.inspection).where(eq(x.t.schema.inspection.id, x.v.id))
    expect(row.signedAt).toBeNull()
    expect(row.signature).toBeNull()
  }, 120_000)

  test('on: the crew seat takes the signature; the answer says THAT it was signed, by whom and when — and carries no evidence', async () => {
    const x = await ready([...BASE, 'phone_inspections', 'inspection_signature'])
    const r = await x.sign()
    expect(r.status).toBe(200)
    const b = await json(r)
    expect(b.signedBy).toBe('Rosa Ruiz')
    expect(b.signedAt).toBeTruthy()
    for (const k of ['signature', 'signedIp', 'signedUserAgent', 'signatureHash', 'consentAt']) expect(b[k]).toBeUndefined()
    // what is kept
    const [row] = await x.t.db.select().from(x.t.schema.inspection).where(eq(x.t.schema.inspection.id, x.v.id))
    expect(row.signature).toBe(INK)
    expect(row.signatureHash).toMatch(/^[0-9a-f]{64}$/)
    // the fingerprint is of exactly what the customer was shown: this visit, and each line with its answer and note
    const shown = (await x.lines(x.v.id)).map((l: any) => ({ label: l.label, result: l.result, note: l.note }))
    const { createHash } = await import('node:crypto')
    expect(row.signatureHash).toBe(createHash('sha256').update(JSON.stringify({ inspectionId: row.id, number: row.number, type: row.type, items: shown })).digest('hex'))
    expect(row.consentAt).toBeTruthy()
    // the crew seat reading the visit later still does not get the evidence; the office does
    const crewView = await json(await x.crew.call(`/api/inspection-checklists/${x.v.id}`))
    expect(crewView.signedBy).toBe('Rosa Ruiz')
    expect(crewView.signature).toBeUndefined()
    expect(crewView.signatureHash).toBeUndefined()
    const officeView = await json(await x.owner(`/api/inspection-checklists/${x.v.id}`))
    expect(officeView.signature).toBe(INK)
    expect(officeView.signatureHash).toBe(row.signatureHash)
  }, 120_000)

  test('the signature image is never in the list of inspections, for anyone', async () => {
    const x = await ready([...BASE, 'phone_inspections', 'inspection_signature'])
    await x.sign()
    for (const who of [x.owner, x.crew.call]) {
      const rows = (await json(await who('/api/inspections'))).data as any[]
      const mine = rows.find((r) => r.id === x.v.id)
      expect(mine.signedBy).toBe('Rosa Ruiz')
      expect(mine.signature).toBeUndefined()
      expect(mine.signatureHash).toBeUndefined()
    }
  }, 120_000)

  test('it is refused until every line has an answer, and when there is no checklist, no name, no agreement or no picture', async () => {
    const open = await ready([...BASE, 'phone_inspections', 'inspection_signature'], false)
    const early = await open.sign()
    expect(early.status).toBe(400)
    expect((await json(early)).code).toBe('checklist_incomplete')
    const blank = await sharedBoot([...BASE, 'phone_inspections', 'inspection_signature'])
    await blank.jobOn(blank.house.id, { assignedToId: blank.crew.id })
    const empty = await blank.visit()
    const none = await blank.crew.call(`/api/inspection-checklists/${empty.id}/sign`, { method: 'POST', json: SIGN })
    expect((await json(none)).code).toBe('checklist_empty')
    const x = await ready([...BASE, 'phone_inspections', 'inspection_signature'])
    expect((await x.sign({ ...SIGN, consent: false })).status).toBe(400)
    expect((await x.sign({ ...SIGN, signedBy: '  ' })).status).toBe(400)
    expect((await x.sign({ ...SIGN, signature: 'not a picture' })).status).toBe(400)
    const [row] = await x.t.db.select().from(x.t.schema.inspection).where(eq(x.t.schema.inspection.id, x.v.id))
    expect(row.signedAt).toBeNull()
  }, 180_000)

  test('it is signed once, and then the lines are final for everyone — the office included', async () => {
    const x = await ready([...BASE, 'phone_inspections', 'inspection_signature'])
    expect((await x.sign()).status).toBe(200)
    const again = await x.sign({ ...SIGN, signedBy: 'Someone Else' })
    expect(again.status).toBe(409)
    expect((await json(again)).code).toBe('already_signed')
    const [line] = await x.lines(x.v.id)
    for (const who of [x.crew.call, x.owner]) {
      const r = await who(`/api/inspection-checklists/${x.v.id}/items/${line.id}`, { method: 'PUT', json: { result: 'fail', note: 'changed afterwards' } })
      expect(r.status).toBe(400)
      expect((await json(r)).code).toBe('inspection_signed')
    }
    expect((await x.owner(`/api/inspection-checklists/${x.v.id}/items`, { method: 'POST', json: { label: 'One more' } })).status).toBe(400)
    expect((await x.lines(x.v.id)).map((l: any) => l.result)).toEqual(['pass', 'pass'])
    const [row] = await x.t.db.select().from(x.t.schema.inspection).where(eq(x.t.schema.inspection.id, x.v.id))
    expect(row.signedBy).toBe('Rosa Ruiz')
    // recording the result is still the office's, and still works
    expect((await x.owner(`/api/inspections/${x.v.id}/pass`, { method: 'POST' })).status).toBe(200)
  }, 120_000)

  test('what was signed is fingerprinted: different answers give a different hash', async () => {
    const x = await ready([...BASE, 'phone_inspections', 'inspection_signature'])
    await x.sign()
    const second = await x.visit()
    await x.startOn(second.id)
    const [a, b] = await x.lines(second.id)
    await x.owner(`/api/inspection-checklists/${second.id}/items/${a.id}`, { method: 'PUT', json: { result: 'pass' } })
    await x.owner(`/api/inspection-checklists/${second.id}/items/${b.id}`, { method: 'PUT', json: { result: 'na' } })
    await x.crew.call(`/api/inspection-checklists/${second.id}/sign`, { method: 'POST', json: SIGN })
    const rows = await x.t.db.select().from(x.t.schema.inspection)
    const hashes = [x.v.id, second.id].map((id) => rows.find((r: any) => r.id === id)?.signatureHash)
    expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true)
    expect(hashes[0]).not.toBe(hashes[1])
  }, 120_000)

  test('a seat without the right is refused, and the crew seat is held to its own projects', async () => {
    const x = await ready([...BASE, 'phone_inspections', 'inspection_signature'])
    const viewer = await x.seat('viewer')
    expect((await x.sign(SIGN, viewer.call)).status).toBe(403)
    await x.jobOn(x.other.id)
    const elsewhere = await x.visit({}, x.other.id)
    await x.startOn(elsewhere.id)
    await x.answerAll(elsewhere.id)
    expect((await x.crew.call(`/api/inspection-checklists/${elsewhere.id}/sign`, { method: 'POST', json: SIGN })).status).toBe(404)
  }, 120_000)

  test('the crew seat cannot sign once the phone switch is off, even with the signature feature on', async () => {
    const x = await ready([...BASE, 'inspection_signature'])
    const r = await x.sign()
    expect(r.status).toBe(403)
    expect((await json(r)).code).toBe('feature_off')
    // the office can still take it: it never needed the phone switch
    expect((await x.sign(SIGN, x.owner)).status).toBe(200)
  }, 120_000)
})

