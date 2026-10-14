// The viewer reads a quote and an invoice — and only that. (E2E run 1, 10/14: "Quote and invoice rows did not open a
// detail page on this seat".) The detail pages make one GET each; this proves the viewer is answered, without the
// cost of a line, and that the reads gated the same day (submittals, call tracking, AI receptionist) refuse
// the viewer and the contractor's field seat while still answering a manager.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')
const [co] = await db.insert(S.company).values({ name: 'Viewer Co', slug: 'viewer-co', email: 'o@vw.test', settings: {}, enabledFeatures: ['quotes', 'invoices', 'contacts', 'submittals', 'call_tracking', 'ai_receptionist'] } as any).returning()
const mk = async (role: string) => (await db.insert(S.user).values({ email: `${role}@vw.test`, passwordHash: 'x', firstName: role, lastName: 'T', role, companyId: co.id, isActive: true } as any).returning())[0]
const viewer = await mk('viewer'), field = await mk('field'), manager = await mk('manager')
const [ct] = await db.insert(S.contact).values({ type: 'client', name: 'Pat', email: 'pat@vw.test', companyId: co.id } as any).returning()
const [q] = await db.insert(S.quote).values({ number: 'QTE-1', name: 'Deck', status: 'sent', contactId: ct.id, companyId: co.id, subtotal: '100', total: '100' } as any).returning()
await db.insert(S.quoteLineItem).values({ quoteId: q.id, description: 'Boards', quantity: '1', unitPrice: '100', unitCost: '61.00', total: '100', sortOrder: 0 } as any)
const [inv] = await db.insert(S.invoice).values({ number: 'INV-1', status: 'sent', contactId: ct.id, companyId: co.id, subtotal: '100', total: '100', amountPaid: '0', balance: '100' } as any).returning()

const app = new Hono()
for (const [mount, file] of [['/api/quotes', 'quotes'], ['/api/invoices', 'invoices'], ['/api/submittals', 'submittals'], ['/api/calltracking', 'calltracking'], ['/api/ai-receptionist', 'aiReceptionist']] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any, path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const qv = await get(viewer, `/api/quotes/${q.id}`)
check(`the viewer opens the quote (${qv.status})`, qv.status === 200 && qv.json?.number === 'QTE-1', qv.json)
check('…without the cost of a line', qv.status === 200 && !JSON.stringify(qv.json).includes('61.00'), qv.json?.lineItems)
const iv = await get(viewer, `/api/invoices/${inv.id}`)
check(`the viewer opens the invoice (${iv.status})`, iv.status === 200 && iv.json?.number === 'INV-1', iv.json)

// Not the pricebook: it stays readable by everyone with cost and margin withheld — T32's decision, asserted in
// t32-read-authorisation (a technician prices jobs from it on site).
for (const path of ['/api/submittals', '/api/calltracking/calls', '/api/ai-receptionist/rules']) {
  const v = await get(viewer, path), f = await get(field, path), m = await get(manager, path)
  check(`${path}: viewer refused (${v.status}), contractor field refused (${f.status}), manager answered (${m.status})`, v.status === 403 && f.status === 403 && m.status === 200, { v: v.json, f: f.json, m: m.status })
}

// The crew on site adds punch items (owner's decision, 10/14); a viewer still cannot.
{
  const punch = new Hono()
  punch.route('/api/punch-lists', (await import('./src/routes/punchLists.ts')).default)
  punch.onError((await import('./src/utils/errors.ts')).errorHandler)
  const [proj] = await db.insert(S.project).values({ name: 'Kitchen', number: 'PRJ-1', status: 'active', companyId: co.id } as any).returning()
  const post = async (who: any) => {
    const res = await punch.request('/api/punch-lists', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: JSON.stringify({ description: 'Touch up paint by window', projectId: proj.id }) })
    return res.status
  }
  const f = await post(field), v = await post(viewer)
  check(`field adds a punch item (${f}); the viewer cannot (${v})`, (f === 201 || f === 200) && v === 403, { f, v })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
