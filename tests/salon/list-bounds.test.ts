// crm-salon — the other two lists that grew without limit.
//
// Same rule as tests/salon/appt-list.test.ts, applied to the rest of the sweep. Enrolments and
// expenses only ever accumulate, so a list with no LIMIT answers with every one a salon has ever
// had. Neither takes a date window, so unlike the appointment book there is nothing else bounding
// them and the page is unconditional.
//
// The two the sweep deliberately left alone are recorded here as well, because "we looked and chose
// not to" is worth pinning: platformSupport /tickets proxies the factory and the bound belongs
// upstream, and serviceMenu / loyalty-rewards / membership-plans / receptionist-rules / gantt are
// bounded by what a salon can plausibly configure.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, membershipPlan, membershipEnrollment, expense } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Bounds Salon', slug: 'bounds', email: 'b@test.local', enabledFeatures: ['salon_booking', 'salon_memberships'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-b@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [plan] = await db.insert(membershipPlan).values({
  name: 'Colour Club', price: '99', billingCycle: 'monthly', companyId: co.id,
} as any).returning()
const [alice] = await db.insert(contact).values({ name: 'Alice', type: 'client', companyId: co.id } as any).returning()

// 130 enrolments — more than one default page of 100.
const N = 130
for (let i = 0; i < N; i++) {
  const [cl] = i === 0 ? [alice] : await db.insert(contact).values({ name: `Client ${i}`, type: 'client', companyId: co.id } as any).returning()
  await db.insert(membershipEnrollment).values({
    companyId: co.id, contactId: cl.id, planId: plan.id, status: 'active',
    startDate: new Date('2026-01-01'), creditsRemaining: 2,
  } as any)
}

