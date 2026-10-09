// T60 (open since T42) — "Vet: 'Refund them first' is shown to a manager who isn't allowed to refund."
//
// Void asks invoices:update, which a manager holds. Refund asks payments:delete, which a manager does
// not. So voiding an invoice that still holds money told the one role most likely to try it to do the
// thing it may not do. The refusal now names the next step for the person asking — through the same
// canSee the company routes use, so an owner's per-user grant counts too.
//
// Asserted through the REAL invoice route against the real schema: the invoice is raised and paid by
// the API, the void is refused for each seat, and the wording is checked, not just the 400.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Willow Vet', slug: 'willow-vet-t60', email: 'willow@test.local', state: 'OH', settings: {}, enabledFeatures: ['invoices'],
} as any).returning()
const mkUser = async (role: string, tag: string, extra: string[] = []) => (await db.insert(user).values({
  email: `${tag}@willow.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
  extraPermissions: extra,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
// The owner handed this manager refunds by name (Settings › Users). They may refund, so they are told to.
const trusted = await mkUser('manager', 'trusted', ['payments:delete'])
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Priya Raman', email: 'priya-t60@test.local' } as any).returning()

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asTrusted = as(trusted)

const created = await asOwner('POST', '/api/invoices', { contactId: client.id, lineItems: [{ description: 'Exam', quantity: 1, unitPrice: 80 }] })
check('the invoice is raised', created.status === 201, { status: created.status, body: created.text?.slice(0, 200) })
const id = created.json?.id
const paid = await asOwner('POST', `/api/invoices/${id}/payments`, { amount: 30, method: 'cash' })
check('…and part-paid', paid.status === 201, { status: paid.status, body: paid.text?.slice(0, 200) })

const mgrVoid = await asManager('POST', `/api/invoices/${id}/void`, { reason: 'entered twice' })
check('a manager may not void an invoice holding money', mgrVoid.status === 400, { status: mgrVoid.status })
check('…and is NOT told to refund it — they cannot', !/Refund them first/.test(mgrVoid.json?.error || ''), mgrVoid.json)
check('…but is told who can', /An owner or admin needs to refund them first/.test(mgrVoid.json?.error || '') && /\$30\.00/.test(mgrVoid.json?.error || ''), mgrVoid.json)
const mgrRefund = await asManager('POST', `/api/invoices/${id}/refund`, { amount: 30, reason: 'x' })
check('…which is true: the refund route refuses a manager', mgrRefund.status === 403, { status: mgrRefund.status })

const ownerVoid = await asOwner('POST', `/api/invoices/${id}/void`, { reason: 'entered twice' })
check('the owner IS told to refund first, then void', ownerVoid.status === 400 && /Refund them first, then void\./.test(ownerVoid.json?.error || ''), ownerVoid.json)

const trustedVoid = await asTrusted('POST', `/api/invoices/${id}/void`, { reason: 'entered twice' })
check('a manager the owner granted refunds is told to refund — the grant counts', trustedVoid.status === 400 && /Refund them first, then void\./.test(trustedVoid.json?.error || ''), trustedVoid.json)

// the void still works once the money is back — the wording changed, the rule did not
const refunded = await asOwner('POST', `/api/invoices/${id}/refund`, { amount: 30, reason: 'entered twice' })
check('the owner refunds it', refunded.status === 200 || refunded.status === 201, { status: refunded.status, body: refunded.text?.slice(0, 200) })

console.log(`\nt60 void says who refunds: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
