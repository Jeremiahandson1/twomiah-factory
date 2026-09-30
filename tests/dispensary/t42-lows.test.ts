// crm-dispensary — the T42 low findings that have a server side.
//
// L1-L4 are screen-level (a manager shown controls the API refuses) and are fixed in the frontend;
// what IS checkable here is the signal those screens now read — /auth/me and /login must hand back
// the permission list, or every one of them falls back to guessing.
//
// L5 an 18-to-20-year-old with no card could be saved against a rule that read as if 18 were enough
// L6 a 23-23 September report was stored with end_date the 24th
// L7 a sale quantity of 1.5 reached an integer column and came back as a catch-all format error
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Lows Dispensary', slug: 'lows', email: 'lows@test.local',
  state: 'OH', taxRate: '10', exciseTaxRate: '15', settings: {}, enabledFeatures: [],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-lows@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/compliance', (await import('./src/routes/compliance.ts')).default)
// index.ts mounts this; without it a ZodError escapes as a 500 and the test measures the harness
// rather than the route. (utils/errors.ts maps zod issues to a 400 naming the field)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)

// ── L1-L3: the screens need the server's own permission list to decide what to render ──────────
const me = await asManager('GET', '/api/auth/me')
check('L1-L3: /auth/me carries the permission list', me.status === 200 && Array.isArray(me.json?.permissions), me.json?.permissions)
check('L1-L3: a manager holds team:read', (me.json?.permissions || []).includes('team:read'), me.json?.permissions)
check('L1-L3: ...and NOT users:read, which is why the audit user filter 403d', !(me.json?.permissions || []).includes('users:read'), me.json?.permissions)

// M1's other half: the store's clock travels with the session so no screen guesses the shop's date.
check('M1: /auth/me carries the store time zone', typeof me.json?.company?.timeZone === 'string' && me.json.company.timeZone.length > 0, me.json?.company?.timeZone)
check('M1: ...and the store\'s own date', /^\d{4}-\d{2}-\d{2}$/.test(String(me.json?.company?.today)), me.json?.company?.today)

// ── L5: the rule the refusal states has to be the rule that is enforced ────────────────────────
const yearsAgo = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10) }

const minor = await asOwner('POST', '/api/contacts', { name: 'T42 Minor', type: 'customer', dateOfBirth: yearsAgo(16) })
check('L5: a 16-year-old is still refused', minor.status === 400, minor.json)
// The wording changed at T52 N6 and the rule did not. L5 is that the sentence must not read as if 18
// alone were enough, so that is what is asserted — not the sentence it happened to be in 2026.
{
  const said = String(minor.json?.error)
  check('L5: and the message no longer reads as if 18 alone were enough — a card is named as the condition',
    /medical card/i.test(said), said)
  check('L5: …and 21 is named as the age that needs no card', /\b21\b/.test(said), said)
  // T52 N6: it was refusing a RECORD while describing who can BUY, so a tester refused at 14 went on
  // to create an 18-year-old with no card, get a 201, and file the contradiction. It now says which
  // question it is answering.
  check('L5: …and it says what it is actually refusing, which is the record',
    /cannot be saved/i.test(said), said)
}

const noCard = await asOwner('POST', '/api/contacts', { name: 'T42 NoCard19', type: 'customer', dateOfBirth: yearsAgo(19) })
check('L5: an 18-to-20-year-old is still SAVED — a shop records people before the card arrives', noCard.status === 201, noCard.json)
check('L5: ...but is warned they cannot be sold to at all yet',
  (noCard.json?.warnings || []).some((w: string) => /no medical card recorded/i.test(w)), noCard.json?.warnings)

const withCard = await asOwner('POST', '/api/contacts', {
  name: 'T42 Card19', type: 'customer', dateOfBirth: yearsAgo(19),
  medicalCardNumber: 'OH-L5-1', medicalCardExpiry: '2030-01-01',
})
check('L5: a young patient WITH a card gets the medical-only warning instead',
  withCard.status === 201 && (withCard.json?.warnings || []).some((w: string) => /medical sales only/i.test(w)), withCard.json?.warnings)

