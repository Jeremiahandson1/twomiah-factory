// crm-salon — raising a bill is a money event, so it belongs in the audit log.
//
//   "Salon: invoices raised by Log Service are not in the audit log."
//
// Logging a service raises a real invoice, and nothing wrote an audit row for it. The appointment
// UPDATE was logged, so the trail showed a visit closing with no money beside it — and an invoice
// existing with nothing saying where it came from or who raised it. On a money record that is the one
// question the log is kept to answer.
//
// Both ways a visit becomes a sale go through ensureInvoiceForVisit, so the audit row is written there
// rather than in each caller — a third caller would otherwise be written without one, the same reason
// the invoice NUMBER comes from a single counter. This file checks BOTH entry points, plus the third
// money move on that path: a bill coming back from void when a cancelled visit is completed again.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, invoice, auditLog } from './db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 360)) }
}

await setupSchema()
const [co] = await db.insert(company).values({
  name: 'Shear Audit', slug: 'shear-audit-t58', email: 'a58@test.local', settings: {},
  enabledFeatures: ['appointments', 'service_records', 'invoices'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-a58@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner',
  role: 'owner', companyId: co.id,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Vera Visit', email: 'vera58@test.local',
} as any).returning()
const [svc] = await db.insert(serviceMenu).values({
  companyId: co.id, name: 'Cut & Finish', price: '42.50', durationMin: 45,
} as any).returning()

const app = new Hono()
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

/** Every audit row this company has for one invoice. */
const rowsFor = async (invoiceId: string) => db.select().from(auditLog)
  .where(and(eq(auditLog.companyId, co.id), eq(auditLog.entity, 'invoice'), eq(auditLog.entityId, invoiceId)))

// ══════════ Log Service — the path the owner named ═════════════════════════════════════════════════
console.log('\n══════════ logging a service ══════════')
let loggedInvoiceId = ''
{
  const rec = await call('POST', '/api/service-records', { contactId: client.id, serviceId: svc.id, priceCharged: 42.5 })
  check('logging a service works', rec.status === 201, rec.json)
  loggedInvoiceId = rec.json?.invoiceId
  check('…and raises an invoice', !!loggedInvoiceId, rec.json)

  const rows = await rowsFor(loggedInvoiceId)
  // THE FINDING, directly.
  check('the invoice it raised is in the audit log', rows.length > 0, { rows: rows.length })
  const created = rows.find((r: any) => r.action === 'create')
  check('…as a create', !!created, rows.map((r: any) => r.action))
  check('…naming who raised it', (created as any)?.userId === owner.id, { userId: (created as any)?.userId, owner: owner.id })

  const [inv] = await db.select().from(invoice).where(eq(invoice.id, loggedInvoiceId))
  check('…and the invoice number, so the row is findable without the id', (created as any)?.entityName === inv?.number,
    { entityName: (created as any)?.entityName, number: inv?.number })
  // Enough to answer "where did this bill come from", which is the point.
  const meta: any = (created as any)?.metadata || {}
  check('…what it was for', String(meta.service || '').includes('Cut'), meta)
  check('…and what it came to', Number(meta.total) === Number(inv?.total), { metaTotal: meta.total, invoiceTotal: inv?.total })
}

// ══════════ the appointment book's Complete — the sibling that was also missing ════════════════════
console.log('\n══════════ completing an appointment ══════════')
let apptId = '', apptInvoiceId = ''
{
  const start = new Date(Date.now() - 2 * 3600_000)
  const made = await call('POST', '/api/appointments', {
    contactId: client.id, serviceId: svc.id,
    startTime: start.toISOString(), endTime: new Date(start.getTime() + 45 * 60_000).toISOString(),
  })
  check('booking an appointment works', made.status === 201 || made.status === 200, made.json)
  apptId = made.json?.id

  const done = await call('PUT', `/api/appointments/${apptId}`, { status: 'completed' })
  check('completing it works', done.status === 200, done.json)
  apptInvoiceId = done.json?.invoiceId
  check('…and it raised a bill', !!apptInvoiceId, done.json)

  const rows = await rowsFor(apptInvoiceId)
  check('that bill is in the audit log too', rows.some((r: any) => r.action === 'create'), rows.map((r: any) => r.action))
  const created: any = rows.find((r: any) => r.action === 'create')
  check('…naming who completed the visit', created?.userId === owner.id, { userId: created?.userId })
  check('…and the appointment it came from', String((created?.metadata || {}).appointmentId || '') === apptId,
    { metadata: created?.metadata, apptId })

  // The appointment's own row still exists — this must ADD the sale, not replace what was logged.
  const apptRows = await db.select().from(auditLog)
    .where(and(eq(auditLog.companyId, co.id), eq(auditLog.entity, 'appointment'), eq(auditLog.entityId, apptId)))
  check('the appointment is still audited as well', apptRows.length > 0, { rows: apptRows.length })
}

// ══════════ a bill coming back from void ═══════════════════════════════════════════════════════════
console.log('\n══════════ cancel, then complete again ══════════')
{
  const cancelled = await call('PUT', `/api/appointments/${apptId}`, { status: 'cancelled' })
  check('cancelling works', cancelled.status === 200, cancelled.json)
  const [voided] = await db.select().from(invoice).where(eq(invoice.id, apptInvoiceId))
  check('…and voids the bill', voided?.status === 'void', voided?.status)

  const again = await call('PUT', `/api/appointments/${apptId}`, { status: 'completed' })
  check('completing it again works', again.status === 200, again.json)
  const [back] = await db.select().from(invoice).where(eq(invoice.id, apptInvoiceId))
  check('…and the same bill is open again', back?.status === 'open' && back?.id === apptInvoiceId,
    { status: back?.status, id: back?.id })

  const rows = await rowsFor(apptInvoiceId)
  const restore = rows.filter((r: any) => r.action === 'update')
  check('bringing a bill back from void is logged', restore.length > 0, rows.map((r: any) => r.action))
  check('…as a status change away from void',
    restore.some((r: any) => String(JSON.stringify(r.changes || {})).includes('void')), restore.map((r: any) => r.changes))
  // One create for this invoice, however many times the visit is reopened.
  check('…and it did not log a second create for the same bill',
    rows.filter((r: any) => r.action === 'create').length === 1,
    rows.map((r: any) => r.action))
}

// ══════════ every bill on this path has a row ══════════════════════════════════════════════════════
console.log('\n══════════ nothing slips through ══════════')
{
  const all = await db.select().from(invoice).where(eq(invoice.companyId, co.id))
  const unlogged: string[] = []
  for (const inv of all as any[]) {
    const rows = await rowsFor(inv.id)
    if (!rows.some((r: any) => r.action === 'create')) unlogged.push(inv.number)
  }
  check('every invoice this company has was logged when it was raised', unlogged.length === 0, { unlogged })
  check('…and there was more than one, so that is not an empty check', (all as any[]).length >= 2, { invoices: (all as any[]).length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
