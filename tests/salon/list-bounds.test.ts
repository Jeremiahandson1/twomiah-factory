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
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
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

// ══════════ payroll /expenses ═══════════════════════════════════════════════════════════════════
//
// This route answered 500 on EVERY call it had ever received, and nothing noticed because it has no
// screen and no caller anywhere in the template. It was written against a different template's
// expense table: the salon's has no user_id and no status column, so the unconditional
// `leftJoin(user, eq(expense.userId, user.id))` built `eq(undefined, ...)` and Postgres answered
// "syntax error at or near =". The `as any` on the status filter is why the compiler stayed quiet.
//
// So the first thing pinned here is simply that it answers at all.
{
  const EXP = 118
  for (let i = 0; i < EXP; i++) {
    await db.insert(expense).values({
      companyId: co.id, category: i % 2 ? 'Colour stock' : 'Retail stock', amount: '25.00',
      vendor: 'Wella', description: `Order ${i}`, approved: i < 40,
    } as any)
  }

  const r = await api('/api/payroll/expenses')
  check('expenses answer 200 at all — they used to answer 500 every time', r.status === 200, { status: r.status, body: r.json })
  check('…in the { data, pagination } shape the rest of the template uses',
    Array.isArray(r.json?.data) && !!r.json?.pagination, Object.keys(r.json || {}))
  check(`…bounded to one page, not all ${EXP}`, rowsOf(r).length === 100, rowsOf(r).length)
  check('…and the total is reported', r.json?.pagination?.total === EXP, r.json?.pagination)
  check('…and the rows are real expenses', typeof rowsOf(r)[0]?.amount !== 'undefined' && !!rowsOf(r)[0]?.category, rowsOf(r)[0])

  const p2 = await api('/api/payroll/expenses?page=2')
  check('page 2 is the remainder', rowsOf(p2).length === EXP - 100, rowsOf(p2).length)
  const silly = await api('/api/payroll/expenses?limit=99999')
  check('…and a cap that holds at 500', silly.json?.pagination?.limit === 500, silly.json?.pagination)

  // `approved` is the column this table actually has; `status` never existed here.
  const yes = await api('/api/payroll/expenses?approved=true&limit=500')
  check('approved=true narrows to the approved ones', rowsOf(yes).length === 40 && yes.json?.pagination?.total === 40, yes.json?.pagination)
  check('…and every row really is approved', rowsOf(yes).every((e) => e.approved === true), true)
  const no = await api('/api/payroll/expenses?approved=false&limit=500')
  check('approved=false narrows to the rest', rowsOf(no).length === EXP - 40, rowsOf(no).length)
  const junk = await api('/api/payroll/expenses?approved=banana&limit=500')
  check('an unusable value for it is ignored rather than turned into broken SQL',
    junk.status === 200 && rowsOf(junk).length === EXP, { status: junk.status, n: rowsOf(junk).length })

  // One salon cannot read another's expenses.
  const [other] = await db.insert(company).values({
    name: 'Other Bounds', slug: 'otherbounds', email: 'ob@test.local', enabledFeatures: [],
  } as any).returning()
  await db.insert(expense).values({
    companyId: other.id, category: 'Theirs', amount: '999.00', approved: true,
  } as any)
  const mine = await api('/api/payroll/expenses?limit=500')
  check("another salon's expense is not in the list", rowsOf(mine).every((e) => e.companyId === co.id), true)
  check('…and the total does not count it', mine.json?.pagination?.total === EXP, mine.json?.pagination?.total)
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
