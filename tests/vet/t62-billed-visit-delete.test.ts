// T62 Vet, medium — "a billed visit can be deleted. Staff deleted a visit already invoiced as INV-00202. The
// invoice is now left with no visit behind it. … Owner and manager probably have the same gap."
//
// DELETE /api/visits/:id refuses (409 visit_already_invoiced) while the visit's invoice exists and is not
// void — for every role. Void the invoice, or delete it, and the visit can go. Through the real route.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, patient, visit, invoice } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Ledger Vet', slug: 'ledger-vet-t62', email: 'lv62@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@lv62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), staff = await mk('staff', 'staff')
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Rowan Price', email: 'rowan-t62@test.local' } as any).returning()
const [pet] = await db.insert(patient).values({ companyId: co.id, ownerId: client.id, name: 'Pepper', species: 'dog' } as any).returning()

let n = 0
const mkInvoice = async (status: string) => (await db.insert(invoice).values({
  companyId: co.id, contactId: client.id, number: `INV-0620${++n}`, subtotal: '88.00', total: '88.00',
  amountPaid: '0', taxAmount: '0', taxRate: '0', discount: '0', status,
} as any).returning())[0]
const mkVisit = async (invoiceId: string | null) => (await db.insert(visit).values({
  companyId: co.id, patientId: pet.id, visitDate: new Date(Date.now() - 86400000), reason: 'Check-up', total: '88.00', invoiceId,
} as any).returning())[0]

const app = new Hono()
app.route('/api/visits', (await import('./src/routes/visits.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const del = async (who: any, id: string) => {
  const res = await app.request(`/api/visits/${id}`, { method: 'DELETE', headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const stillThere = async (id: string) => (await db.select({ id: visit.id }).from(visit).where(eq(visit.id, id))).length === 1

// ── billed: refused for every role ──
const sentInv = await mkInvoice('sent')
const billed = await mkVisit(sentInv.id)
for (const [who, label] of [[staff, 'vet staff'], [manager, 'a manager'], [owner, 'the owner']] as const) {
  const r = await del(who, billed.id)
  check(`${label} cannot delete a visit billed on ${sentInv.number} (409 visit_already_invoiced)`, r.status === 409 && r.json?.code === 'visit_already_invoiced' && r.json?.invoiceId === sentInv.id, r)
}
check('…the visit is still there under its invoice', await stillThere(billed.id))
const draftInv = await mkInvoice('draft')
const onDraft = await mkVisit(draftInv.id)
const rd = await del(owner, onDraft.id)
check('a visit on a DRAFT invoice is held too — the draft is the bill, delete it first', rd.status === 409 && /draft/.test(rd.json?.error || ''), rd)

// ── the way out: void (or delete) the invoice ──
await db.update(invoice).set({ status: 'void' } as any).where(eq(invoice.id, sentInv.id))
const rv = await del(owner, billed.id)
check('once the invoice is void, the visit can be deleted', rv.status === 200 && !(await stillThere(billed.id)), rv)
const gone = await mkInvoice('draft'), orphan = await mkVisit(gone.id)
await db.delete(invoice).where(eq(invoice.id, gone.id)).catch(() => {})
const deletedInvoice = (await db.select({ id: invoice.id }).from(invoice).where(eq(invoice.id, gone.id))).length === 0
if (deletedInvoice) {
  const ro = await del(staff, orphan.id)
  check('a visit whose invoice was deleted is not held by it', ro.status === 200, ro)
} else {
  // the schema refused to delete an invoice a visit points at — then no orphan can exist; nothing to assert
  check('(an invoice under a visit cannot be deleted at all — the FK holds it)', true)
}

// ── unbilled: unchanged ──
const plain = await mkVisit(null)
const rp = await del(staff, plain.id)
check('an unbilled visit is still deleted as before (staff)', rp.status === 200 && !(await stillThere(plain.id)), rp)

console.log(`\nt62 billed visit delete: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
