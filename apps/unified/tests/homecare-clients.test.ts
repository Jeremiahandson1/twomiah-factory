// Home care's clients-and-care group on the unified app (server/crm/homecare/clients): who may do what, the company's
// records only, the shapes the screens read, and the defects the move fixed.
//   · Permissions: the template's admin-only paths need a care-clients write permission (care-schedule / care-billing
//     where the action is the schedule's or a rate's), which a caregiver — stored as caregiver or as field — does not
//     hold; the office manager holds the care work but not billing writes. A caregiver reads the clients they serve.
//   · One company's clients, plans, documents and libraries never reach another's.
//   · Care plan revisions are written by the app with the change (the template's database trigger is not in the unified
//     migrations), in the company, with their author.
//   · Fixed: client documents were open to every signed-in person and the certificate view carried the client's SSN,
//     portal password hash and token; service codes took the request body into the row (its company, its id); a
//     prospect's convert wrote the client's id into a column that references contacts; a care-type edit with nothing
//     to change was a 500; coverage could be assigned to nobody.
//   · Reply shapes: lists are { data, pagination }; keys are camelCase.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
let coA = '', coB = ''
const as = (who: string, method: string, path: string, json?: unknown) =>
  t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}` } })
const body = async (r: Response) => { const s = await r.text(); try { return JSON.parse(s) } catch { return s } }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const S = t.schema
  const [a] = await t.db.insert(S.company).values({ name: 'Agency A', slug: 'agency-a', state: 'WI', timezone: 'UTC' }).returning()
  const [b] = await t.db.insert(S.company).values({ name: 'Agency B', slug: 'agency-b', state: 'WI', timezone: 'UTC' }).returning()
  coA = a.id; coB = b.id
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  const people: [string, string, string][] = [
    ['ownerA', 'owner', coA], ['adminA', 'admin', coA], ['managerA', 'manager', coA],
    ['cg1', 'caregiver', coA], ['cg2', 'field', coA], ['adminB', 'admin', coB],
  ]
  let n = 0
  for (const [who, role, companyId] of people) {
    const [u] = await t.db.insert(S.user).values({ email: `${who.toLowerCase()}@clients.example`, passwordHash: hash, firstName: who, lastName: 'Care', role, companyId }).returning()
    ids[who] = u.id
    const res = await t.call('/api/auth/login', { method: 'POST', json: { email: `${who.toLowerCase()}@clients.example`, password: 'Seat-pass-1' }, headers: { 'X-Forwarded-For': `203.0.113.${++n}` } })
    tokens[who] = (await res.json()).accessToken
  }
  const mk = async (companyId: string, firstName: string, extra: Record<string, unknown> = {}) =>
    (await t.db.insert(S.clients).values({ companyId, firstName, lastName: 'Client', ...extra } as any).returning())[0].id
  ids.jane = await mk(coA, 'Jane', { medicaidId: '1234567890', ssnEncrypted: 'enc:secret', portalPasswordHash: 'hash:secret', portalToken: 'token-secret', portalEnabled: true, email: 'jane@clients.example' })
  ids.bob = await mk(coA, 'Bob')
  ids.zed = await mk(coB, 'Zed')
  // cg1 cares for Jane (an active assignment); cg2 for nobody.
  await t.db.insert(S.clientAssignments).values({ companyId: coA, clientId: ids.jane, caregiverId: ids.cg1, assignmentDate: '2026-01-01', status: 'active' } as any)
})

describe('permissions: the office runs the care; a caregiver keeps to the clients they serve', () => {
  const OFFICE: [string, string, unknown?][] = [
    ['POST', '/api/clients', { firstName: 'N', lastName: 'C' }],
    ['PUT', '/api/clients/x', { notes: 'x' }],
    ['DELETE', '/api/clients/x'],
    ['GET', '/api/clients/evv-week'],
    ['PATCH', '/api/clients/x/evv-units', { units: 4 }],
    ['POST', '/api/clients/bulk-assign-medicaid-ids', { rows: [] }],
    ['POST', '/api/clients/x/assignments', { caregiverId: 'y' }],
    ['GET', '/api/care-plans/summary'],
    ['POST', '/api/care-plans', { clientId: 'x', serviceType: 'personal_care' }],
    ['GET', '/api/care-plan-templates'],
    ['POST', '/api/care-tasks/client/x', { taskName: 'T' }],
    ['GET', '/api/care-tasks/assessment-formats'],
    ['POST', '/api/medications', { clientId: 'x', name: 'M' }],
    ['POST', '/api/adl/requirements', { clientId: 'x', adlCategory: 'bathing', assistanceLevel: 'minimal' }],
    ['POST', '/api/forms/templates', { name: 'F' }],
    ['GET', '/api/documents'],
    ['GET', '/api/insurance-cards/x'],
    ['POST', '/api/client-documents', { clientId: 'x', templateId: 'y' }],
    ['GET', '/api/emergency/miss-reports'],
    ['POST', '/api/emergency/assign-coverage', { caregiverId: 'y' }],
    ['POST', '/api/service-codes', { code: 'T1019', description: 'PC' }],
    ['POST', '/api/care-types', { name: 'T' }],
    ['POST', '/api/referral-sources', { name: 'R' }],
    ['GET', '/api/prospects'],
    ['GET', '/api/prospect-appointments'],
  ]
  test('a caregiver (stored as caregiver or as field) is refused every office path', async () => {
    for (const who of ['cg1', 'cg2']) {
      for (const [m, p, j] of OFFICE) {
        const r = await as(who, m, p, j)
        expect({ who, m, p, status: r.status }).toEqual({ who, m, p, status: 403 })
      }
    }
  })

  test('the office manager runs the care but sets no rates or billing codes', async () => {
    expect((await as('managerA', 'GET', '/api/clients')).status).toBe(200)
    expect((await as('managerA', 'GET', '/api/care-plans/summary')).status).toBe(200)
    expect((await as('managerA', 'GET', `/api/clients/${ids.bob}`)).status).toBe(200)
    expect((await as('managerA', 'POST', '/api/care-types', { name: 'Rate' })).status).toBe(403)
    expect((await as('managerA', 'POST', '/api/service-codes', { code: 'T1019', description: 'PC' })).status).toBe(403)
  })

  test('a caregiver reads only the clients they serve, in the phone\'s columns', async () => {
    const r = await body(await as('cg1', 'GET', '/api/clients'))
    expect(r.pagination).toBeDefined()
    expect(r.data.map((c: any) => c.id)).toEqual([ids.jane])
    expect(r.data[0].firstName).toBe('Jane')
    expect('medicaidId' in r.data[0]).toBe(false)
    expect((await as('cg1', 'GET', `/api/clients/${ids.bob}`)).status).toBe(404)
    expect((await as('cg1', 'GET', `/api/clients/${ids.jane}/caregiver-view`)).status).toBe(200)
    expect((await as('cg1', 'GET', `/api/clients/${ids.bob}/caregiver-view`)).status).toBe(403)
    expect((await as('cg1', 'GET', `/api/clients/${ids.jane}/onboarding`)).status).toBe(403)
    expect((await body(await as('cg2', 'GET', '/api/clients'))).data).toEqual([])
    expect((await as('cg2', 'POST', '/api/medications/vitals', { clientId: ids.jane, pulse: 72 })).status).toBe(403)
  })
})

describe('one company\'s records', () => {
  test('another company\'s client is not there for the office', async () => {
    expect((await as('adminA', 'GET', `/api/clients/${ids.zed}`)).status).toBe(404)
    expect((await as('adminA', 'PUT', `/api/clients/${ids.zed}`, { notes: 'x' })).status).toBe(404)
    expect((await as('adminA', 'POST', '/api/care-plans', { clientId: ids.zed, serviceType: 'personal_care' })).status).toBe(404)
    expect((await as('adminA', 'POST', `/api/clients/${ids.zed}/emergency-contacts`, { name: 'X', phone: '1' })).status).toBe(404)
    expect((await as('adminA', 'POST', '/api/adl/requirements', { clientId: ids.zed, adlCategory: 'bathing', assistanceLevel: 'minimal' })).status).toBe(404)
    expect((await as('adminA', 'GET', `/api/care-tasks/client/${ids.zed}`)).status).toBe(403)
    const list = await body(await as('adminA', 'GET', '/api/clients'))
    expect(list.data.map((c: any) => c.id).sort()).toEqual([ids.jane, ids.bob].sort())
  })

  test('each company gets its own starter libraries, once', async () => {
    const a1 = (await body(await as('adminA', 'GET', '/api/care-plan-templates'))).data
    const a2 = (await body(await as('adminA', 'GET', '/api/care-plan-templates'))).data
    const b1 = (await body(await as('adminB', 'GET', '/api/care-plan-templates'))).data
    expect(a1.filter((x: any) => x.isBuiltIn)).toHaveLength(6)
    expect(a2.map((x: any) => x.id).sort()).toEqual(a1.map((x: any) => x.id).sort())
    expect(b1.filter((x: any) => x.isBuiltIn)).toHaveLength(6)
    expect(b1.some((x: any) => a1.some((y: any) => y.id === x.id))).toBe(false)
    const fa = (await body(await as('adminA', 'GET', '/api/forms/templates'))).data
    expect(fa.filter((x: any) => x.isBuiltIn)).toHaveLength(9)
    expect(fa.every((x: any) => x.companyId === coA)).toBe(true)
    const ta = (await body(await as('cg1', 'GET', '/api/care-types'))).data
    expect(ta).toHaveLength(6)
  })
})

describe('care plan revisions are written with the change', () => {
  test('a content change keeps the old row, numbered, with its author and company; a no-op keeps nothing', async () => {
    const plan = await body(await as('adminA', 'POST', '/api/care-plans', { clientId: ids.jane, serviceType: 'personal_care', frequency: 'weekly' }))
    await as('adminA', 'PUT', `/api/care-plans/${plan.id}`, { frequency: 'daily' })
    await as('adminA', 'PUT', `/api/care-plans/${plan.id}`, { frequency: 'daily' })
    await as('ownerA', 'PUT', `/api/care-plans/${plan.id}`, { careGoals: 'Walk' })
    const revs = await body(await as('adminA', 'GET', `/api/care-plans/${plan.id}/revisions`))
    expect(revs.data.map((r: any) => r.revisionNumber)).toEqual([2, 1])
    expect(revs.data[1]).toMatchObject({ frequency: 'weekly', changedById: ids.adminA, changedByFirst: 'adminA', companyId: coA })
    expect(revs.data[0]).toMatchObject({ frequency: 'daily', careGoals: null, changedById: ids.ownerA })
  })
})

describe('defects fixed in the move', () => {
  test("ADL and medication log filters cut days on the agency's clock, not UTC's", async () => {
    const { eq } = await import('drizzle-orm')
    const S = t.schema
    await t.db.update(S.company).set({ timezone: 'America/Chicago' }).where(eq(S.company.id, coA))
    try {
      // 8:30 PM Central on the 16th is 01:30 UTC on the 17th: the 16th's log, and not the 17th's.
      await t.db.insert(S.adlLogs).values({ companyId: coA, clientId: ids.jane, adlCategory: 'bathing', status: 'completed', performedAt: new Date('2026-10-17T01:30:00Z') } as any)
      const on16 = (await body(await as('adminA', 'GET', `/api/adl/client/${ids.jane}/logs?startDate=2026-10-16&endDate=2026-10-16`))).data
      const on17 = (await body(await as('adminA', 'GET', `/api/adl/client/${ids.jane}/logs?startDate=2026-10-17&endDate=2026-10-17`))).data
      expect(on16.length).toBe(1)
      expect(on17.length).toBe(0)
    } finally {
      await t.db.update(S.company).set({ timezone: 'UTC' }).where(eq(S.company.id, coA))
    }
  })

  test('an emergency contact saved without a phone is kept, not a 500', async () => {
    const r = await as('adminA', 'POST', `/api/clients/${ids.bob}/emergency-contacts`, { name: 'Sam Neighbour', relationship: 'neighbour' })
    expect(r.status).toBe(201)
    expect((await body(r)).phone).toBe('')
  })

  test('client documents: a caregiver reads only their clients\', and the certificate view never carries the client\'s secrets', async () => {
    const tpls = (await body(await as('adminA', 'GET', '/api/client-documents/templates'))).data
    expect(tpls.length).toBe(4)
    const forJane = await body(await as('adminA', 'POST', '/api/client-documents', { clientId: ids.jane, templateId: tpls[0].id }))
    const forBob = await body(await as('adminA', 'POST', '/api/client-documents', { clientId: ids.bob, templateId: tpls[1].id }))
    expect(forJane.id && forBob.id).toBeTruthy()
    const mine = (await body(await as('cg1', 'GET', '/api/client-documents'))).data
    expect(mine.map((x: any) => x.id)).toEqual([forJane.id])
    expect((await as('cg1', 'GET', `/api/client-documents/${forBob.id}`)).status).toBe(403)
    const cert = await body(await as('adminA', 'GET', `/api/client-documents/${forJane.id}`))
    expect(cert.client.firstName).toBe('Jane')
    for (const k of ['ssnEncrypted', 'portalPasswordHash', 'portalToken', 'insuranceCardFront', 'insuranceCardBack']) expect(k in cert.client).toBe(false)
    expect(JSON.stringify(cert)).not.toContain('secret')
    expect((await as('adminB', 'GET', `/api/client-documents/${forJane.id}`)).status).toBe(404)
  })

  test('service codes take only the code\'s own fields; a missing code is a 404', async () => {
    const r = await as('adminA', 'POST', '/api/service-codes', { id: 'forged-id', companyId: coB, code: 'T1019', description: 'Personal care' })
    expect(r.status).toBe(201)
    const row = await body(r)
    expect(row.id).not.toBe('forged-id')
    expect(row.companyId).toBe(coA)
    const moved = await body(await as('adminA', 'PUT', `/api/service-codes/${row.id}`, { companyId: coB, description: 'PC' }))
    expect(moved).toMatchObject({ companyId: coA, description: 'PC' })
    expect((await as('adminA', 'PUT', '/api/service-codes/nope', { description: 'x' })).status).toBe(404)
    expect((await body(await as('adminB', 'GET', '/api/service-codes'))).data).toEqual([])
  })

  test('a care-type edit with nothing to change answers the row, not a 500', async () => {
    const [ct] = (await body(await as('adminA', 'GET', '/api/care-types'))).data
    const r = await as('adminA', 'PUT', `/api/care-types/${ct.id}`, {})
    expect(r.status).toBe(200)
    expect((await body(r)).id).toBe(ct.id)
  })

  test('a prospect is the signed-in company\'s, and converting one makes the client', async () => {
    const p = await body(await as('adminA', 'POST', '/api/prospects', { name: 'Pat Prospect', phone: '555' }))
    expect(p.companyId).toBe(coA)
    const conv = await as('adminA', 'POST', `/api/prospects/${p.id}/convert`)
    expect(conv.status).toBe(200)
    const out = await body(conv)
    expect(out.lead.status).toBe('converted')
    expect(out.client).toMatchObject({ firstName: 'Pat', lastName: 'Prospect', companyId: coA })
    expect((await as('adminA', 'POST', `/api/prospects/${p.id}/convert`)).status).toBe(400)
    expect((await body(await as('adminB', 'GET', '/api/prospects'))).data).toEqual([])
    const [audit] = await t.db.select().from(t.schema.auditLogs)
      .where(and(eq(t.schema.auditLogs.recordId, p.id), eq(t.schema.auditLogs.action, 'CONVERT')))
    expect((audit?.newData as any)?.clientId).toBe(out.client.id)
  })

  test('coverage is assigned to one of the company\'s caregivers, or refused', async () => {
    expect((await as('adminA', 'POST', '/api/emergency/assign-coverage', { caregiverId: 'nobody' })).status).toBe(404)
    expect((await as('adminA', 'POST', '/api/emergency/assign-coverage', { caregiverId: ids.adminB })).status).toBe(404)
    expect((await as('adminA', 'POST', '/api/emergency/assign-coverage', { caregiverId: ids.cg1 })).status).toBe(200)
  })
})

describe('the store at /api/documents is home care\'s', () => {
  test('home care\'s document store answers, a list reply, with no CRM documents feature switched on', async () => {
    const fd = new FormData()
    fd.append('file', new File(['%PDF-1.4 x'], 'handbook.pdf', { type: 'application/pdf' }))
    fd.append('entityType', 'company')
    fd.append('documentName', 'Handbook')
    fd.append('requiresSignature', 'true')
    const up = await t.call('/api/documents', { method: 'POST', body: fd, headers: { Authorization: `Bearer ${tokens.adminA}` } })
    expect(up.status).toBe(201)
    const list = await body(await as('adminA', 'GET', '/api/documents'))
    expect(list.pagination).toBeDefined()
    expect(list.data.map((x: any) => x.documentName)).toEqual(['Handbook'])
    const todo = await body(await as('cg2', 'GET', `/api/documents/unsigned/${ids.cg2}`))
    expect(todo.data.map((x: any) => x.name)).toEqual(['Handbook'])
    expect((await as('cg2', 'GET', `/api/documents/unsigned/${ids.cg1}`)).status).toBe(403)
    expect((await body(await as('adminB', 'GET', '/api/documents'))).data).toEqual([])
  })
})
