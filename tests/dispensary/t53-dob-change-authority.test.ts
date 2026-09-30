// crm-dispensary — T53/T54 N10 (High): who may change a date of birth already on file.
//
// The tester's sequence, as the budtender:
//
//   "T53 Age18" (DOB 2008-01-01, no card) → sale REFUSED 403 "Customer is 18 — sales require 21+"
//   PUT /api/contacts/:id { dateOfBirth: '1990-01-01' }                              → 200
//   the same sale again                                                              → 201
//
// The age gate did exactly as it was told, on a number the person selling had just changed. M6 had
// closed the arithmetic — no edit may make someone under 18 — and left the question of WHO open.
//
// The rule is about the FIELD, not about ages. A bracket rule ("may not cross 21") sounds tighter
// and is worse: it has to reason about birthdays, it says nothing about a quiet correction from 1990
// to 1991, and it invites a two-step walk. A date of birth is copied off a government ID at intake;
// changing one afterwards is amending the evidence the whole age gate rests on.
//
// So a budtender still takes the date at INTAKE — that is the job, and the ID is in their hand — and
// changing one already on file needs `contacts:change-dob`, which manager, admin and owner hold via
// `contacts:*`. A permission, not a rank, so a shop can grant it to a senior budtender.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'N10 Leaf', slug: 'leaf-n10', email: 'n10@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'products', 'orders'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'n10owner')
const manager = await mkUser('manager', 'n10mgr')
const budtender = await mkUser('budtender', 'n10bud')
const driver = await mkUser('driver', 'n10drv')

const [flower] = await db.insert(product).values({
  name: 'N10 Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 100,
  strainName: 'Blue Dream', strainType: 'hybrid', weightGrams: '3.5', taxCategory: 'cannabis',
  trackInventory: true, active: true, visible: true, inStock: true, thcPercent: '20',
} as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner), asMgr = as(manager), asBud = as(budtender), asDrv = as(driver)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const yearsAgo = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10) }

// ══════════ the tester's sequence, end to end ═══════════════════════════════════════════════════
{
  // A budtender takes the date at intake. That is untouched — it is the job.
  const made = await asBud('POST', '/api/contacts', { name: 'T53 Age18', type: 'customer', dateOfBirth: yearsAgo(18) })
  const id = (made.json?.data || made.json)?.id
  check('a budtender can still create a customer WITH a date of birth — intake is their job',
    (made.status === 200 || made.status === 201) && !!id, { status: made.status, body: made.json })

  // The till refuses the sale, as it always did.
  const refused = await asBud('POST', '/api/orders', {
    type: 'walk_in', contactId: id, idVerified: true, items: [{ productId: flower.id, quantity: 1 }],
  })
  check('…and the till refuses a cannabis sale to them', refused.status === 403, { status: refused.status, body: refused.json })

  // ── the finding ──
  const rewrite = await asBud('PUT', `/api/contacts/${id}`, { dateOfBirth: '1990-01-01' })
  check('…and rewriting that date of birth is now REFUSED — it used to answer 200',
    rewrite.status === 403 && String(rewrite.json?.code) === 'dob_change_needs_manager',
    { status: rewrite.status, body: rewrite.json })
  check('…with a message naming what is on file, so a real typo can be reported',
    /already on file can only be changed by a manager/i.test(String(rewrite.json?.error)), rewrite.json?.error)

  const [after] = await rows(sql`SELECT date_of_birth FROM contact WHERE id = ${id}`)
  check('…the record is unchanged', String(after?.date_of_birth).slice(0, 10) === yearsAgo(18), after?.date_of_birth)

  // …and therefore the sale the whole finding was about still cannot happen.
  const stillRefused = await asBud('POST', '/api/orders', {
    type: 'walk_in', contactId: id, idVerified: true, items: [{ productId: flower.id, quantity: 1 }],
  })
  check('…so the sale is STILL refused, which is the point of the finding', stillRefused.status === 403,
    { status: stillRefused.status, body: stillRefused.json })
}

