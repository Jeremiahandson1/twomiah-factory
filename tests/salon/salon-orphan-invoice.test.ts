// Salon T20 H3 — "Deleting a logged service leaves its invoice behind, still owed."
// Logging a service creates an invoice. Deleting the record returned 200 and removed the visit, but the
// invoice survived: Open, full balance, still counted in Outstanding everywhere, with nothing on it
// connecting it back to the record that had been deleted. A stylist who logged a service against the
// wrong client and deleted it had silently created a real debt.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord, invoice } from './db/schema.ts'
import { eq, and } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-orp', email: 'o@test.local', settings: {}, enabledFeatures: ['appointments'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'o@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Vera Visit', email: 'vera@test.local' } as any).returning()
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut & Finish', price: '20', durationMin: 45 } as any).returning()

const app = new Hono()
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const invoices = async () => db.select().from(invoice).where(eq(invoice.companyId, co.id))
// Outstanding, the way the invoice stats compute it: everything issued that is not draft/void/refunded.
const outstanding = async () => (await invoices())
  .filter((i: any) => !['draft', 'void', 'refunded'].includes(String(i.status)))
  .reduce((s: number, i: any) => s + Math.max(0, Number(i.total || 0) - Number(i.amountPaid || 0)), 0)

// ── logging a service raises a sale, and the visit remembers which one ─────────────────────────────
let recId = '', invId = ''
{
  const before = await outstanding()
  const rec = await call('POST', '/api/service-records', { contactId: client.id, serviceId: svc.id, priceCharged: 20 })
  check('logging a service works', rec.status === 201, rec.json)
  recId = rec.json?.id
  invId = rec.json?.invoiceId
  check('…and raises an invoice', !!invId, rec.json)
  check('…which puts money on Outstanding', (await outstanding()) > before, { before, after: await outstanding() })
  const [row] = await db.select().from(serviceRecord).where(eq(serviceRecord.id, recId))
  check('H3: the visit records WHICH sale it raised (nothing connected them)', (row as any).invoiceId === invId, { link: (row as any).invoiceId, invoice: invId })
}

// ── deleting the visit takes the sale with it ──────────────────────────────────────────────────────
{
  const before = await outstanding()
  const del = await call('DELETE', `/api/service-records/${recId}`)
  check('deleting the visit succeeds', del.status === 200, del.json)
  check('…and says which invoice it voided', del.json?.voidedInvoice?.id === invId, del.json)

  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invId))
  check('H3: the invoice is VOID, not left Open at full balance', inv?.status === 'void', inv?.status)
  check('…and says why, on the invoice itself', /visit it was raised from was deleted/.test(String(inv?.notes)), inv?.notes)
  check('…the invoice still exists — an issued invoice is never deleted, only voided', !!inv, null)
  check('…its number is preserved', !!inv?.number, inv?.number)
  check('H3: it is out of Outstanding (it stayed counted everywhere)', (await outstanding()) === before - 20, { before, after: await outstanding() })
  const gone = await db.select().from(serviceRecord).where(eq(serviceRecord.id, recId))
  check('…and the visit really is gone', gone.length === 0, gone.length)
}

// ── a visit that has been PAID for cannot be deleted out from under the money ──────────────────────
{
  const rec = await call('POST', '/api/service-records', { contactId: client.id, serviceId: svc.id, priceCharged: 50 })
  const paidInvId = rec.json?.invoiceId
  await db.update(invoice).set({ amountPaid: '55', status: 'paid' } as any).where(eq(invoice.id, paidInvId))

  const del = await call('DELETE', `/api/service-records/${rec.json?.id}`)
  check('H3: deleting a paid-for visit is refused rather than stranding the payment', del.status === 400 && del.json?.code === 'VISIT_HAS_PAYMENT', { status: del.status, body: del.json })
  check('…and the message names the invoice and the money', /INV-/.test(String(del.json?.invoiceNumber)) && Number(del.json?.amountPaid) === 55, del.json)
  const still = await db.select().from(serviceRecord).where(eq(serviceRecord.id, rec.json?.id))
  check('…so the visit is still there', still.length === 1, still.length)
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, paidInvId))
  check('…and the invoice is untouched', inv?.status === 'paid', inv?.status)
}

// ── a refunded sale is left alone: the refund already records the reversal ─────────────────────────
{
  const rec = await call('POST', '/api/service-records', { contactId: client.id, serviceId: svc.id, priceCharged: 30 })
  const refInvId = rec.json?.invoiceId
  await db.update(invoice).set({ amountPaid: '33', amountRefunded: '33', status: 'refunded' } as any).where(eq(invoice.id, refInvId))
  const del = await call('DELETE', `/api/service-records/${rec.json?.id}`)
  check('a refunded sale does not block the delete (the money already came back)', del.status === 200, del.json)
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, refInvId))
  check('…and stays refunded rather than being refiled as void', inv?.status === 'refunded', inv?.status)
}

// ── a visit that raised no sale deletes cleanly ────────────────────────────────────────────────────
{
  const rec = await call('POST', '/api/service-records', { contactId: client.id, notes: 'Consultation only, no charge' })
  check('a visit with no price raises no invoice', !rec.json?.invoiceId, rec.json?.invoiceId)
  const del = await call('DELETE', `/api/service-records/${rec.json?.id}`)
  check('…and deletes cleanly, voiding nothing', del.status === 200 && del.json?.voidedInvoice == null, del.json)
}

// ── a visit logged before the link existed is still matched, via its appointment ───────────────────
{
  const dob = new Date().toISOString().slice(0, 10)
  const start = new Date(); start.setDate(start.getDate() + 2); start.setHours(11, 0, 0, 0)
  const appt = await call('POST', '/api/appointments', { contactId: client.id, serviceId: svc.id, startTime: start.toISOString(), quotedPrice: 20 })
  const rec = await call('POST', '/api/service-records', { contactId: client.id, appointmentId: appt.json?.id, serviceId: svc.id, priceCharged: 20 })
  const legacyInvId = rec.json?.invoiceId || (await invoices()).find((i: any) => i.appointmentId === appt.json?.id)?.id
  // simulate a record written before invoice_id existed on the visit
  await db.update(serviceRecord).set({ invoiceId: null } as any).where(eq(serviceRecord.id, rec.json?.id))
  const del = await call('DELETE', `/api/service-records/${rec.json?.id}`)
  check('H3: an older visit with no stored link still finds its sale, via the appointment', del.json?.voidedInvoice?.id === legacyInvId, { del: del.json, want: legacyInvId })
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, legacyInvId))
  check('…and that invoice is voided too', inv?.status === 'void', inv?.status)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
