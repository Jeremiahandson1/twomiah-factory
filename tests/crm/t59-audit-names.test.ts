// Two contractor audit lows from the owner pass after T59. (T59)
//
//   "Delete rows in the audit log still don't name what was deleted."
//   "Portal on/off rows now name the contact, but both read '—', so you can't tell on from off."
//
// The first is a RULE in the floor (middleware/auditWrites.ts): a DELETE answers 204 with no body and
// the row is gone afterwards, so the floor reads the record's name BEFORE the handler runs. Checked on
// three tables, not just the two the owner saw. The second is the portal module writing a description
// and the switch itself. Both are checked against what the audit SCREEN prints — whatChanged() from
// packages/tenant-ui — not just against the stored row.
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
const { auditWrites } = await import('./src/middleware/auditWrites.ts')
const { whatChanged } = await import(`${process.env.FACTORY_ROOT}packages/tenant-ui/src/audit/auditFields.ts`)

const [co] = await db.insert(company).values({
  name: 'Names Co', slug: 'names-t59', email: 'n59@test.local', state: 'OH', settings: {},
  enabledFeatures: ['contacts', 'jobs', 'projects', 'quotes', 'invoices', 'change_orders', 'client_portal'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-n59@test.local', passwordHash: 'x', firstName: 'Pat', lastName: 'Ellery',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

const app = new Hono()
app.use('*', auditWrites)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/projects', (await import('./src/routes/projects.ts')).default)
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowFor = async (action: string, entityId: string) =>
  (await db.select().from(auditLog).where(and(eq(auditLog.companyId, co.id), eq(auditLog.action, action), eq(auditLog.entityId, entityId)))) as any[]

console.log('\n══════════ a delete names what was deleted ══════════')
{
  const p = await api('POST', '/api/projects', { name: 'Harbor Kitchen Remodel' })
  check('a project is made', p.status === 201 || p.status === 200, { status: p.status, body: p.text?.slice(0, 260) })
  const projectId = p.json?.id
  const co1 = await api('POST', '/api/change-orders', { projectId, title: 'Extra outlets', amount: 250 })
  check('a change order is made', co1.status === 201 || co1.status === 200, { status: co1.status, body: co1.text?.slice(0, 260) })
  const coNumber = co1.json?.number
  const ct = await api('POST', '/api/contacts', { name: 'Dana Delete', type: 'client', email: 'dana-n59@test.local' })

  const d1 = await api('DELETE', `/api/change-orders/${co1.json?.id}`)
  check('the change order is deleted', d1.status >= 200 && d1.status < 300, { status: d1.status, body: d1.text?.slice(0, 200) })
  const [r1] = await rowFor('delete', co1.json?.id)
  check('…and its delete row NAMES it, by number', !!coNumber && r1?.entityName === coNumber, { entityName: r1?.entityName, number: coNumber })

  const d2 = await api('DELETE', `/api/projects/${projectId}`)
  check('the project is deleted', d2.status >= 200 && d2.status < 300, { status: d2.status, body: d2.text?.slice(0, 200) })
  const [r2] = await rowFor('delete', projectId)
  check('…and its delete row names it', !!r2?.entityName && (r2.entityName === p.json?.number || r2.entityName === 'Harbor Kitchen Remodel'), { entityName: r2?.entityName, number: p.json?.number })

  const d3 = await api('DELETE', `/api/contacts/${ct.json?.id}`)
  check('a contact is deleted', d3.status >= 200 && d3.status < 300, { status: d3.status })
  const [r3] = await rowFor('delete', ct.json?.id)
  check('…and its delete row names the person', r3?.entityName === 'Dana Delete', { entityName: r3?.entityName })

  const d4 = await api('DELETE', '/api/projects/zzzzzzzzzzzzzzzzzzzz9999')
  check('deleting something that is not there still answers as before', d4.status === 404 || (d4.status >= 200 && d4.status < 300), { status: d4.status })
}

console.log('\n══════════ portal on and off read differently ══════════')
{
  const ct = await api('POST', '/api/contacts', { name: 'Porter Portal', type: 'client', email: 'porter-n59@test.local' })
  const id = ct.json?.id
  const on = await api('POST', `/api/portal/contacts/${id}/enable`)
  check('the portal is switched on', on.status === 200, { status: on.status, body: on.text?.slice(0, 200) })
  const off = await api('POST', `/api/portal/contacts/${id}/disable`)
  check('…and off', off.status === 200, { status: off.status, body: off.text?.slice(0, 200) })
  const rows = (await rowFor('status_change', id)).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
  check('two rows, both naming the contact', rows.length === 2 && rows.every((r) => r.entityName === 'Porter Portal'), rows.map((r) => [r.entityName, r.metadata]))
  const shown = rows.map((r) => whatChanged(r))
  check('the screen reads "Client Portal switched on" for the first', shown[0] === 'Client Portal switched on', shown)
  check('…and "Client Portal switched off" for the second', shown[1] === 'Client Portal switched off', shown)
  check('neither reads "—"', !shown.includes('—'), shown)
  check('the switch itself is recorded as before → after', (rows[0]?.changes as any)?.portalEnabled?.new === true && (rows[1]?.changes as any)?.portalEnabled?.old === true && (rows[1]?.changes as any)?.portalEnabled?.new === false, rows.map((r) => r.changes))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