// ══════════ a manager may correct it — refusing everyone would be the worse bug ═════════════════
{
  const made = await asBud('POST', '/api/contacts', { name: 'N10 Typo', type: 'customer', dateOfBirth: '1985-04-02' })
  const id = (made.json?.data || made.json)?.id

  const byMgr = await asMgr('PUT', `/api/contacts/${id}`, { dateOfBirth: '1985-04-20' })
  check('a manager can correct a date of birth', byMgr.status === 200, { status: byMgr.status, body: byMgr.json })
  const [m] = await rows(sql`SELECT date_of_birth FROM contact WHERE id = ${id}`)
  check('…and it is stored', String(m?.date_of_birth).slice(0, 10) === '1985-04-20', m?.date_of_birth)

  const byOwner = await asOwner('PUT', `/api/contacts/${id}`, { dateOfBirth: '1985-05-01' })
  check('…and so can the owner', byOwner.status === 200, { status: byOwner.status })

  // A manager is still bound by M6: the arithmetic rule did not go away.
  const toMinor = await asMgr('PUT', `/api/contacts/${id}`, { dateOfBirth: '2015-01-01' })
  check('…but a manager still cannot make them a child — M6 holds on top of this',
    toMinor.status === 400 && String(toMinor.json?.code) === 'underage', { status: toMinor.status, body: toMinor.json })
}

// ══════════ the rule is about the FIELD, not about crossing 21 ══════════════════════════════════
//
// A bracket rule would allow all of these. Each is a budtender editing a recorded date of birth
// without changing which side of 21 the customer sits, and each is still a rewrite of the evidence.
{
  const made = await asBud('POST', '/api/contacts', { name: 'N10 Adult', type: 'customer', dateOfBirth: '1990-01-01' })
  const id = (made.json?.data || made.json)?.id

  const nudge = await asBud('PUT', `/api/contacts/${id}`, { dateOfBirth: '1991-01-01' })
  check('a budtender cannot nudge an adult\'s date of birth either — no bracket is crossed and it is still refused',
    nudge.status === 403, { status: nudge.status, body: nudge.json })

  // …and the two-step walk a bracket rule invites: 18 → 20 → 21+. The first step is already refused.
  const teen = await asBud('POST', '/api/contacts', { name: 'N10 Teen', type: 'customer', dateOfBirth: yearsAgo(18) })
  const tid = (teen.json?.data || teen.json)?.id
  const step1 = await asBud('PUT', `/api/contacts/${tid}`, { dateOfBirth: yearsAgo(20) })
  check('…and the first step of an 18→20→21 walk is refused, so the walk never starts', step1.status === 403,
    { status: step1.status, body: step1.json })
}

// ══════════ everything ELSE a budtender does to a customer is untouched ═════════════════════════
//
// A new refusal on a shape that was being accepted breaks every caller still sending it. This one is
// deliberately narrow: the date of birth, on an existing record, changing to a different value.
{
  const made = await asBud('POST', '/api/contacts', { name: 'N10 Ordinary', type: 'customer', dateOfBirth: '1988-03-03', phone: '555-1000' })
  const id = (made.json?.data || made.json)?.id

  const edit = await asBud('PUT', `/api/contacts/${id}`, { phone: '555-2000', notes: 'prefers the sativa shelf' })
  check('a budtender can still edit a customer normally', edit.status === 200, { status: edit.status, body: edit.json })

  // Sending the SAME date of birth is not a change, and must not be refused — the screen PUTs the
  // whole form back, so every ordinary edit carries the unchanged date with it. Refusing that would
  // break the Customers screen for budtenders entirely.
  const resend = await asBud('PUT', `/api/contacts/${id}`, { dateOfBirth: '1988-03-03', notes: 'same date, different note' })
  check('…including a form PUT that carries the UNCHANGED date of birth back — the screen always does',
    resend.status === 200, { status: resend.status, body: resend.json })

  const medical = await asBud('PUT', `/api/contacts/${id}`, { medicalCardNumber: 'OH-N10-1' })
  check('…and can record a medical card', medical.status === 200, { status: medical.status, body: medical.json })
}

// ══════════ and a driver, who is below a budtender, cannot either ═══════════════════════════════
{
  const made = await asOwner('POST', '/api/contacts', { name: 'N10 Driver Probe', type: 'customer', dateOfBirth: '1980-06-06' })
  const id = (made.json?.data || made.json)?.id
  const byDrv = await asDrv('PUT', `/api/contacts/${id}`, { dateOfBirth: '1990-06-06' })
  check('a driver cannot change a date of birth', byDrv.status === 403, { status: byDrv.status, body: byDrv.json })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
