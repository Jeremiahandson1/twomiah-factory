// crm-dispensary — T51/T52 M6, and rule 2: a rule applied on CREATE also applies on EDIT.
//
// Every date-of-birth rule lived inside POST /api/contacts. So a customer created with DOB 1990
// could be PUT to 2010-06-01 and the record answered 200 — an adult turned into a 16-year-old on a
// system whose entire job is to know which of those it is.
//
// The till still refuses the sale: the age check there reads the stored date, not this validation.
// So this was never a route to selling to a minor, and the tester rated it a medium for that reason.
// It is wrong in a quieter way — the shop's own record of who it served becomes false, and that
// record is what a regulator asks for.
//
// A customer is created once and edited for years. The edit path is the one that matters more and
// the one that keeps getting forgotten: T31 L8 (the markup notice), T48 Q7 (campaign detail routes),
// T47 P20 (editing a delivery zone could still overlap), and now this.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Edit Rules Leaf', slug: 'leaf-m6', email: 'm6@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'products', 'orders'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-m6@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// A perfectly ordinary adult customer.
const created = await api('POST', '/api/contacts', {
  name: 'Ada Adult', type: 'customer', dateOfBirth: '1990-04-02', phone: '555-4242',
})
check('an adult customer is created', created.status === 200 || created.status === 201, { status: created.status, body: created.json })
const id = (created.json?.data || created.json)?.id
check('…and has an id', !!id, created.json)

// ══════════ the finding ═════════════════════════════════════════════════════════════════════════
{
  const toMinor = await api('PUT', `/api/contacts/${id}`, { dateOfBirth: '2010-06-01' })
  check('editing the date of birth to make them 16 is REFUSED — it used to answer 200',
    toMinor.status === 400, { status: toMinor.status, body: toMinor.json })
  check('…and says why, with the age it worked out', String(toMinor.json?.code) === 'underage' && Number(toMinor.json?.age) < 18,
    toMinor.json)

  const [after] = await rows(sql`SELECT date_of_birth FROM contact WHERE id = ${id}`)
  check('…and the record is unchanged', String(after?.date_of_birth).slice(0, 10) === '1990-04-02', after?.date_of_birth)
}

// ══════════ the rest of the create rules, now on edit too ═══════════════════════════════════════
{
  const impossible = await api('PUT', `/api/contacts/${id}`, { dateOfBirth: '1990-02-30' })
  check('a date that is not a real calendar day is refused on edit as well',
    impossible.status === 400 && String(impossible.json?.code) === 'BAD_DATE', impossible.json)

  const future = await api('PUT', `/api/contacts/${id}`, { dateOfBirth: '2099-01-01' })
  check('a date of birth in the future is refused on edit', future.status === 400, future.json)

  // 18-to-20 saves — a shop records people before a card arrives — but it must SAY what it means.
  const young = new Date()
  young.setFullYear(young.getFullYear() - 19)
  const asNineteen = young.toISOString().slice(0, 10)
  const teen = await api('PUT', `/api/contacts/${id}`, { dateOfBirth: asNineteen })
  check('a 19-year-old still saves on edit', teen.status === 200, { status: teen.status, body: teen.json })
  check('…with the warning that no cannabis sale to them can complete',
    (teen.json?.warnings || []).some((w: string) => /no medical card/i.test(w)), teen.json?.warnings)

  // …and markup in a name, which T31 L8 first answered with a warning and which has since been
  // hardened into a refusal. It lives on the SHARED zod schema, so create and edit both get it
  // by construction rather than by anyone remembering — the best answer to rule 2 there is.
  const markupOnEdit = await api('PUT', `/api/contacts/${id}`, { name: 'Ada <i>Adult</i>' })
  check('markup in a name is refused on EDIT', markupOnEdit.status === 400, { status: markupOnEdit.status, body: markupOnEdit.json })
  const markupOnCreate = await api('POST', '/api/contacts', { name: 'New <b>Person</b>', type: 'customer', dateOfBirth: '1990-01-01' })
  check('…and on CREATE, with the same message', markupOnCreate.status === 400
    && String(markupOnCreate.json?.error) === String(markupOnEdit.json?.error).replace('Ada <i>Adult</i>', 'New <b>Person</b>').replace('Ada Adult', 'New Person'),
    { create: markupOnCreate.json?.error, edit: markupOnEdit.json?.error })
}

// ══════════ a vendor has no age ═════════════════════════════════════════════════════════════════
{
  const v = await api('POST', '/api/contacts', { name: 'Acme Supply', type: 'vendor', dateOfBirth: '2010-01-01' })
  check('a vendor may carry any date — it is not a person being sold to', v.status === 200 || v.status === 201,
    { status: v.status, body: v.json })
  const vid = (v.json?.data || v.json)?.id
  if (vid) {
    const ve = await api('PUT', `/api/contacts/${vid}`, { dateOfBirth: '2015-01-01' })
    check('…on edit as well, judged on what the record IS rather than what the edit mentions', ve.status === 200,
      { status: ve.status, body: ve.json })
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
