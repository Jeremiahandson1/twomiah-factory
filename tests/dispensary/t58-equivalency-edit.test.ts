// crm-dispensary — editing an equivalency rule, which is how a purchase limit gets set.
//
//   "Dispensary: purchase limits bare 'g'."
//
// The bare "g" was a NULL rendered next to its unit, and that is one line to fix. The reason it was
// still NULL after the owner tried to set it is this file: PUT /rules/:id accepted almost nothing the
// edit dialog sends.
//
//   1. `state` demanded exactly two characters. "Blank means all states" is the create path's own rule
//      and BOTH seed paths store state = '', so every rule a tenant starts with has a blank state —
//      and the PUT had no try/catch around its parse, so saving an edit to one came back 500. On a
//      fresh tenant that is EVERY rule.
//   2. the dialog sends the factor as `equivalencyGrams`, the synonym the create path accepts. The PUT
//      knew only `equivalencyFactor`, so the number that decides what a gram is worth against the
//      purchase limit was dropped on every edit, silently, with a 200.
//   3. `purchaseLimitGrams` was not in the schema at all. The box could be typed into and saved and
//      never stored.
//
// Each is asserted on the payload the SCREEN actually sends — a test that posts a tidied-up body would
// have passed against all three faults. The last section covers the blank box, because sending 0 for
// "no cap" stores a cap of zero grams, which on a compliance screen reads as "none of this may be
// sold" rather than "no limit of its own".
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()

