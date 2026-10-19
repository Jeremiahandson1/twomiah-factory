// Home care's portals group on the unified app (server/crm/homecare/portals): the client and family portals, staff
// messages, the communication log, notifications and texting. Through the real server, signed in with real tokens.
// tests/unified/homecare/{portal,portal-visit-changes,r4-owner-and-portals,popup-forms}.test.ts (the adapted copies of
// the template's suite files) hold the portals' behaviour; this holds what the move itself changed:
//   · /api/portal and /api/sms are the CRM's paths too: home care's routers answer first and the CRM's still answer
//     theirs (its customer portal's /p/:token, its texting module);
//   · requireAdmin became care-portal permissions: a caregiver of either seat ('caregiver' or 'field') is refused the
//     office's doors and keeps their own inbox, preferences, bell and messages; a manager reaches the office's doors;
//   · one company's records: a client, a person, a portal session of another company is never reached;
//   · the defects fixed in the move (each named below);
//   · replies are camelCase, a list is { data, pagination }.
import { describe, test, expect, beforeAll } from 'bun:test'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', otherCompanyId = ''
const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const bearer = (token: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  for (const [role, email] of [['admin', 'admin@hc.example'], ['manager', 'mgr@hc.example'], ['caregiver', 'cg@hc.example'], ['field', 'fld@hc.example']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({
      email, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: email.split('@')[0], lastName: 'Tester', role, companyId,
      phone: '7155550100',
    } as any).returning()
    ids[email.split('@')[0]] = u.id
  }
  for (const who of ['admin', 'mgr', 'cg', 'fld']) tokens[who] = await signIn(`${who}@hc.example`, PASSWORD)

  const [ada] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Ada', lastName: 'Client', email: 'ada@client.example', isActive: true } as any).returning()
  const [eve] = await t.db.insert(t.schema.clients).values({ companyId, firstName: 'Eve', lastName: 'Client', isActive: true } as any).returning()
  ids.ada = ada.id
  ids.eve = eve.id
  // The 'caregiver' seat serves Ada (an active assignment), not Eve.
  await t.db.insert(t.schema.clientAssignments).values({ companyId, clientId: ada.id, caregiverId: ids.cg, assignmentDate: '2026-01-01', status: 'active' } as any)
  await t.db.insert(t.schema.familyMembers).values({ companyId, clientId: ada.id, name: 'Fran Family', email: 'fran@family.example', passwordHash: 'x', isActive: true } as any)

  // Another company in the same database, with a person and a client of its own.
  const [other] = await t.db.insert(t.schema.company).values({ name: 'Other Agency', slug: 'other-agency' }).returning()
  otherCompanyId = other.id
  const [ou] = await t.db.insert(t.schema.user).values({ email: 'ou@other.example', passwordHash: 'x', firstName: 'Olga', lastName: 'Other', role: 'admin', companyId: other.id } as any).returning()
  const [ocl] = await t.db.insert(t.schema.clients).values({ companyId: other.id, firstName: 'Oscar', lastName: 'Other', email: 'oscar@other.example', isActive: true } as any).returning()
  ids.otherUser = ou.id
  ids.otherClient = ocl.id
})