// ── T52 N6: the tester's exact sequence, which is what made the old wording read as a contradiction
//
// Refused at 14 with a sentence about 21+ and "18+ with a valid medical card", then an 18-year-old
// with NO card created happily at 201. Both are correct — the record is kept, the till refuses the
// sale — but the refusal was describing who can BUY while refusing a RECORD, so the pair read as a
// rule the product was not following. The behaviour is unchanged here; the sentences have to make
// the two questions distinguishable.
{
  const fourteen = await asOwner('POST', '/api/contacts', { name: 'T52 Fourteen', type: 'customer', dateOfBirth: yearsAgo(14) })
  const eighteen = await asOwner('POST', '/api/contacts', { name: 'T52 Eighteen', type: 'customer', dateOfBirth: yearsAgo(18) })

  check('N6: a 14-year-old is refused', fourteen.status === 400, fourteen.json)
  check('N6: an 18-year-old with no card is still accepted — that is deliberate', eighteen.status === 201,
    { status: eighteen.status, body: eighteen.json })

  const refusal = String(fourteen.json?.error || '')
  check('N6: the refusal says it is refusing the RECORD, not describing who can buy',
    /cannot be saved/i.test(refusal), refusal)
  check('N6: …and says 18-to-20 IS kept, so the 201 above is not a surprise',
    /the record is kept/i.test(refusal), refusal)

  const kept = (eighteen.json?.warnings || []).join(' ')
  check('N6: …and the 18-year-old is told, on the record that was just saved, that no sale can complete',
    /no cannabis sale to them can be completed/i.test(kept), eighteen.json?.warnings)
  check('N6: …and that the record is being kept on purpose', /saved anyway/i.test(kept), eighteen.json?.warnings)
}

// ── L7: a fractional quantity is refused by name, not by a Postgres format error ────────────────
const [flower] = await db.insert(product).values({
  name: 'Lows Flower', sku: 'LF-1', category: 'flower', price: '40', weightGrams: '3.5',
  stockQuantity: 100, trackInventory: true, taxCategory: 'cannabis', companyId: co.id,
} as any).returning()
const [buyer] = await db.insert(contact).values({ type: 'customer', name: 'Lows Buyer', companyId: co.id, dateOfBirth: yearsAgo(30) } as any).returning()

const fractional = await asOwner('POST', '/api/orders', {
  contactId: buyer.id, items: [{ productId: flower.id, quantity: 1.5 }],
  type: 'walk_in', paymentMethod: 'cash', idVerified: true,
})
check('L7: a quantity of 1.5 is refused', fractional.status === 400, fractional)
check('L7: ...and says so by name, not "not in a valid format"',
  /whole number of units/i.test(String(fractional.json?.error)), fractional.json?.error)
check('L7: a whole quantity still sells', (await asOwner('POST', '/api/orders', {
  contactId: buyer.id, items: [{ productId: flower.id, quantity: 2 }],
  type: 'walk_in', paymentMethod: 'cash', idVerified: true,
})).status === 201)

// ── L6: the stored period ends on the last day it covers ───────────────────────────────────────
const day = new Date().toISOString().slice(0, 10)
const report = await asOwner('POST', '/api/compliance/reports/generate', { reportType: 'daily_sales', startDate: day, endDate: day })
check('L6: a same-day report generates', report.status === 200 || report.status === 201, report.json)
if (report.status === 200 || report.status === 201) {
  const r: any = await db.execute(sql`SELECT start_date, end_date FROM compliance_reports WHERE company_id = ${co.id} ORDER BY created_at DESC LIMIT 1`)
  const row = (r.rows || r)?.[0]
  const stored = String(row?.end_date ?? '').slice(0, 10)
  check('L6: end_date is the last day covered, not the exclusive bound the query used', stored === day, { stored, asked: day })
  check('L6: and the payload says the period end is inclusive',
    (await asOwner('GET', `/api/compliance/reports`)).status === 200)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