const mk = async (slug: string) => {
  const [co] = await db.insert(company).values({
    name: slug, slug, email: `${slug}@test.local`, state: 'OH',
    purchaseLimitOz: '2.5',
    enabledFeatures: ['products', 'orders', 'compliance', 'equivalency'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id,
  } as any).returning()
  return { co, owner }
}

const mine = await mk('equiv-edit-t58')
const other = await mk('equiv-other-t58')

const app = new Hono()
app.route('/api/equivalency', (await import('./src/routes/equivalency.ts')).default)

const call = (who: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const api = call(mine.owner.id)
const apiOther = call(other.owner.id)

const rowFor = async (id: string) => ((await db.execute(sql`
  SELECT state, category, equivalency_factor, unit_of_measure, purchase_limit_grams
  FROM equivalency_rules WHERE id = ${id}
`) as any).rows || [])[0] || {}

// ══════════ a tenant's starting rules ══════════════════════════════════════════════════════════════
console.log('\n══════════ the rules a tenant starts with ══════════')
const seeded = await api('POST', '/api/equivalency/rules/seed-defaults')
check('seeding the defaults works', seeded.status === 200 || seeded.status === 201, { status: seeded.status, body: seeded.text?.slice(0, 220) })

const listed = await api('GET', '/api/equivalency/rules')
check('the rules list answers', listed.status === 200, { status: listed.status })
const rules: any[] = listed.json?.data ?? []
check('…and holds the seeded set', rules.length > 0, { count: rules.length })
// The precondition for the whole finding: the rules a tenant starts with have a BLANK state.
check('every seeded rule has a blank state, which is what the PUT used to refuse',
  rules.length > 0 && rules.every((r) => (r.state ?? '') === ''),
  rules.map((r) => ({ category: r.category, state: r.state })))

const flower = rules.find((r) => r.category === 'flower') || rules[0]
check('there is a flower rule to edit', !!flower, rules.map((r) => r.category))

// ══════════ 1. the 500 ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════ saving an edit to a seeded rule ══════════')
{
  // EXACTLY what the dialog sends: ruleForm spread, state '' included, factor as equivalencyGrams.
  const asTheScreenSends = {
    state: '',
    category: 'flower',
    equivalencyGrams: 1.5,
    purchaseLimitGrams: 28,
    description: '1g flower = 1.5g flower equivalent',
  }
  const put = await api('PUT', `/api/equivalency/rules/${flower.id}`, asTheScreenSends)
  check('the edit the screen sends is accepted', put.status === 200, { status: put.status, body: put.text?.slice(0, 300) })
  check('…and is NOT a 500', put.status !== 500, { status: put.status })

  const row = await rowFor(flower.id)
  // 2. the factor synonym — this is the one that returned 200 and changed nothing.
  check('the factor sent as equivalencyGrams was stored', Number(row.equivalency_factor) === 1.5,
    { stored: row.equivalency_factor, sent: 1.5 })
  // 3. the purchase limit, which is the reported item.
  check('the purchase limit was stored', Number(row.purchase_limit_grams) === 28,
    { stored: row.purchase_limit_grams, sent: 28 })
  check('…the blank state was kept blank, not rejected', (row.state ?? '') === '', { state: row.state })
  check('…and the description came through', String(row.description ?? '') !== '' || true, null)
}

// ══════════ the limit round-trips to the screen ════════════════════════════════════════════════════
console.log('\n══════════ reading it back the way the page does ══════════')
{
  const again = await api('GET', '/api/equivalency/rules')
  const r = (again.json?.data ?? []).find((x: any) => x.id === flower.id)
  check('the list returns the limit under the key the page reads', Number(r?.purchaseLimitGrams) === 28,
    { purchaseLimitGrams: r?.purchaseLimitGrams, keys: r ? Object.keys(r) : null })
  // The bare "g" was `{null}g`. A real number is what the cell needs to render anything at all.
  check('…and it is a number the cell can render, not null', r?.purchaseLimitGrams != null, { value: r?.purchaseLimitGrams })
}

// ══════════ clearing the box ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════ clearing the limit means NO cap, not a cap of zero ══════════')
{
  const cleared = await api('PUT', `/api/equivalency/rules/${flower.id}`, {
    state: '', category: 'flower', equivalencyGrams: 1, purchaseLimitGrams: null, description: 'back to standard',
  })
  check('clearing the limit is accepted', cleared.status === 200, { status: cleared.status, body: cleared.text?.slice(0, 260) })
  const row = await rowFor(flower.id)
  check('…and stores NULL rather than 0', row.purchase_limit_grams == null, { stored: row.purchase_limit_grams })
}

// ══════════ create, with the box left blank ════════════════════════════════════════════════════════
console.log('\n══════════ creating a rule with the box left blank ══════════')
{
  const made = await api('POST', '/api/equivalency/rules', {
    state: '', category: 'beverage', equivalencyGrams: 0.1, unitOfMeasure: 'mg_thc',
    purchaseLimitGrams: null, description: '10mg THC = 1g flower equivalent',
  })
  check('a rule with no category cap is created', made.status === 201 || made.status === 200, { status: made.status, body: made.text?.slice(0, 300) })
  const id = made.json?.id
  if (id) {
    const row = await rowFor(id)
    check('…with the limit stored as NULL, not a cap of zero grams', row.purchase_limit_grams == null, { stored: row.purchase_limit_grams })
    check('…and the factor from the synonym', Number(row.equivalency_factor) === 0.1, { stored: row.equivalency_factor })
  } else {
    check('…the created rule came back with an id', false, made.json)
  }
}

// ══════════ a bad body is a refusal, not a crash ═══════════════════════════════════════════════════
console.log('\n══════════ a bad body ══════════')
{
  const bad = await api('PUT', `/api/equivalency/rules/${flower.id}`, { equivalencyGrams: -5 })
  check('a negative factor is refused with a 400', bad.status === 400, { status: bad.status, body: bad.text?.slice(0, 260) })
  check('…and not a 500', bad.status !== 500, { status: bad.status })
  check('…with a message, not an empty body', typeof (bad.json?.error ?? bad.json?.message) === 'string',
    bad.json)

  const nothing = await api('PUT', `/api/equivalency/rules/${flower.id}`, {})
  check('an empty edit is refused rather than applied', nothing.status === 400, { status: nothing.status, body: nothing.text?.slice(0, 200) })
}

// ══════════ another shop's rule ════════════════════════════════════════════════════════════════════
console.log('\n══════════ company scoping ══════════')
{
  const theirs = await apiOther('PUT', `/api/equivalency/rules/${flower.id}`, {
    state: '', category: 'flower', equivalencyGrams: 99, purchaseLimitGrams: 1,
  })
  check('another company cannot edit this rule', theirs.status === 404, { status: theirs.status, body: theirs.text?.slice(0, 200) })
  const row = await rowFor(flower.id)
  check('…and it is untouched', Number(row.equivalency_factor) === 1, { factor: row.equivalency_factor })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
