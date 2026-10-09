// T62 Medium — "Field service contact detail returns quote and invoice totals" to staff.
//
// A contact's related lists each ask the permission their own page asks: quotes:read, invoices:read. A
// technician (field: neither) is not handed those lists at all — the totals are money, and every row would link
// to a page that refuses them. The contact, its jobs and its equipment stay. Through the real router.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, quote, invoice, job } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Brightline HVAC', slug: 'bright-t62', email: 'bright-t62@test.local', settings: {}, enabledFeatures: ['contacts', 'jobs', 'quotes', 'invoices'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@bright-t62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), viewer = await mk('viewer', 'viewer'), tech = await mk('field', 'tech')
const [cust] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Imogen Hart', email: 'imogen-t62@test.local' } as any).returning()
// 4545.45 and 6363.63 — figures nothing else in the payload can produce
await db.insert(quote).values({ companyId: co.id, contactId: cust.id, number: 'QT-T62-1', name: 'Heat pump', status: 'sent', subtotal: '4545.45', total: '4545.45' } as any)
await db.insert(invoice).values({ companyId: co.id, contactId: cust.id, number: 'INV-T62-1', status: 'sent', subtotal: '6363.63', total: '6363.63', amountPaid: '0' } as any)
await db.insert(job).values({ companyId: co.id, contactId: cust.id, number: 'JOB-T62-1', title: 'Annual service', status: 'scheduled' } as any)

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const read = async (who: any) => {
  const res = await app.request(`/api/contacts/${cust.id}`, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const t = await read(tech)
check('the technician opens the customer', t.status === 200 && t.json?.name === 'Imogen Hart', { status: t.status })
check('…and sees their jobs', (t.json?.jobs || []).some((j: any) => j.number === 'JOB-T62-1'), t.json?.jobs)
check('…with NO quotes list (absent, not empty — no "Quotes 0")', !('quotes' in (t.json || {})), Object.keys(t.json || {}))
check('…with NO invoices list', !('invoices' in (t.json || {})), Object.keys(t.json || {}))
check('…and neither total anywhere in the payload', !/4545|6363/.test(t.text))

for (const [who, label] of [[owner, 'the owner'], [manager, 'a manager'], [viewer, 'a viewer (sees revenue, not cost)']] as const) {
  const r = await read(who)
  check(`${label} sees the quote and its total`, (r.json?.quotes || []).some((q: any) => Number(q.total) === 4545.45), r.json?.quotes)
  check(`${label} sees the invoice and its total`, (r.json?.invoices || []).some((i: any) => Number(i.total) === 6363.63), r.json?.invoices)
}

console.log(`\nt62 contact relations: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
