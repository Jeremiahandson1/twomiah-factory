// Every successful write leaves a row in the audit log.
//
//   "Contractor: gaps in the audit log."
//
// Measured before fixing: of 163 write endpoints in this template, 17 wrote an audit row and 146 did
// not. Whole modules imported no audit service at all — draw schedules including approve and
// mark-paid, support tickets, selections, call tracking, and every bulk action: assign jobs,
// reschedule jobs, mark invoices paid, delete quotes, approve time, delete time. An audit log covering
// a tenth of the writes is not a gap, it is a log nobody can rely on, and "did somebody mark these
// invoices paid?" is the question it exists to answer.
//
// Writing 146 audit calls by hand would have left a 147th to be added without one, which is how this
// started. The floor is a middleware, and what this file pins is the floor's behaviour — including
// every case where it must stay QUIET, because a log full of refusals, reads and provider callbacks
// is as unusable as an empty one:
//
//   * a successful write is recorded, with who, what and which record;
//   * a READ is not;
//   * a REFUSED write is not — that is the gate working, not a change;
//   * the request BODY never reaches the log (bodies here carry passwords and provider secrets);
//   * a handler that writes its own richer entry still does, and is not replaced by the generic one;
//   * and the log cannot break the thing it is recording.
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, auditLog } = await import('./db/schema.ts')
const { auditWrites } = await import('./src/middleware/auditWrites.ts')