const app = new Hono()
app.route('/api/memberships', (await import('./src/routes/memberships.ts')).default)
app.route('/api/payroll', (await import('./src/routes/payroll.ts')).default)
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const apiPost = async (path: string, body: unknown) => {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rowsOf = (r: any) => (r.json?.data || []) as any[]

// ══════════ memberships /enrollments ════════════════════════════════════════════════════════════
{
  const all = await api('/api/memberships/enrollments')
  check('enrolments answer 200', all.status === 200, { status: all.status, body: all.json })
  check(`…bounded to one page, not all ${N}`, rowsOf(all).length === 100, rowsOf(all).length)
  check('…and the page reads `data`, so MembershipsPage is untouched', Array.isArray(all.json?.data), Object.keys(all.json || {}))
  check('…and the total is reported', all.json?.pagination?.total === N, all.json?.pagination)
  check('…with the right page count', all.json?.pagination?.pages === 2, all.json?.pagination)

  const p2 = await api('/api/memberships/enrollments?page=2')
  check('page 2 is the remainder', rowsOf(p2).length === N - 100, rowsOf(p2).length)
  const ids1 = new Set(rowsOf(all).map((r) => r.id))
  check('…and does not repeat page 1', rowsOf(p2).every((r) => !ids1.has(r.id)), true)

  const big = await api('/api/memberships/enrollments?limit=500')
  check('a bigger page may be asked for', rowsOf(big).length === N, rowsOf(big).length)
  const silly = await api('/api/memberships/enrollments?limit=99999')
  check('…but the cap holds at 500', silly.json?.pagination?.limit === 500, silly.json?.pagination)

  // The filter it already honoured must keep working alongside the bound.
  const mine = await api(`/api/memberships/enrollments?contactId=${alice.id}`)
  check('contactId still narrows to one client', rowsOf(mine).length === 1, rowsOf(mine).length)
  check('…and the total counts only theirs, not the whole salon', mine.json?.pagination?.total === 1, mine.json?.pagination)
  const cancelled = await api('/api/memberships/enrollments?status=cancelled')
  check('status still narrows', rowsOf(cancelled).length === 0 && cancelled.json?.pagination?.total === 0, cancelled.json?.pagination)
}

// ══════════ expenses ════════════════════════════════════════════════════════════════════════════
//
// There used to be a GET /api/payroll/expenses here, and it answered 500 on EVERY call it had ever
// received: written against a different template's expense table, so the unconditional
// `leftJoin(user, eq(expense.userId, user.id))` built `eq(undefined, ...)` and Postgres answered
// "syntax error at or near =". The `as any` on its status filter is why the compiler stayed quiet.
//
// It is GONE. The salon now mounts the shared expenses module at /api/expenses — the one crm,
// crm-basic, crm-fieldservice and crm-landscaping have had for a long time — with create, edit,
// approve, reimburse and the shared Expenses screen. Keeping the old read-only route beside it
// would be two implementations over one table, which is exactly how the hourly-rate defect in that
// same file happened (T46 N24). So these assertions moved to the real endpoint.
{
  const EXP = 118
  for (let i = 0; i < EXP; i++) {
    await db.insert(expense).values({
      companyId: co.id, category: i % 2 ? 'stock' : 'retail', amount: '25.00',
      vendor: 'Wella', description: `Order ${i}`, approved: i < 40,
      date: new Date(2026, 5, 1 + (i % 28)),
    } as any)
  }

  const r = await api('/api/expenses')
  check('expenses answer 200 at all — the old route answered 500 every time', r.status === 200, { status: r.status, body: r.json })
  check('…in the { data, pagination } shape', Array.isArray(r.json?.data) && !!r.json?.pagination, Object.keys(r.json || {}))
  check(`…bounded to one page of 50, not all ${EXP}`, rowsOf(r).length === 50, rowsOf(r).length)
  check('…and the total is reported', r.json?.pagination?.total === EXP, r.json?.pagination)
  check('…and the rows are real expenses', typeof rowsOf(r)[0]?.amount !== 'undefined' && !!rowsOf(r)[0]?.category, rowsOf(r)[0])

  const p3 = await api('/api/expenses?page=3')
  check('page 3 is the remainder', rowsOf(p3).length === EXP - 100, rowsOf(p3).length)
  const silly = await api('/api/expenses?limit=99999')
  check('…and the cap holds at 200', silly.json?.pagination?.limit === 200, silly.json?.pagination)

  // The salon's own vocabulary, not the contractor default — and the same list that refuses an
  // unknown category on the way IN refuses it as a filter, rather than answering with an empty sheet.
  const stock = await api('/api/expenses?category=stock&limit=200')
  check('category=stock narrows to the salon\'s own category', rowsOf(stock).length === EXP / 2, rowsOf(stock).length)
  check('…and every row really is that category', rowsOf(stock).every((e) => e.category === 'stock'), true)
  const bogus = await api('/api/expenses?category=labor&limit=200')
  check('a contractor category is refused rather than silently answering nothing',
    bogus.status === 400, { status: bogus.status, body: bogus.json })

  // One salon cannot read another's expenses.
  const [other] = await db.insert(company).values({
    name: 'Other Bounds', slug: 'otherbounds', email: 'ob@test.local', enabledFeatures: [],
  } as any).returning()
  await db.insert(expense).values({
    companyId: other.id, category: 'stock', amount: '999.00', approved: true, date: new Date(2026, 5, 2),
  } as any)
  const mine = await api('/api/expenses?limit=200')
  check("another salon's expense is not in the list", rowsOf(mine).every((e) => e.companyId === co.id), true)
  check('…and the total does not count it', mine.json?.pagination?.total === EXP, mine.json?.pagination?.total)

  // …and the capability the old route never had: recording one, and approving it.
  const made = await apiPost('/api/expenses', { category: 'tools', amount: 48.5, vendor: 'Shears Co', description: 'Thinning shears' });
  check('an expense can be RECORDED — there was no create at all before', made.status === 200 || made.status === 201, { status: made.status, body: made.json })
  const newId = (made.json?.data || made.json)?.id
  check('…and comes back with an id', !!newId, made.json)
  if (newId) {
    const approved = await apiPost(`/api/expenses/${newId}/approve`, {})
    check('…and approved', approved.status === 200, { status: approved.status, body: approved.json })
  }
  const badCat = await apiPost('/api/expenses', { category: 'materials', amount: 10 });
  check('a category outside the salon\'s list is refused on the way in', badCat.status === 400, badCat.status)
}

// ══════════ the ones deliberately left unbounded ════════════════════════════════════════════════
{
  // A salon configures these; they do not grow with trade. Recorded so that if one of them ever
  // does start growing, this is where the decision was written down.
  const SMALL = ['serviceMenu /', 'loyalty /rewards', 'memberships /', 'aiReceptionist /rules', 'ganttCharts /']
  check(`${SMALL.length} configuration lists are knowingly left unbounded`, SMALL.length === 5)
  check('platformSupport /tickets proxies the factory, so its bound is not ours to set', true)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
