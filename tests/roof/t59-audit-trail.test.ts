// crm-roof has an audit trail. (T59) It was the one CRM with no audit table, service, route or screen —
// nothing a roofing company did left a trace. This checks the stack it now shares with every other CRM:
// the write floor records a create, an edit and a delete on a real roofing route, each named; and
// GET /api/audit reads them back for someone with reports:read, and refuses a crew member.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, auditLog } = await import('./db/schema.ts')
const { requestScope } = await import('./src/services/audit.ts')
const { writeAudit } = await import('./src/middleware/writeAudit.ts')

const [co] = await db.insert(company).values({ name: 'Roof Audit Co', slug: 'roofaudit-t59', email: 'ra59@test.local', state: 'WI', settings: {}, enabledFeatures: [] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-ra59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'R', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const [crew] = await db.insert(user).values({ email: 'crew-ra59@test.local', passwordHash: 'x', firstName: 'C', lastName: 'R', role: 'field', companyId: co.id, isActive: true } as any).returning()

// The order index.ts mounts them in.
const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.use('*', writeAudit)
app.route('/api/crews', (await import('./src/routes/crews.ts')).default)
app.route('/api/audit', (await import('./src/routes/audit.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const settle = () => new Promise((r) => setTimeout(r, 150))
const rowsFor = async (id: string) => (await db.select().from(auditLog).where(and(eq(auditLog.companyId, co.id), eq(auditLog.entityId, id)))) as any[]

console.log('\n══════════ a roofing write leaves a trace ══════════')
let crewId = ''
{
  const made = await as(owner)('POST', '/api/crews', { name: 'North Crew', foremanName: 'Ray', foremanPhone: '608-555-0190', size: 4 })
  check('a crew is created', made.status === 201 || made.status === 200, { status: made.status, body: made.text.slice(0, 200) })
  crewId = made.json?.id ?? made.json?.data?.id
  await settle()
  const c1 = (await rowsFor(crewId)).filter((r) => r.action === 'create')
  check('ONE create row, named "North Crew"', c1.length === 1 && c1[0]?.entityName === 'North Crew', (await rowsFor(crewId)).map((r) => [r.action, r.entity, r.entityName]))
  check('…with the actor recorded', c1[0]?.userId === owner.id, { userId: c1[0]?.userId })
  const ed = await as(owner)('PUT', `/api/crews/${crewId}`, { name: 'North Crew A', size: 5 })
  check('the crew is edited', ed.status === 200, { status: ed.status, body: ed.text.slice(0, 200) })
  const del = await as(owner)('DELETE', `/api/crews/${crewId}`)
  check('the crew is deleted', del.status >= 200 && del.status < 300, { status: del.status })
  await settle()
  const all = await rowsFor(crewId)
  check('…an update row and a delete row, both named', all.some((r) => r.action === 'update' && r.entityName === 'North Crew A') && all.some((r) => r.action === 'delete' && r.entityName === 'North Crew A'), all.map((r) => [r.action, r.entityName]))
}

console.log('\n══════════ T60: the verb is what was done, not "create" ══════════')
{
  // "A supplement deny and an Xactimate export are logged in the audit as 'create'."
  const { actionFromPath, describeRequest, entityFromPath } = await import('./src/shared/audit/writeFloor.ts')
  for (const [method, path, action, phrase, entity] of [
    ['POST', '/api/insurance/supplements/k9x2m4p7q1w8e5r3t6y0u2i4/deny', 'status_change', 'Denied', 'supplement'],
    ['POST', '/api/insurance/supplements/k9x2m4p7q1w8e5r3t6y0u2i4/approve', 'status_change', 'Approved', 'supplement'],
    ['POST', '/api/insurance/claims/k9x2m4p7q1w8e5r3t6y0u2i4/xactimate-export', 'export', 'Exported', 'claim'],
    ['POST', '/api/invoices/k9x2m4p7q1w8e5r3t6y0u2i4/mark-paid', 'status_change', 'Marked paid', 'invoice'],
    ['POST', '/api/crews', 'create', 'Created', 'crew'],
  ] as const) {
    const got = actionFromPath(path, method), said = describeRequest(path, method, entityFromPath(path))
    check(`${path.split('/').slice(-1)[0]} is logged as "${action}" — "${phrase} — ${entity}"`, got === action && said === `${phrase} — ${entity}`, { got, said })
  }
}

console.log('\n══════════ reading the trail ══════════')
{
  const r = await as(owner)('GET', '/api/audit?limit=20')
  const list: any[] = r.json?.data || r.json?.logs || []
  check('the owner reads it (audit:read)', r.status === 200 && list.some((x) => (x.entity_id ?? x.entityId) === crewId), { status: r.status, rows: list.length })
  const f = await as(crew)('GET', '/api/audit')
  check('a crew member is refused — field holds no audit:read', f.status === 403, { status: f.status })

  // The owner's decision (2026-10-09): owners and admins only. A manager holds reports:read and used to
  // get in; the log carries everybody's sign-ins, IPs and two-factor changes.
  const [admin] = await db.insert(user).values({ email: 'admin-ra59@test.local', passwordHash: 'x', firstName: 'A', lastName: 'R', role: 'admin', companyId: co.id, isActive: true } as any).returning()
  const [manager] = await db.insert(user).values({ email: 'manager-ra59@test.local', passwordHash: 'x', firstName: 'M', lastName: 'R', role: 'manager', companyId: co.id, isActive: true } as any).returning()
  for (const p of ['/api/audit', '/api/audit/filters', `/api/audit/crew/${crewId}`]) {
    const m = await as(manager)('GET', p)
    check(`a MANAGER is refused ${p} — the audit log is owners and admins only`, m.status === 403, { status: m.status })
  }
  const a = await as(admin)('GET', '/api/audit?limit=20')
  check('…while an admin reads it', a.status === 200, { status: a.status, body: a.text.slice(0, 160) })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
