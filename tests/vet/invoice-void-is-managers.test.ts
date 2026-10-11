// Vet — staff bill a visit; writing the bill off is a manager's. (Owner's decision, 2026-10-10)
//
//   "Decision for you on Vet: staff can now void an unpaid invoice. The Void button is back on the invoice
//    page and the void went through when tested. Is that intended?"            — staff pass, T66
//
// It was not. Void asked invoices:update, and vet staff hold invoices:update so they can raise and correct
// the bill for a visit. It now asks invoices:void: owner, admin, manager. Asserted through the REAL invoice
// route — staff still create and edit, and a void they are refused leaves the invoice exactly as it was.
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
const { company, user, contact, invoice } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Birch Vet', slug: 'birch-vet-void', email: 'birch@test.local', state: 'OH', settings: {}, enabledFeatures: ['invoices'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@birch.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const staff = await mkUser('staff', 'staff')        // vet stores the floor seat as `staff` (roleMapping staff → field)
const manager = await mkUser('manager', 'manager')
const owner = await mkUser('owner', 'owner')
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Sam Okafor', email: 'sam-void@test.local' } as any).returning()

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const S = as(staff), M = as(manager), O = as(owner)

// The work staff are there to do still works.
const made = await S('POST', '/api/invoices', { contactId: client.id, lineItems: [{ description: 'Wellness exam', quantity: 1, unitPrice: 65 }] })
check('staff raise the bill for a visit', made.status === 201, made)
const id = made.json?.id
const edited = await S('PUT', `/api/invoices/${id}`, { contactId: client.id, lineItems: [{ description: 'Wellness exam', quantity: 1, unitPrice: 60 }] })
check('…and correct it', edited.status === 200, edited)

// Writing it off is not theirs.
const sv = await S('POST', `/api/invoices/${id}/void`, { reason: 'client changed their mind' })
check('staff cannot void it', sv.status === 403 && sv.json?.required === 'invoices:void', sv)
const [still] = await db.select().from(invoice).where(eq(invoice.id, id))
check('…and it is still open, not void', still?.status !== 'void', still?.status)

const mv = await M('POST', `/api/invoices/${id}/void`, { reason: 'entered twice' })
check('a manager voids it', mv.status === 200 && mv.json?.status === 'void', mv)

const second = await O('POST', '/api/invoices', { contactId: client.id, lineItems: [{ description: 'Nail trim', quantity: 1, unitPrice: 15 }] })
check('the owner voids one too', (await O('POST', `/api/invoices/${second.json?.id}/void`, { reason: 'x' })).status === 200)

console.log(`\nvet void is the manager's: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
