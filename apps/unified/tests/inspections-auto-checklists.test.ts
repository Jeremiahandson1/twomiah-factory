// Inspections on the phone (contractor parity, item 6) — a new visit gets its checklist by itself (feature inspection_auto_checklists,
// registered hidden; off, a checklist is exactly what it was). A checklist marked "attach automatically" fits a visit when the visit's type
// is its type (or it takes any) and, when it names kinds of job, the project has a job (not cancelled) of one of them. Server half,
// through the real app. Tests that share a tenant use their own inspection types, so one test's checklists never fit another's visits.
import { describe, test, expect } from 'bun:test'
import { BASE, boot, json, sharedBoot } from './inspections-phone-kit.ts'

const AUTO = [...BASE, 'inspection_auto_checklists']

describe('switched off', () => {
  test('marking a checklist "attach automatically" is not kept, and a new visit has no lines', async () => {
    const x = await boot(BASE)
    await x.jobOn(x.house.id, { jobType: 'Framing crew' })
    const tpl = await x.template({ autoAttach: true, jobTypes: ['Framing crew'] })
    expect(tpl.autoAttach).toBeUndefined()
    expect(tpl.jobTypes).toBeUndefined()
    const v = await x.visit()
    expect(v.checklistAttached).toBeUndefined()
    expect((await x.lines(v.id)).length).toBe(0)
    const [row] = await x.t.db.select().from(x.t.schema.inspectionTemplate)
    expect(row.autoAttach).toBe(false)
    // even a checklist that is marked in the database (a switch turned off afterwards) is left alone
    const earlier = await x.ins(x.t.schema.inspectionTemplate, { companyId: x.companyId, name: 'Marked earlier', type: 'Slab', autoAttach: true })
    await x.ins(x.t.schema.inspectionTemplateItem, { companyId: x.companyId, templateId: earlier.id, label: 'Rebar chairs', sortOrder: 0 })
    const marked = await x.visit({ type: 'Slab' })
    expect(marked.checklistAttached).toBeUndefined()
    expect((await x.lines(marked.id)).length).toBe(0)
  }, 120_000)

  test('with Inspection Checklists off, nothing is attached even to a checklist that is marked', async () => {
    const x = await boot(['contacts', 'projects', 'jobs', 'inspections', 'inspection_auto_checklists'])
    await x.ins(x.t.schema.inspectionTemplate, { companyId: x.companyId, name: 'Seeded', type: 'Framing', autoAttach: true })
    const v = await x.visit()
    expect(v.checklistAttached).toBeUndefined()
  }, 120_000)
})