const [co] = await db.insert(company).values({
  name: 'Audit Co', slug: 'audit-t58', email: 'a58@test.local', state: 'OH', settings: {},
  enabledFeatures: ['contacts', 'jobs', 'projects', 'invoices', 'quotes', 'reports'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-a58@test.local', passwordHash: 'x', firstName: 'Pat', lastName: 'Ellery',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

// The middleware above the routes, exactly as index.ts mounts it: it awaits next() and then reads the
// settled response and the user the route's own authenticate put on the context.
const app = new Hono()
app.use('*', auditWrites)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/bulk', (await import('./src/routes/bulk.ts')).default)
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
// The real error handler, so a refused body is the 400 the app would send and not a bare 500 — and so
// the "is a refusal logged?" checks below are testing a refusal and not a crash.
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const call = (who: string | null) => async (method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (who) { headers['x-test-user'] = who; headers['x-test-company'] = co.id; headers['x-test-role'] = 'owner' }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = call(owner.id)
const anon = call(null)

const rows = async () => db.select().from(auditLog).where(eq(auditLog.companyId, co.id))
const clear = async () => db.delete(auditLog).where(eq(auditLog.companyId, co.id))

// ══════════ a write that succeeds ══════════════════════════════════════════════════════════════════
console.log('\n══════════ a successful write ══════════')
let contactId = ''
{
  await clear()
  const made = await api('POST', '/api/contacts', { name: 'Marit Rivera', type: 'client', email: 'marit-a58@test.local' })
  check('creating a contact works', made.status === 201 || made.status === 200, { status: made.status, body: made.text?.slice(0, 220) })
  contactId = made.json?.id

  const all = await rows()
  check('…and it is in the audit log', (all as any[]).length >= 1, { rows: (all as any[]).length })
  const row: any = (all as any[])[0] || {}
  check('…recorded as a create', String(row.action).includes('create'), { action: row.action })
  check('…against the contact entity', row.entity === 'contact', { entity: row.entity })
  check('…naming who did it', row.userId === owner.id, { userId: row.userId, owner: owner.id })
  check('…and scoped to the company', row.companyId === co.id, { companyId: row.companyId })
}

// ══════════ the id comes off the URL when there is one ═════════════════════════════════════════════
console.log('\n══════════ which record ══════════')
{
  await clear()
  const put = await api('PUT', `/api/contacts/${contactId}`, { name: 'Marit Rivera-Hale' })
  check('editing the contact works', put.status === 200, { status: put.status, body: put.text?.slice(0, 220) })
  const all: any[] = (await rows()) as any[]
  check('…is logged as an update', all.some((r) => String(r.action).includes('update')), all.map((r) => r.action))
  check('…against THAT contact, by id', all.some((r) => r.entityId === contactId),
    { entityIds: all.map((r) => r.entityId), contactId })
}

// ══════════ a bulk action — a whole module that logged nothing ═════════════════════════════════════
console.log('\n══════════ bulk, which had no audit import at all ══════════')
{
  await clear()
  // Empty id list: the point is that the ENDPOINT is recorded, not that it moved rows.
  const bulk = await api('POST', '/api/bulk/jobs/status', { ids: [], status: 'scheduled' })
  const all: any[] = (await rows()) as any[]
  if (bulk.status >= 200 && bulk.status < 300) {
    check('a successful bulk action is logged', all.length >= 1, { status: bulk.status, rows: all.length })
    check('…saying which endpoint it was', all.some((r) => String((r.metadata || {}).path || '').includes('/api/bulk/jobs/status')),
      { metadata: all.map((r) => r.metadata) })
  } else {
    // Refused (an empty list may be a 400) — then it must NOT be logged, which is the next section's
    // rule and is just as good a result here.
    check('a refused bulk action is not logged', all.length === 0, { status: bulk.status, rows: all.length })
  }
}

// ══════════ what must stay OUT of the log ═════════════════════════════════════════════════════════
console.log('\n══════════ reads, refusals and secrets ══════════')
{
  await clear()
  const read = await api('GET', '/api/contacts')
  check('a read succeeds', read.status === 200, { status: read.status })
  check('…and is NOT in the log — a log of reads is unreadable', ((await rows()) as any[]).length === 0,
    { rows: ((await rows()) as any[]).length })
}
{
  await clear()
  const refused = await anon('POST', '/api/contacts', { name: 'Nobody' })
  check('an unauthenticated write is refused', refused.status === 401 || refused.status === 403,
    { status: refused.status })
  check('…and is not logged — that is the gate working, not a change', ((await rows()) as any[]).length === 0,
    { rows: ((await rows()) as any[]).length })
}
{
  await clear()
  const missing = await api('PUT', '/api/contacts/does-not-exist-123456', { name: 'Ghost' })
  check('editing a record that is not there is refused', missing.status === 404 || missing.status === 400,
    { status: missing.status })
  check('…and is not logged', ((await rows()) as any[]).length === 0, { rows: ((await rows()) as any[]).length })
}
{
  await clear()
  // A body with something that must never be copied into a log.
  const made = await api('POST', '/api/contacts', {
    name: 'Secret Carrier', type: 'client', email: 'secret-a58@test.local',
    notes: 'hunter2-SHOULD-NOT-BE-LOGGED',
  })
  check('the write works', made.status === 201 || made.status === 200, { status: made.status })
  const all: any[] = (await rows()) as any[]
  const dump = JSON.stringify(all)
  check('the request BODY is not in the log', !dump.includes('SHOULD-NOT-BE-LOGGED'), { logged: dump.slice(0, 300) })
  check('…though the row is still there', all.length >= 1, { rows: all.length })
}

// ══════════ ONE row per write, not two ═════════════════════════════════════════════════════════════
//
// Owner, after the first version shipped: "each payment and each settings change is logged twice."
// They were. The floor wrote its row beside the handler's own richer one, so the screen showed the
// same event twice — once properly and once as "update · via request".
//
// The handler's entry wins, always: it has the field diff, the amount, the old and new status. The
// floor exists for the writes nobody logged at all, and a floor that files a second copy of work
// already done is noise in the one place that has to stay readable.
console.log('\n══════════ one row per write ══════════')
{
  await clear()
  // contacts.ts writes its own audit entry with a field-level diff.
  await api('PUT', `/api/contacts/${contactId}`, { name: 'Marit R-H', phone: '555-0150' })
  const all: any[] = (await rows()) as any[]
  const rich = all.find((r) => r.changes && Object.keys(r.changes).length > 0)
  const generic = all.filter((r) => (r.metadata || {}).via === 'request')

  check('the handler\'s own entry, with the field diff, is there', !!rich,
    { rows: all.map((r) => ({ action: r.action, changes: r.changes, metadata: r.metadata })) })
  check('…so the diff was not lost', rich && JSON.stringify(rich.changes).includes('name'),
    { changes: rich?.changes })
  check('…and the floor did NOT file a second row beside it', generic.length === 0,
    { generic: generic.map((r) => r.metadata) })
  check('…so the write produced exactly one entry', all.length === 1,
    { count: all.length, rows: all.map((r) => ({ action: r.action, via: (r.metadata || {}).via })) })
}

// ══════════ what the action column says ════════════════════════════════════════════════════════════
//
// Owner: "payments, approvals and disabling the portal are all labelled 'create'." They were — the
// action came off the HTTP verb, and all three are a POST. An action column that says "create" for
// taking a payment is a column you cannot scan.
console.log('\n══════════ the action says what happened ══════════')
{
  const { actionFromPath, entityFromPath } = await import('./src/middleware/auditWrites.ts') as any
  if (typeof actionFromPath !== 'function') {
    check('actionFromPath is exported so it can be checked directly', false, null)
  } else {
    for (const [method, path, expected, why] of [
      ['POST', '/api/invoices/abc123/payments', 'payment', 'taking a payment'],
      ['POST', '/api/change-orders/abc123/approve', 'status_change', 'approving a change order'],
      ['POST', '/api/portal/contacts/abc123/disable', 'status_change', 'switching a portal off'],
      ['POST', '/api/portal/contacts/abc123/enable', 'status_change', 'switching one on'],
      ['POST', '/api/invoices/abc123/refund', 'refund', 'refunding'],
      ['POST', '/api/quotes/abc123/send', 'send', 'sending a quote'],
      ['POST', '/api/contacts', 'create', 'an ordinary create still reads as create'],
      ['PUT', '/api/contacts/abc123', 'update', '…and an ordinary edit as update'],
      ['DELETE', '/api/contacts/abc123', 'delete', '…and a delete as delete'],
    ] as [string, string, string, string][]) {
      const got = actionFromPath(path, method)
      check(`${why} is logged as "${expected}"`, got === expected, { method, path, got, expected })
    }
  }

  // "Warranty" was spelled "Warrantie": the first version stripped a trailing s.
  if (typeof entityFromPath === 'function') {
    for (const [path, expected, why] of [
      ['/api/warranties/abc', 'warranty', 'it was spelled "warrantie"'],
      ['/api/invoices/abc', 'invoice', ''],
      ['/api/addresses/abc', 'address', ''],
      ['/api/change-orders/abc', 'change_order', ''],
      ['/api/status/abc', 'status', 'already singular'],
      /**
       * The record the id belongs to, not the first segment. `PUT /api/company/users/:id` was filed
       * as entity "company" carrying the USER's id, so the two columns described different things
       * and a change to a person read as a change to company settings. Measured on the live
       * contractor after the deploy. (T58 follow-up)
       */
      ['/api/company/users/siyq5i1t7dwjf87irxkz8c2r', 'user', 'the id is the user\'s, not the company\'s'],
      ['/api/invoices/dbb4pjcwv6s9mqa1l6on48o4/payments', 'invoice', 'the id is the invoice\'s; the payment is the ACTION'],
      ['/api/contacts', 'contact', 'no id at all, so the mount itself'],
    ] as [string, string, string][]) {
      check(`${path} is the "${expected}" entity${why ? ` — ${why}` : ''}`, entityFromPath(path) === expected,
        { path, got: entityFromPath(path), expected })
    }
  }
}

// ══════════ the event that moves the contract ══════════════════════════════════════════════════════
//
// Approving a change order adds its amount to the project's value and its days to the end date. This
// module wrote NO audit row of any kind — not create, not edit, not approve, not reject — so the one
// question a contract dispute turns on, "who agreed to this and when", had no answer. The generic
// floor covers it now; this event also gets a real entry, because the amount, the days and what the
// contract became are known only to the handler.
console.log('\n══════════ approving a change order ══════════')
{
  const { project: projectTable } = await import('./db/schema.ts')
  const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Rivera Build', type: 'client' } as any).returning()
  const [proj] = await db.insert(projectTable).values({
    companyId: co.id, contactId: client.id, name: 'Mill Lane', number: 'P-900', status: 'active',
    estimatedValue: '100000.00', endDate: new Date('2026-11-20T00:00:00Z'),
  } as any).returning()

  const made = await api('POST', '/api/change-orders', {
    title: 'Extra steelwork', projectId: proj.id, daysAdded: 3,
    lineItems: [{ description: 'Beams', quantity: 2, unitPrice: 1200 }],
  })
  check('a change order is created', made.status === 201 || made.status === 200, { status: made.status, body: made.text?.slice(0, 260) })
  const coId = made.json?.id

  await api('POST', `/api/change-orders/${coId}/submit`)
  await clear()
  const approved = await api('POST', `/api/change-orders/${coId}/approve`)
  check('approving it works', approved.status === 200 && approved.json?.status === 'approved',
    { status: approved.status, coStatus: approved.json?.status })

  const all: any[] = (await rows()) as any[]
  const rich = all.find((r) => r.entity === 'change_order' && r.changes)
  check('the approval is in the log as a change_order status change', !!rich,
    { rows: all.map((r) => ({ entity: r.entity, action: r.action, changes: r.changes })) })
  check('…recording what it moved FROM and TO',
    rich && JSON.stringify(rich.changes).includes('approved'), { changes: rich?.changes })
  check('…who agreed to it', rich?.userId === owner.id, { userId: rich?.userId })
  check('…the money and the days it added',
    rich && Number((rich.metadata || {}).amount) === 2400 && Number((rich.metadata || {}).daysAdded) === 3,
    { metadata: rich?.metadata })
  check('…and what the contract became, so the log answers it without a second lookup',
    rich && Number((rich.metadata || {}).projectValueAfter) === 102400,
    { projectValueAfter: (rich?.metadata || {}).projectValueAfter })
}

// ══════════ the log cannot break the write ═════════════════════════════════════════════════════════
console.log('\n══════════ an audit log that throws ══════════')
{
  await clear()
  // Make the audit table unwritable, then do a write. The request must still succeed: an audit log
  // that can 500 an invoice is worse than one with gaps.
  await db.execute(sql`ALTER TABLE audit_log RENAME TO audit_log_hidden`)
  try {
    const made = await api('POST', '/api/contacts', { name: 'Still Works', type: 'client', email: 'still-a58@test.local' })
    check('the write still succeeds when the log cannot be written', made.status === 201 || made.status === 200,
      { status: made.status, body: made.text?.slice(0, 220) })
  } finally {
    await db.execute(sql`ALTER TABLE audit_log_hidden RENAME TO audit_log`)
  }
  const after = await api('POST', '/api/contacts', { name: 'And After', type: 'client', email: 'after-a58@test.local' })
  check('…and logging resumes once it can be', after.status === 201 || after.status === 200, { status: after.status })
  check('…with a row for it', ((await rows()) as any[]).length >= 1, { rows: ((await rows()) as any[]).length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
