// The QuickBooks module — three write routes any signed-in user of the company could drive.
//
//   POST /sync/customer/:contactId   push a customer into the company's books
//   POST /sync/invoice/:invoiceId    push an invoice into the company's books
//   POST /sync/payment/:paymentId    push a payment into the company's books
//
// Every other write in the file — connect, disconnect, auto-sync, all three bulk syncs — was already
// requireRole('admin', 'owner'). The single-record versions are the same act at a smaller scale and were
// never guarded, so a technician who cannot read an invoice could push one into accounting.
//
// All twelve are requirePermission('settings:update') now, which is the SAME set of people: admin carries
// settings:*, owner carries *, nobody else has either. The gain is that it can be asked on the screen, it
// can be granted to one person, and it says what it means — requireRole('admin', 'owner') reads like a
// list and is a minimum, and the shared implementation ignores the second argument entirely.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 QB Co', slug: 't30qb', email: 't30qb@test.local', settings: {}, enabledFeatures: ['invoices', 'contacts', 'quickbooks'] } as any).returning()
const mkUser = async (role: string, tag: string, extra?: string[]) =>
  (await db.insert(user).values({ email: `${tag}-t30qb@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id, ...(extra ? { extraPermissions: extra } : {}) } as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')
// the escape hatch a rank could never offer: one manager handed the books by name
const bookkeeper = await mkUser('manager', 'bookkeeper', ['settings:update'])
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T30 QB Customer', email: 'qb-t30@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/quickbooks', (await import('./src/routes/quickbooks.ts')).default)
app.onError(errorHandler)
const as = (who: any) => async (path: string) => {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role },
    body: '{}',
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
/** Refused by the guard, or let through to fail on QuickBooks not being connected. Never a 2xx here. */
const refused = (r: { status: number }) => r.status === 403
const gotPast = (r: { status: number }) => r.status !== 403

console.log('\n── the three single-record syncs, which nobody was guarding ──')
for (const [label, path] of [
  ['a customer', `/api/quickbooks/sync/customer/${cust.id}`],
  ['an invoice', '/api/quickbooks/sync/invoice/00000000-0000-0000-0000-000000000000'],
  ['a payment', '/api/quickbooks/sync/payment/00000000-0000-0000-0000-000000000000'],
] as const) {
  const s = await as(staff)(path)
  check(`staff cannot push ${label} into the books`, refused(s), { status: s.status, body: s.json })
  const m = await as(manager)(path)
  check(`…nor can a manager`, refused(m), { status: m.status, body: m.json })
  check(`…and the refusal names settings:update`, m.json?.required === 'settings:update', { body: m.json })
  const a = await as(admin)(path)
  check(`…while an admin gets past the guard`, gotPast(a), { status: a.status, body: a.json })
}

console.log('\n── the routes that were already guarded stay guarded ──')
{
  for (const path of ['/api/quickbooks/disconnect', '/api/quickbooks/auto-sync', '/api/quickbooks/sync/invoices', '/api/quickbooks/import/customers']) {
    const m = await as(manager)(path)
    check(`a manager is still refused ${path.replace('/api/quickbooks', '')}`, refused(m), { status: m.status })
  }
  const o = await as(owner)('/api/quickbooks/disconnect')
  check('…and an owner still gets past', gotPast(o), { status: o.status })
}

console.log('\n── the escape hatch: one manager given the books by name ──')
{
  const r = await as(bookkeeper)(`/api/quickbooks/sync/customer/${cust.id}`)
  check('a manager granted settings:update gets past the guard', gotPast(r), { status: r.status, body: r.json })
  const plain = await as(manager)(`/api/quickbooks/sync/customer/${cust.id}`)
  check('…while the same role without the grant does not — it is per person', refused(plain), { status: plain.status })
}

console.log(`\nfs-t30-quickbooks-authorise: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
