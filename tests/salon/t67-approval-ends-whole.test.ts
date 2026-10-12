// T67 — an approval an edit ends is ended whole.
//
//   "Turning reimbursable on cancels the approval, but the record keeps the approver and approval time. It ends
//    up saying 'approved by Morgan Manager at 03:27' while also showing as not approved."
//
// PUT /:id cleared `approved` and left approvedById and approvedAt, on every edit that ends an approval (the
// flag turned on, the amount, the tax, the date). Asserted through the REAL expense route, on the stored row —
// and the rows already written that way are repaired at startup, which is checked too: a broken row is put in
// BEFORE the route module loads, beside a real approval that must not be touched.
//
// Turning the flag OFF keeps the approval, deliberately (RR8 Y1, asserted in rr8-expenses.test.ts): it pays out
// less than was approved. It is re-asserted here with its approver, so the two halves are read together.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, expense } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'T67 Salon', slug: 't67-expenses', email: 't67@test.local', state: 'OH',
  enabledFeatures: ['time_tracking', 'expense_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const manager = await mkUser('manager', 't67mgr')
const stylist = await mkUser('field', 't67sty')

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const stored = async (id: string) => (await rows(sql`SELECT approved, approved_by_id, approved_at, reimbursable FROM expense WHERE id = ${id}`))[0]
const yesterday = new Date(Date.now() - 86400000)

// ── the rows already left broken, written before the route module loads ─────────────────────────
const [broken] = await db.insert(expense).values({
  companyId: co.id, date: yesterday, category: 'stock', description: 'T67 left broken', amount: '12',
  submittedById: stylist.id, approved: false, approvedById: manager.id, approvedAt: new Date(Date.now() - 3600000),
} as any).returning()
const [real] = await db.insert(expense).values({
  companyId: co.id, date: yesterday, category: 'stock', description: 'T67 really approved', amount: '15',
  submittedById: stylist.id, approved: true, approvedById: manager.id, approvedAt: new Date(Date.now() - 3600000),
} as any).returning()

const app = new Hono()
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asMgr = as(manager), asSty = as(stylist)
const body = (r: any) => r.json?.data || r.json
const add = async (desc: string, amount: number, reimbursable: boolean) =>
  body(await asSty('POST', '/api/expenses', { category: 'stock', description: desc, amount, date: yesterday.toISOString().slice(0, 10), reimbursable }))?.id

// The repair runs as the module is created; the first request through the app comes after it is issued, and a
// short wait covers the round trip.
await asMgr('GET', '/api/expenses?limit=1')
await new Promise((r) => setTimeout(r, 300))
{
  const b = await stored(broken.id), r = await stored(real.id)
  check('startup: a row left "not approved" beside an approver is repaired', b?.approved === false && b?.approved_by_id === null && b?.approved_at === null, b)
  check('startup: …and a real approval is left exactly as it was', r?.approved === true && r?.approved_by_id === manager.id && r?.approved_at !== null, r)
}

// ── turning "Reimburse me" ON ends the approval, whole ────────────────────────────────────────────
{
  const id = await add('T67 bought stock', 14.4, false)
  const appr = await asMgr('POST', `/api/expenses/${id}/approve`)
  check('a cost the salon paid is approved', appr.status === 200 && body(appr)?.approvedById === manager.id && !!body(appr)?.approvedAt, body(appr))
  const flip = await asMgr('PUT', `/api/expenses/${id}`, { reimbursable: true })
  check('turning it into a claim ends the approval (200, approved false)', flip.status === 200 && body(flip)?.approved === false, { status: flip.status, body: body(flip) })
  check('…and the answer no longer names an approver or a time', body(flip)?.approvedById === null && body(flip)?.approvedAt === null, body(flip))
  const s = await stored(id)
  check('…nor does the stored row — this is what the tester read', s?.approved === false && s?.approved_by_id === null && s?.approved_at === null && s?.reimbursable === true, s)

  // Approving it again writes a fresh approver and time, so the approval the record shows is the one that holds.
  const again = await asMgr('POST', `/api/expenses/${id}/approve`)
  check('approving the claim again records the new approval', again.status === 200 && body(again)?.approvedById === manager.id && !!body(again)?.approvedAt, body(again))

  // OFF keeps it — approver and all (RR8 Y1).
  const off = await asMgr('PUT', `/api/expenses/${id}`, { reimbursable: false })
  const o = await stored(id)
  check('turning it OFF keeps the approval, with its approver and time', off.status === 200 && o?.approved === true && o?.approved_by_id === manager.id && o?.approved_at !== null, o)
}

// ── the same for every other edit that ends an approval ───────────────────────────────────────────
for (const [what, change] of [['amount', { amount: 30 }], ['tax', { taxAmount: 2.5 }], ['date', { date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) }]] as const) {
  const id = await add(`T67 ${what}`, 20, true)
  await asMgr('POST', `/api/expenses/${id}/approve`)
  const r = await asMgr('PUT', `/api/expenses/${id}`, change)
  const s = await stored(id)
  check(`changing the ${what} ends the approval whole`, r.status === 200 && s?.approved === false && s?.approved_by_id === null && s?.approved_at === null, { status: r.status, s })
}

// ── and an edit that does NOT end it leaves all three alone ───────────────────────────────────────
{
  const id = await add('T67 typo', 20, true)
  await asMgr('POST', `/api/expenses/${id}/approve`)
  const r = await asMgr('PUT', `/api/expenses/${id}`, { description: 'T67 typo fixed', amount: '20.00' })
  const s = await stored(id)
  check('fixing the description keeps the approval, approver and time', r.status === 200 && s?.approved === true && s?.approved_by_id === manager.id && s?.approved_at !== null, { status: r.status, s })
}

// ── and the person who saved it is told (Contractor admin pass, 10/12) ─────────────────────────────
// The server explains the ended approval in `warnings`; the shared Expenses screen said only "Expense updated", so the
// record was right and the person reading the screen still believed it approved.
{
  const r = (process.env.FACTORY_ROOT || '').replace(/\/?$/, '/')
  const page = (await Bun.file(`${r}packages/tenant-ui/src/people/ExpensesPage.tsx`).text()).replace(/\r\n/g, '\n')
  const edit = page.slice(page.indexOf('if (editing) {'), page.indexOf("else { await api.post('/api/expenses'"))
  check('the Expenses screen shows the server\'s warning when an edit ends an approval',
    /const res: any = await api\.put\(`\/api\/expenses\/\$\{editing\.id\}`, payload\)/.test(edit)
    && /const warning = \(res\?\.warnings \?\? res\?\.data\?\.warnings\)\?\.\[0\]/.test(edit)
    && /if \(warning\) toast\.error\(`Saved\. \$\{warning\}`\); else toast\.success\('Expense updated'\)/.test(edit), edit.slice(0, 300))
  const id = await add('T67 told', 20, true)
  await asMgr('POST', `/api/expenses/${id}/approve`)
  const told = await asMgr('PUT', `/api/expenses/${id}`, { amount: 25 })
  check('…and the server sends one for the screen to show', told.status === 200 && /approval has been removed/.test(String((body(told) as any)?.warnings?.[0] ?? (told as any).json?.warnings?.[0])), (told as any).json ?? told)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
