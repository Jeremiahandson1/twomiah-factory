// The portal credential on the quote detail and on recurring invoices. (T43 owner pass)
//
//   "opening a quote returns the customer's working portal token. That's Field service, Landscaping
//    and Showcase; Landscaping's recurring invoices return it too."
//
// MEASURED FIRST: 1,066 GETs across ten tenants and three seats found 18 leaking responses on
// exactly three endpoints — GET /api/quotes/:id, GET /api/recurring and GET /api/recurring/:id —
// to the owner and the manager. Both are SHARED modules, so the leak reaches every template that
// mounts them; the tenants that read clean did so because their sampled contact is not
// portal-enabled, not because they were safe.
//
// WHY THIS FILE EXISTS RATHER THAN A WIDER GUARD: the two sites are invisible to the kind of check
// that caught the other twenty.
//
//   · quotes.ts attaches the row as `contact: ct[0] || null` — indexed and defaulted, so the row's
//     bare name never appears and a name-matching guard sees nothing. The select also sits inside a
//     `Promise.all([…])`, lines away from the destructuring, which defeated a second sweep too.
//   · recurring.ts is RAW SQL: `row_to_json(c.*) as contact` serialises every column of the joined
//     row. There is no `db.select().from(contact)` in the file at all.
//
// So this asserts the RESPONSE, which is the only thing that cannot be fooled by a shape nobody
// anticipated: a real token is written onto the contact, and the payload is scanned as TEXT. A
// renamed, nested or re-cased leak fails this test.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, quote, quoteLineItem } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Harlow & Reed', slug: 'harlow-t44', email: 't44@test.local',
  settings: {}, enabledFeatures: ['quotes', 'invoices', 'contacts', 'recurring_invoices', 'recurring_jobs'],
} as any).returning()

const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@harlow-t44.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')

// A PORTAL-ENABLED customer with a credential nothing else in the payload could produce.
const TOKEN = 'tok-T44-9f3c1e7a-portal-credential-do-not-ship'
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Odile Fenwick', email: 'odile-t44@test.local',
  phone: '555-0144', address: '12 Pennel Row', city: 'Akron', state: 'OH', zip: '44301',
  portalEnabled: true, portalToken: TOKEN, portalTokenExp: new Date(Date.now() + 864e5),
} as any).returning()

const [q] = await db.insert(quote).values({
  companyId: co.id, contactId: client.id, number: 'QTE-0044', name: 'Rear extension',
  status: 'sent', subtotal: '4200.00', taxRate: '0', taxAmount: '0', discount: '0', total: '4200.00',
} as any).returning()
await db.insert(quoteLineItem).values({
  quoteId: q.id, description: 'Groundworks', quantity: '1', unitPrice: '4200.00', total: '4200.00', sortOrder: 0,
} as any)

// …and a recurring invoice for the same customer. Raw SQL, because that is what the module uses and
// the schema's recurring tables are created by the migration journal.
const recurringId = 'rec-t44-0001'
await db.execute(sql`
  INSERT INTO recurring_invoice (id, company_id, contact_id, frequency, start_date, next_run_date, status, subtotal, tax_rate, tax_amount, total, created_at, updated_at)
  VALUES (${recurringId}, ${co.id}, ${client.id}, 'monthly', ${new Date()}, ${new Date()}, 'active', '300.00', '0', '0', '300.00', now(), now())
`)

const app = new Hono()
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager)

// ══════════ the quote detail ════════════════════════════════════════════════════════════════════
console.log('\n══════════ GET /api/quotes/:id ══════════')
for (const [label, call] of [['the owner', asOwner], ['the manager', asManager]] as const) {
  const r = await call(`/api/quotes/${q.id}`)
  check(`${label} opens the quote`, r.status === 200, { status: r.status, body: r.text?.slice(0, 160) })
  check(`T43: …and the payload carries NO portal token`, !r.text.includes(TOKEN), 'the token is in the response')
  check(`…nor the expiry that goes with it`, !/portalTokenExp"\s*:\s*"/.test(r.text), 'portalTokenExp present')
  check(`…while the customer the quote is for is still there`,
    r.json?.contact?.name === 'Odile Fenwick' && r.json?.contact?.email === 'odile-t44@test.local', r.json?.contact)
  check(`…with the address the screen prints`,
    r.json?.contact?.address === '12 Pennel Row' && r.json?.contact?.city === 'Akron', r.json?.contact)
  check(`…and whether they have portal access, which is not the credential`,
    r.json?.contact?.portalEnabled === true, r.json?.contact?.portalEnabled)
}

// ══════════ recurring invoices — the raw-SQL half ═══════════════════════════════════════════════
console.log('\n══════════ GET /api/recurring and /api/recurring/:id ══════════')
for (const [label, call] of [['the owner', asOwner], ['the manager', asManager]] as const) {
  const list = await call('/api/recurring')
  check(`${label} reads the recurring list`, list.status === 200, { status: list.status, body: list.text?.slice(0, 200) })
  check(`T43: …with no portal token in it`, !list.text.includes(TOKEN), 'the token is in the list')
  const row = (Array.isArray(list.json) ? list.json : (list.json?.data ?? []))[0]
  check(`…and the customer is still attached`, row?.contact?.name === 'Odile Fenwick', row?.contact)

  const detail = await call(`/api/recurring/${recurringId}`)
  check(`${label} reads the recurring detail`, detail.status === 200, { status: detail.status })
  check(`T43: …with no portal token in it either`, !detail.text.includes(TOKEN), 'the token is in the detail')
  check(`…and the fields the screen needs survive the subtraction`,
    detail.json?.contact?.email === 'odile-t44@test.local' && detail.json?.contact?.phone === '555-0144',
    detail.json?.contact)
}

// ══════════ and the record itself is untouched ══════════════════════════════════════════════════
console.log('\n══════════ nothing was redacted at rest ══════════')
{
  const r: any = await db.execute(sql`SELECT portal_token, portal_enabled FROM contact WHERE id = ${client.id}`)
  const row = ((r as any).rows || r)[0]
  check('the token is still on the contact — this is a withholding, not a deletion',
    String(row?.portal_token) === TOKEN, row)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
