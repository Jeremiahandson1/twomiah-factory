// A DELETE always leaves a trace naming what went — unless its handler wrote its own. (T59)
//
// Outside crm, most delete handlers wrote no audit row at all (crm-basic 7 of 7). The shared floor
// (packages/tenant-backend/src/audit/deleteFloor.ts), mounted after requestScope in index.ts, writes one
// for any successful DELETE whose handler did not log, naming the record from the row it reads BEFORE
// the handler removes it. This checks the three cases on this template's real routes:
//   · an unaudited delete (a KB article) → exactly one row, named by its title
//   · a delete whose handler audits itself (a Lead Inbox lead) → still exactly one row, no duplicate
//   · a refused delete → no row
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
const { company, user, auditLog, supportKnowledgeBase, lead } = await import('./db/schema.ts')
const { requestScope } = await import('./src/services/audit.ts')
const { deleteAudit } = await import('./src/middleware/deleteAudit.ts')

const [co] = await db.insert(company).values({
  name: 'Floor Co', slug: 'floor-t59', email: 'f59@test.local', settings: {},
  enabledFeatures: ['contacts', 'lead_inbox', 'support'],
} as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-f59@test.local', passwordHash: 'x', firstName: 'O', lastName: 'F', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const [viewer] = await db.insert(user).values({ email: 'viewer-f59@test.local', passwordHash: 'x', firstName: 'V', lastName: 'F', role: 'viewer', companyId: co.id, isActive: true } as any).returning()

// The same order index.ts mounts them in: requestScope first, then the floor, then the routes.
const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.use('*', deleteAudit)
app.route('/api/support', (await import('./src/routes/support.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))

const as = (who: any) => async (method: string, path: string) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
  return { status: res.status, text: await res.text() }
}
const settle = () => new Promise((r) => setTimeout(r, 150))
const rowsFor = async (entityId: string) => (await db.select().from(auditLog).where(and(eq(auditLog.companyId, co.id), eq(auditLog.entityId, entityId)))) as any[]

console.log('\n══════════ an unaudited delete gets one named row ══════════')
{
  const [kb] = await db.insert(supportKnowledgeBase).values({ title: 'How to rebook a client', content: 'Steps…', companyId: co.id } as any).returning()
  const d = await as(owner)('DELETE', `/api/support/kb/${kb.id}`)
  check('the article is deleted', d.status >= 200 && d.status < 300, { status: d.status, body: d.text.slice(0, 200) })
  await settle()
  const rows = await rowsFor(kb.id)
  check('EXACTLY ONE audit row for it (there was none)', rows.length === 1, rows.map((r) => [r.action, r.entity, r.entityName]))
  check('…a delete', rows[0]?.action === 'delete', { action: rows[0]?.action })
  check('…naming the article by its title, read before it was removed', rows[0]?.entityName === 'How to rebook a client', { entityName: rows[0]?.entityName })
  check('…filed under its table, not the URL abbreviation', rows[0]?.entity === 'support_knowledge_base', { entity: rows[0]?.entity })
  check('…and saying so in words', (rows[0]?.metadata as any)?.description === 'Deleted — support knowledge base', rows[0]?.metadata)
}

console.log('\n══════════ a refused delete writes nothing ══════════')
{
  const [kb] = await db.insert(supportKnowledgeBase).values({ title: 'Viewer cannot delete this', content: '…', companyId: co.id } as any).returning()
  const d = await as(viewer)('DELETE', `/api/support/kb/${kb.id}`)
  check('a viewer is refused', d.status === 403 || d.status === 401, { status: d.status, body: d.text.slice(0, 200) })
  await settle()
  check('…and no audit row is written for a delete that did not happen', (await rowsFor(kb.id)).length === 0)
}

console.log('\n══════════ a delete the handler audits gets no second row ══════════')
{
  const [l] = await db.insert(lead).values({ sourcePlatform: 'website', homeownerName: 'Lena Lead', status: 'new', companyId: co.id } as any).returning()
  const d = await as(owner)('DELETE', `/api/leads/${l.id}`)
  check('the lead is deleted', d.status >= 200 && d.status < 300, { status: d.status, body: d.text.slice(0, 200) })
  await settle()
  const rows = await rowsFor(l.id)
  check('EXACTLY ONE audit row — the handler\'s own, or the floor\'s where the handler writes none', rows.length === 1, rows.map((r) => [r.action, r.entity, r.entityName, (r.metadata as any)?.via]))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