describe("/api/portal and /api/sms: home care's routers in front of the CRM's", () => {
  test("home care's client portal sign-in answers on /api/portal", async () => {
    const r = await t.call('/api/portal/login', { method: 'POST', json: {} })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('Email and password are required')
  })

  test("the CRM's customer portal still answers its own link path", async () => {
    const r = await t.call('/api/portal/p/not-a-real-token')
    // The CRM's portal refuses an unknown link itself (not "Route not found").
    expect([401, 403, 404]).toContain(r.status)
    expect(String((await r.json()).error)).not.toMatch(/Route not found/)
  })

  test("home care's /contacts/:clientId switches answer first (a client, not a CRM contact)", async () => {
    const r = await as('admin', `/api/portal/contacts/${ids.ada}/status`)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ enabled: false, hasToken: false })
  })

  test("home care's texting templates answer on /api/sms, and the CRM's texting routes still do", async () => {
    const tpl = await as('admin', '/api/sms/templates')
    expect(tpl.status).toBe(200)
    expect(await tpl.json()).toEqual({ data: [], pagination: { page: 1, limit: 0, total: 0, pages: 0 } })
    const crm = await as('admin', '/api/sms/unread-count')
    expect(crm.status).toBe(200)
    expect(typeof (await crm.json()).count).toBe('number')
  })

  test("deleting a texting template removes it from the list (the template's router had no delete; it fell through)", async () => {
    const made = await (await as('admin', '/api/sms/templates', { method: 'POST', json: { name: 'Running late', body: 'Your caregiver is running late.' } })).json()
    expect(made.id).toBeTruthy()
    const del = await as('admin', `/api/sms/templates/${made.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const after = await (await as('admin', '/api/sms/templates')).json()
    expect(after.data.map((r: any) => r.id)).not.toContain(made.id)
    // Another company's template is never reached, and a caregiver can't delete.
    expect((await as('admin', `/api/sms/templates/${crypto.randomUUID()}`, { method: 'DELETE' })).status).toBe(404)
    expect((await as('fld', `/api/sms/templates/${made.id}`, { method: 'DELETE' })).status).toBe(403)
  })
})

describe('permissions, not rank (care-portal)', () => {
  const OFFICE_DOORS = [
    '/api/portal/admin/clients',
    '/api/family-portal/admin/members',
    '/api/family-portal/admin/messages',
    '/api/family-portal/admin/portal-threads',
    '/api/communication/log',
    '/api/communication/threads',
    '/api/communication-log/follow-ups/pending',
    '/api/notifications/summary',
    '/api/sms/templates',
  ]

  test('a caregiver of either seat is refused every office door', async () => {
    for (const who of ['cg', 'fld']) {
      for (const path of OFFICE_DOORS) {
        const r = await as(who, path)
        expect({ who, path, status: r.status }).toEqual({ who, path, status: 403 })
      }
    }
  })

  test('a manager (care-portal:*) and an admin reach them', async () => {
    for (const who of ['mgr', 'admin']) {
      for (const path of OFFICE_DOORS) {
        const r = await as(who, path)
        expect({ who, path, status: r.status }).toEqual({ who, path, status: 200 })
      }
    }
  })

  test("a caregiver of either seat keeps their own inbox, bell, preferences and messages", async () => {
    for (const who of ['cg', 'fld']) {
      for (const path of ['/api/notifications', '/api/push/unread-count', '/api/notification-settings', '/api/messages/inbox', '/api/messages/unread-count']) {
        const r = await as(who, path)
        expect({ who, path, status: r.status }).toEqual({ who, path, status: 200 })
      }
    }
  })

  test('a caregiver cannot send an office notice or a bulk text', async () => {
    const n = await as('fld', '/api/notifications/send', { method: 'POST', json: { recipientId: ids.admin, subject: 'x', message: 'y' } })
    expect(n.status).toBe(403)
    const s = await as('fld', '/api/sms/send-bulk', { method: 'POST', json: { recipientType: 'caregiver', recipientIds: [ids.cg], body: 'x' } })
    expect(s.status).toBe(403)
  })
})

describe("one company's records", () => {
  test("the office's all-clients portal view lists its own clients only", async () => {
    const r = await as('admin', '/api/portal/admin/clients')
    const body = await r.json()
    expect(body.pagination).toBeDefined()
    const listed = body.data.map((c: any) => c.id)
    expect(listed).toEqual(expect.arrayContaining([ids.ada, ids.eve]))
    expect(listed).not.toContain(ids.otherClient)
    // camelCase keys (RULEBOOK §2): portalStatus, accountCount.
    expect(body.data[0]).toHaveProperty('portalStatus')
    expect(body.data[0]).toHaveProperty('accountCount')
  })

  test("another company's client cannot be invited, notified, previewed or have relatives added", async () => {
    expect((await as('admin', '/api/portal/admin/invite', { method: 'POST', json: { clientId: ids.otherClient, email: 'x@y.example' } })).status).toBe(404)
    expect((await as('admin', '/api/portal/admin/notify', { method: 'POST', json: { clientId: ids.otherClient, type: 'general', title: 'Hi' } })).status).toBe(404)
    expect((await as('admin', `/api/portal/admin/preview/${ids.otherClient}`, { method: 'POST' })).status).toBe(404)
    expect((await as('admin', '/api/family-portal/admin/members', { method: 'POST', json: { clientId: ids.otherClient, name: 'X', email: 'x2@y.example', password: 'password-1' } })).status).toBe(404)
  })

  test("a notification or a message never reaches another company's person", async () => {
    expect((await as('admin', '/api/notifications/send', { method: 'POST', json: { recipientId: ids.otherUser, subject: 'x', message: 'y' } })).status).toBe(404)
    expect((await as('admin', '/api/notifications/send-bulk', { method: 'POST', json: { recipientIds: [ids.cg, ids.otherUser], subject: 'x', message: 'y' } })).status).toBe(404)
    expect((await as('admin', '/api/messages/send', { method: 'POST', json: { subject: 'x', body: 'y', recipientIds: [ids.otherUser] } })).status).toBe(400)
    const picker = await (await as('admin', '/api/messages/users')).json()
    expect(picker.data.map((u: any) => u.id)).not.toContain(ids.otherUser)
  })

  test("a portal session for one company's client never opens another company's", async () => {
    // A token naming Ada but another company (forged or crossed) is refused.
    const crossed = jwt.sign({ role: 'client', clientId: ids.ada, companyId: otherCompanyId }, process.env.JWT_SECRET!)
    expect((await bearer(crossed, '/api/portal/me')).status).toBe(403)
    // Ada's own direct-link session opens Ada's portal, camelCase.
    await t.db.update(t.schema.clients).set({ portalEnabled: true } as any).where(eq(t.schema.clients.id, ids.ada))
    const own = jwt.sign({ role: 'client', clientId: ids.ada, companyId }, process.env.JWT_SECRET!)
    const me = await bearer(own, '/api/portal/me')
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ id: ids.ada, firstName: 'Ada', lastName: 'Client', preview: false })
  })
})

describe('defects fixed in the move', () => {
  test("a client's relatives' contact details: only for staff who may see that client (was every signed-in person, every client)", async () => {
    // The 'caregiver' seat serves Ada, not Eve.
    expect((await as('cg', `/api/family-portal/client/${ids.ada}/members`)).status).toBe(200)
    expect((await as('cg', `/api/family-portal/client/${ids.eve}/members`)).status).toBe(403)
    const office = await as('admin', `/api/family-portal/client/${ids.ada}/members`)
    expect((await office.json()).data.map((m: any) => m.name)).toEqual(['Fran Family'])
    // …and never another company's client.
    expect((await as('admin', `/api/family-portal/client/${ids.otherClient}/members`)).status).toBe(403)
  })

  test('a communication log entry writes the named fields only, the author from the session (POST /log spread the body)', async () => {
    const r = await as('admin', '/api/communication/log', { method: 'POST', json: {
      entityType: 'client', entityId: ids.ada, body: 'Called the daughter', id: 'chosen-id', loggedById: ids.otherUser, companyId: otherCompanyId, followUpDate: '',
    } })
    expect(r.status).toBe(201)
    const row = await r.json()
    expect(row.id).not.toBe('chosen-id')
    expect(row.loggedById).toBe(ids.admin)
    expect(row.companyId).toBe(companyId)
    expect(row.followUpDate).toBeNull()
    // The author's name is looked up (the template wrote "undefined undefined" under the app's sign-in).
    expect(row.loggedByName).toBe('admin Tester')
  })

  test("an office reply in a client's portal thread names the person who wrote it", async () => {
    await t.db.update(t.schema.clients).set({ portalEnabled: true } as any).where(eq(t.schema.clients.id, ids.ada))
    const own = jwt.sign({ role: 'client', clientId: ids.ada, companyId }, process.env.JWT_SECRET!)
    const made = await (await bearer(own, '/api/portal/messages', { method: 'POST', json: { subject: 'Tuesday', body: 'Is Tuesday on?' } })).json()
    const rep = await as('mgr', `/api/family-portal/admin/portal-threads/${made.thread.id}/reply`, { method: 'POST', json: { body: 'Yes.' } })
    expect(rep.status).toBe(201)
    expect((await rep.json()).senderName).toBe('mgr Tester')
  })

  test("a bulk text reaches a caregiver of either seat ('caregiver' on a moved tenant, 'field' on a new one)", async () => {
    const env = { ...process.env }
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test', TWILIO_PHONE_NUMBER: '+15005550006' })
    const { createHomecareCore } = await import('../server/crm/homecare/core/index.ts')
    const core = createHomecareCore({ services: t.services.crm } as any)
    const sent: string[] = []
    core.notify._setSmsSender(async (to: string) => { sent.push(to); return { status: 'sent', sid: 'SMtest', error: null } })
    try {
      const r = await as('admin', '/api/sms/send-bulk', { method: 'POST', json: { recipientType: 'caregiver', recipientIds: [ids.cg, ids.fld, ids.admin, ids.otherUser], body: 'Office closed Friday.' } })
      expect(r.status).toBe(200)
      // cg and fld; the admin is not a caregiver and Olga is another company's.
      expect(await r.json()).toEqual({ sent: 2, skipped: 0, failed: 0, unknown: 2 })
    } finally {
      process.env = env
    }
  })
})

describe('reply shapes', () => {
  test('lists are { data, pagination }; a removed notification is { success, message }', async () => {
    const sent = await (await as('admin', '/api/notifications/send', { method: 'POST', json: { recipientId: ids.fld, subject: 'Shift', message: 'Tomorrow' } })).json()
    const inbox = await (await as('fld', '/api/notifications?status=new')).json()
    expect(inbox.pagination).toBeDefined()
    expect(inbox.data.map((n: any) => n.id)).toContain(sent.id)
    const del = await as('fld', `/api/notifications/${sent.id}`, { method: 'DELETE' })
    expect(await del.json()).toEqual({ success: true, message: 'Notification deleted' })
  })
})
