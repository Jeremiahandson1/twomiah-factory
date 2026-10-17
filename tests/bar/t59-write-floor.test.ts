// Every write leaves a trace naming its record — unless its handler wrote its own. (T59)
//
// Outside crm, most writes wrote no audit row at all. The shared write floor
// (packages/tenant-backend/src/audit/writeFloor.ts), mounted after requestScope in index.ts, writes one
// for any successful POST / PUT / PATCH / DELETE whose handler did not log. Checked on this template's
// real routes, with the KB-article endpoints (which audit nothing of their own):
//   · a create → one `create` row, named from the record sent back, carrying the NEW record's id
//   · an edit → one `update` row, named
//   · a delete → one `delete` row, named from the row read BEFORE it went
//   · a refused write → no row
//   · a write whose handler audits itself (a Lead Inbox delete) → still exactly one row, no duplicate
//   · a location ping → no row (telemetry stays out of the log)
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
const { company, user, auditLog, lead } = await import('./db/schema.ts')
const { requestScope } = await import('./src/services/audit.ts')
const { writeAudit } = await import('./src/middleware/writeAudit.ts')

const [co] = await db.insert(company).values({ name: 'Floor Co', slug: 'floor-t59', email: 'f59@test.local', settings: {}, enabledFeatures: ['contacts', 'lead_inbox', 'support'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-f59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'F', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const [viewer] = await db.insert(user).values({ email: 'viewer-f59@test.local', passwordHash: 'x', firstName: 'V', lastName: 'F', role: 'viewer', companyId: co.id, isActive: true } as any).returning()

// The same order index.ts mounts them in: requestScope first, then the floor, then the routes.
const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.use('*', writeAudit)
app.route('/api/support', (await import('./src/routes/support.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
// A stand-in for a telemetry endpoint: it succeeds, writes nothing of its own, and must not be logged.
app.post('/api/geofencing/location', (c) => { (c as any).set('user', { userId: owner.id, companyId: co.id, role: 'owner' }); return c.json({ ok: true }) })
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const settle = () => new Promise((r) => setTimeout(r, 150))
const rowsFor = async (entityId: string) => (await db.select().from(auditLog).where(and(eq(auditLog.companyId, co.id), eq(auditLog.entityId, entityId)))) as any[]
const allRows = async () => (await db.select().from(auditLog).where(eq(auditLog.companyId, co.id))) as any[]

console.log('\n══════════ create, edit, delete — each one named row ══════════')
let kbId = ''
{
  const made = await as(owner)('POST', '/api/support/kb', { title: 'How to rebook a client', content: 'Steps…' })
  check('an article is created', made.status === 201 || made.status === 200, { status: made.status, body: made.text.slice(0, 200) })
  kbId = made.json?.id
  await settle()
  const c1 = (await rowsFor(kbId)).filter((r) => r.action === 'create')
  check('ONE create row, filed under the NEW record\'s id', c1.length === 1, (await allRows()).map((r) => [r.action, r.entity, r.entityId, r.entityName]))
  check('…named from the record the handler sent back', c1[0]?.entityName === 'How to rebook a client', { entityName: c1[0]?.entityName })
  check('…under its table, in words', c1[0]?.entity === 'support_knowledge_base' && (c1[0]?.metadata as any)?.description === 'Created — support knowledge base', { entity: c1[0]?.entity, metadata: c1[0]?.metadata })

  const ed = await as(owner)('PUT', `/api/support/kb/${kbId}`, { title: 'How to rebook a regular', content: 'Steps…' })
  check('the article is edited', ed.status === 200, { status: ed.status, body: ed.text.slice(0, 200) })
  await settle()
  const u1 = (await rowsFor(kbId)).filter((r) => r.action === 'update')
  check('ONE update row, with the new title', u1.length === 1 && u1[0]?.entityName === 'How to rebook a regular', u1.map((r) => r.entityName))

  const d = await as(owner)('DELETE', `/api/support/kb/${kbId}`)
  check('the article is deleted', d.status >= 200 && d.status < 300, { status: d.status })
  await settle()
  const x1 = (await rowsFor(kbId)).filter((r) => r.action === 'delete')
  check('ONE delete row, named from the row read before it went', x1.length === 1 && x1[0]?.entityName === 'How to rebook a regular', x1.map((r) => r.entityName))
  check('three rows for the article in all — no duplicates', (await rowsFor(kbId)).length === 3, (await rowsFor(kbId)).map((r) => r.action))
}

console.log('\n══════════ what must NOT be logged ══════════')
{
  const before = (await allRows()).length
  const r = await as(viewer)('POST', '/api/support/kb', { title: 'Viewer cannot write this', content: '…' })
  check('a viewer is refused', r.status === 403 || r.status === 401, { status: r.status })
  const ping = await as(owner)('POST', '/api/geofencing/location', { lat: 1, lng: 2 })
  check('a location ping succeeds', ping.status === 200)
  await settle()
  check('…and neither the refusal nor the ping wrote a row', (await allRows()).length === before, (await allRows()).slice(before).map((x) => [x.action, x.entity, (x.metadata as any)?.path]))
}

console.log('\n══════════ a write the handler audits gets no second row ══════════')
{
  const [l] = await db.insert(lead).values({ sourcePlatform: 'website', homeownerName: 'Lena Lead', status: 'new', companyId: co.id } as any).returning()
  const d = await as(owner)('DELETE', `/api/leads/${l.id}`)
  check('the lead is deleted', d.status >= 200 && d.status < 300, { status: d.status })
  await settle()
  const rows = await rowsFor(l.id)
  check('EXACTLY ONE row — the handler\'s own, or the floor\'s where the handler writes none', rows.length === 1, rows.map((r) => [r.action, r.entity, r.entityName, (r.metadata as any)?.via]))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