describe('switched on', () => {
  test('a visit of the right type on a project with a job of the right kind arrives with the checklist, unanswered, and says which', async () => {
    const x = await sharedBoot(AUTO)
    await x.jobOn(x.house.id, { jobType: 'Framing crew' })
    const tpl = await x.template({ name: 'Framing walk-through', type: 'Framing', autoAttach: true, jobTypes: ['framing crew'] })
    expect(tpl.autoAttach).toBe(true)
    expect(tpl.jobTypes).toEqual(['framing crew'])
    const v = await x.visit({ type: 'Framing' })
    expect(v.checklistAttached).toEqual(['Framing walk-through'])
    expect((await x.lines(v.id)).map((l: any) => [l.label, l.result])).toEqual([['Hangers at every joist', 'pending'], ['Firestopping complete', 'pending'], ['Hold-downs at the shear walls', 'pending']])
    // the visit has its own copy
    await x.owner(`/api/inspection-templates/${tpl.id}`, { method: 'PUT', json: { items: ['Something else'] } })
    expect((await x.lines(v.id)).length).toBe(3)
  }, 120_000)

  test('not attached when the project has no job of the kind, when the only such job is cancelled, or when the type is another; the type is read without caring about case', async () => {
    const x = await sharedBoot(AUTO)
    const wrongKind = await x.project('Wrong kind'), cancelled = await x.project('Cancelled'), right = await x.project('Right')
    await x.jobOn(wrongKind.id, { jobType: 'Roofing' })
    await x.jobOn(cancelled.id, { jobType: 'Deck crew', status: 'cancelled' })
    await x.jobOn(right.id, { jobType: 'Deck crew' })
    await x.template({ name: 'Deck check', type: 'Deck', items: ['Ledger flashed', 'Guard height'], autoAttach: true, jobTypes: ['Deck crew'] })
    expect((await x.lines((await x.visit({ type: 'Deck' }, wrongKind.id)).id)).length).toBe(0)
    expect((await x.lines((await x.visit({ type: 'Deck' }, cancelled.id)).id)).length).toBe(0)
    expect((await x.lines((await x.visit({ type: 'Stairs' }, right.id)).id)).length).toBe(0)
    expect((await x.lines((await x.visit({ type: 'deck' }, right.id)).id)).map((l: any) => l.label)).toEqual(['Ledger flashed', 'Guard height'])
  }, 180_000)

  test('a checklist that is not marked automatic is left for hand-starting; one with no kinds of job fits any project of its type', async () => {
    const x = await sharedBoot(AUTO)
    await x.template({ name: 'Slab, by hand', type: 'Slab', items: ['Rebar chairs'] })
    expect((await x.lines((await x.visit({ type: 'Slab' })).id)).length).toBe(0)
    await x.template({ name: 'Final, any project', type: 'Final', items: ['Site is clean'], autoAttach: true })
    const fresh = await x.project('Anywhere')
    const v = await x.visit({ type: 'Final' }, fresh.id)
    expect((await x.lines(v.id)).map((l: any) => l.label)).toEqual(['Site is clean'])
  }, 120_000)

  test('several that fit are put on together in name order, a line in more than one once', async () => {
    const x = await sharedBoot(AUTO)
    // made out of order on purpose: the order on the visit is by name, not by when they were made
    for (const [name, items] of [['D list', ['Site is clean', 'Last']], ['B list', ['Permit posted', 'Second']], ['E list', ['Fifth']], ['A list', ['Permit posted', 'First']], ['C list', ['Third', 'Site is clean']]] as const) {
      await x.template({ name, type: 'Punch', items: [...items], autoAttach: true })
    }
    const v = await x.visit({ type: 'Punch' })
    expect(v.checklistAttached).toEqual(['A list', 'B list', 'C list', 'D list', 'E list'])
    expect((await x.lines(v.id)).map((l: any) => l.label)).toEqual(['Permit posted', 'First', 'Second', 'Third', 'Site is clean', 'Last', 'Fifth'])
  }, 120_000)

  test('the settings can be changed later; kinds are kept once each', async () => {
    const x = await sharedBoot(AUTO)
    const tpl = await x.template({ name: 'Later', type: 'Later' })
    expect(tpl.autoAttach).toBe(false)
    const updated = await json(await x.owner(`/api/inspection-templates/${tpl.id}`, { method: 'PUT', json: { autoAttach: true, jobTypes: ['Framing crew', 'Framing crew', 'Deck'] } }))
    expect([updated.autoAttach, updated.jobTypes]).toEqual([true, ['Framing crew', 'Deck']])
    const listed = (await json(await x.owner('/api/inspection-templates'))).data.find((t: any) => t.id === tpl.id)
    expect(listed.autoAttach).toBe(true)
    expect((await x.owner(`/api/inspection-templates/${tpl.id}`, { method: 'PUT', json: { jobTypes: 'Deck' } })).status).toBe(400)
  }, 120_000)

  test('a checklist with no type fits a visit of any type', async () => {
    const x = await boot(AUTO)
    await x.template({ name: 'Every visit', type: null, items: ['Photos taken'], autoAttach: true })
    const v = await x.visit({ type: 'Anything at all' })
    expect(v.checklistAttached).toEqual(['Every visit'])
  }, 120_000)
})
