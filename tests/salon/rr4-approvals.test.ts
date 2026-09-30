// crm-salon — RR4 M2 / M3 / M4 / L2: what an approval is, and what breaks it.
//
// An approval is a SECOND PERSON vouching for a specific figure before money is paid against it.
// Three findings, all of them that one sentence not being enforced:
//
//   M3  a manager logged an hour and approved it themselves — removing the check for the one person
//       who approves everyone else
//   M2  an approved 2.5-hour entry could be PUT to 6 hours and came back "6.00, still approved"; a
//       reimbursed $24.50 expense could be PUT to $500 and came back "$500.00, still reimbursed"
//   M4  an expense read reimbursed:true / approved:false — the money paid out with the check skipped
//
// The tester put the three together: a manager could log their own hours, approve them, and then
// change the number. That is a payroll fraud in three requests, and it is why these are fixed as one
// rule rather than three patches.
//
// The rules live in packages/tenant-backend (time/time.ts and expenses/expenses.ts), which crm,
// crm-basic, crm-fieldservice, crm-landscaping and crm-salon all mount — so this is tested once and
// holds in five verticals.
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
  name: 'RR4 Salon', slug: 'rr4-approvals', email: 'rr4@test.local', state: 'OH',
  enabledFeatures: ['time_tracking', 'expense_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'rr4owner')
const manager = await mkUser('manager', 'rr4mgr')
const manager2 = await mkUser('manager', 'rr4mgr2')
const stylist = await mkUser('field', 'rr4staff')

const app = new Hono()
app.route('/api/time', (await import('./src/routes/time.ts')).default)
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
const asOwner = as(owner), asMgr = as(manager), asMgr2 = as(manager2), asStaff = as(stylist)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

// ══════════ M3 · a manager cannot approve their own time ════════════════════════════════════════
{
  const mine = await asMgr('POST', '/api/time', { hours: 1, date: yesterday, description: 'RR4 mgr own' })
  const id = (mine.json?.data || mine.json)?.id
  check('a manager can log their own hour', (mine.status === 200 || mine.status === 201) && !!id, { status: mine.status, body: mine.json })

  const self = await asMgr('POST', `/api/time/${id}/approve`)
  check('…and approving it THEMSELVES is refused — it used to answer 200',
    self.status === 403 && String(self.json?.code) === 'self_approval', { status: self.status, body: self.json })
  check('…with a reason that says what approval is for', /second person/i.test(String(self.json?.error)), self.json?.error)

  const [after] = await rows(sql`SELECT approved FROM time_entry WHERE id = ${id}`)
  check('…and the entry is still unapproved', after?.approved === false, after)

  // …by another manager, which is the whole point of the rule, and by the owner.
  const byPeer = await asMgr2('POST', `/api/time/${id}/approve`)
  check('a DIFFERENT manager can approve it', byPeer.status === 200, { status: byPeer.status, body: byPeer.json })
}
{
  // The top of the tree has nobody to ask. Refusing them would leave an owner's own hours
  // unapprovable forever — the "a refusal can be the bug" failure this project has had once already.
  const own = await asOwner('POST', '/api/time', { hours: 2, date: yesterday, description: 'RR4 owner own' })
  const id = (own.json?.data || own.json)?.id
  const self = await asOwner('POST', `/api/time/${id}/approve`)
  check('an OWNER may approve their own time — there is nobody above them', self.status === 200,
    { status: self.status, body: self.json })
}
{
  // The same rule through the OTHER door. A rule enforced on the route that approves one entry and
  // not on the route that approves five hundred is not a rule. (rule 2)
  const a = await asMgr('POST', '/api/time', { hours: 3, date: yesterday, description: 'RR4 bulk own' })
  const b = await asStaff('POST', '/api/time', { hours: 4, date: yesterday, description: 'RR4 bulk staff' })
  const aId = (a.json?.data || a.json)?.id, bId = (b.json?.data || b.json)?.id

  const bulk = await asMgr('POST', '/api/time/approve', { entryIds: [aId, bId] })
  check('bulk approve accepts the batch', bulk.status === 200, { status: bulk.status, body: bulk.json })
  check('…approving the OTHER person\'s entry', Number(bulk.json?.approved) === 1, bulk.json)
  check('…and leaving the approver\'s own for someone else', Number(bulk.json?.skipped) === 1, bulk.json)

  const [own] = await rows(sql`SELECT approved FROM time_entry WHERE id = ${aId}`)
  const [other] = await rows(sql`SELECT approved FROM time_entry WHERE id = ${bId}`)
  check('…the manager\'s own entry is NOT approved', own?.approved === false, own)
  check('…and the stylist\'s is', other?.approved === true, other)
}

// ══════════ M2 · changing the figure ends the approval ══════════════════════════════════════════
{
  const made = await asStaff('POST', '/api/time', { hours: 2.5, date: yesterday, description: 'RR4 manual log' })
  const id = (made.json?.data || made.json)?.id
  const appr = await asMgr('POST', `/api/time/${id}/approve`)
  check('a stylist\'s entry is approved by the manager', appr.status === 200, { status: appr.status, body: appr.json })

  const edited = await asMgr('PUT', `/api/time/${id}`, { hours: 6 })
  check('editing the hours is still allowed — correcting a mistake is normal', edited.status === 200,
    { status: edited.status, body: edited.json })
  check('…but the approval is GONE — it used to read "6.00 hours, still approved"',
    (edited.json?.data || edited.json)?.approved === false, edited.json)
  check('…and it says so rather than leaving it to be noticed',
    (edited.json?.warnings || []).some((w: string) => /needs approving again/i.test(w)), edited.json?.warnings)

  const [after] = await rows(sql`SELECT hours, approved FROM time_entry WHERE id = ${id}`)
  check('…on the record, not just in the response', Number(after?.hours) === 6 && after?.approved === false, after)

  // Moving the day is the same kind of change: a different claim.
  const reappr = await asMgr('POST', `/api/time/${id}/approve`)
  check('it can be approved again', reappr.status === 200, reappr.status)
  const moved = await asMgr('PUT', `/api/time/${id}`, { date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) })
  check('…and moving it to another day also ends the approval',
    (moved.json?.data || moved.json)?.approved === false, moved.json)

  // …while an edit that does NOT touch the figure leaves it alone. A rule that fired on every edit
  // would make fixing a typo cost a re-approval, which is the kind of refusal that stops the shop.
  const re2 = await asMgr('POST', `/api/time/${id}/approve`)
  check('approved once more', re2.status === 200, re2.status)
  const noted = await asMgr('PUT', `/api/time/${id}`, { description: 'RR4 manual log (tidied)' })
  check('editing only the description keeps the approval',
    (noted.json?.data || noted.json)?.approved === true, noted.json)
}

// ══════════ M4 · reimbursing comes after approval ═══════════════════════════════════════════════
{
  const made = await asStaff('POST', '/api/expenses', {
    category: 'stock', description: 'RR4 foils', vendor: 'RR4 Supply Co', amount: 24.5, date: yesterday, reimbursable: true,
  })
  const id = (made.json?.data || made.json)?.id
  check('a stylist can add an expense', (made.status === 200 || made.status === 201) && !!id, { status: made.status, body: made.json })

  const early = await asMgr('POST', `/api/expenses/${id}/reimburse`)
  check('reimbursing BEFORE approval is refused — it used to answer 200',
    early.status === 409 && String(early.json?.code) === 'approval_required', { status: early.status, body: early.json })
  check('…and names the step that is missing', /approve/i.test(String(early.json?.error)), early.json?.error)

  const [still] = await rows(sql`SELECT reimbursed, approved FROM expense WHERE id = ${id}`)
  check('…and no money was marked as paid', still?.reimbursed === false, still)

  const appr = await asMgr('POST', `/api/expenses/${id}/approve`)
  check('approving it works', appr.status === 200, { status: appr.status, body: appr.json })
  const paid = await asMgr('POST', `/api/expenses/${id}/reimburse`)
  check('…and then reimbursing works', paid.status === 200, { status: paid.status, body: paid.json })

  // ── M2, the expense half. The money has LEFT. What was paid cannot be rewritten.
  const rewrite = await asMgr('PUT', `/api/expenses/${id}`, { amount: 500 })
  check('editing the amount of a REIMBURSED expense is refused — it used to read "$500.00, still reimbursed"',
    rewrite.status === 409 && String(rewrite.json?.code) === 'already_reimbursed', { status: rewrite.status, body: rewrite.json })
  const [unchanged] = await rows(sql`SELECT amount, reimbursed FROM expense WHERE id = ${id}`)
  check('…and the figure is untouched', Number(unchanged?.amount) === 24.5, unchanged)
  check('…and it is still reimbursed', unchanged?.reimbursed === true, unchanged)

  // …but a description fix is not a rewrite of what was paid.
  const tidy = await asMgr('PUT', `/api/expenses/${id}`, { description: 'RR4 foils (box of 500)' })
  check('fixing the description of a reimbursed expense is still allowed', tidy.status === 200,
    { status: tidy.status, body: tidy.json })
}
{
  // Approved but NOT paid: changing the amount is allowed and ends the approval, the same as time.
  const made = await asStaff('POST', '/api/expenses', {
    category: 'tools', description: 'RR4 shears', amount: 40, date: yesterday, reimbursable: true,
  })
  const id = (made.json?.data || made.json)?.id
  await asMgr('POST', `/api/expenses/${id}/approve`)
  const edited = await asMgr('PUT', `/api/expenses/${id}`, { amount: 45 })
  check('an APPROVED, unpaid expense can still be corrected', edited.status === 200, { status: edited.status, body: edited.json })
  check('…and the approval is removed', (edited.json?.data || edited.json)?.approved === false, edited.json)
  check('…and it says so', (edited.json?.warnings || []).some((w: string) => /needs approving again/i.test(w)), edited.json?.warnings)

  // …so the money cannot go out on the old approval.
  const pay = await asMgr('POST', `/api/expenses/${id}/reimburse`)
  check('…so reimbursing is refused until it is approved again',
    pay.status === 409 && String(pay.json?.code) === 'approval_required', { status: pay.status, body: pay.json })
}

// ══════════ the three together — the fraud the tester described ═════════════════════════════════
{
  const logged = await asMgr('POST', '/api/time', { hours: 1, date: yesterday, description: 'RR4 fraud probe' })
  const id = (logged.json?.data || logged.json)?.id
  const selfAppr = await asMgr('POST', `/api/time/${id}/approve`)
  check('a manager cannot log their own hours and approve them', selfAppr.status === 403, selfAppr.status)

  await asMgr2('POST', `/api/time/${id}/approve`)   // a second person does the checking
  const inflate = await asMgr('PUT', `/api/time/${id}`, { hours: 12 })
  const [row] = await rows(sql`SELECT hours, approved FROM time_entry WHERE id = ${id}`)
  check('…and inflating an entry someone else approved drops the approval',
    Number(row?.hours) === 12 && row?.approved === false, row)
}

// ══════════ L2 · a typed word gets a plain-English answer ═══════════════════════════════════════
{
  const bad = await asStaff('POST', '/api/expenses', { category: 'stock', description: 'RR4 typo', amount: 'abc', date: yesterday })
  check('a text amount is refused', bad.status === 400, { status: bad.status, body: bad.json })
  check('…in plain English, not "Expected number, received nan"',
    /must be a number/i.test(String(bad.json?.error)) && !/received nan/i.test(String(bad.json?.error)), bad.json?.error)

  const badHours = await asStaff('POST', '/api/time', { hours: 'abc', date: yesterday, description: 'RR4 typo' })
  check('…and so is a text number of hours', badHours.status === 400 && /must be a number/i.test(String(badHours.json?.error)),
    badHours.json?.error)

  // The rules the tester confirmed already work must not have been disturbed.
  const neg = await asStaff('POST', '/api/expenses', { category: 'stock', description: 'RR4 neg', amount: -10, date: yesterday })
  check('a negative amount is still refused', neg.status === 400 && /greater than 0/i.test(String(neg.json?.error)), neg.json?.error)
  const future = await asStaff('POST', '/api/time', { hours: 2, date: '2027-01-01', description: 'RR4 future' })
  check('a future date is still refused', future.status === 400 && /has happened/i.test(String(future.json?.error)), future.json?.error)
  const tooLong = await asStaff('POST', '/api/time', { hours: 30, date: yesterday, description: 'RR4 long' })
  check('30 hours in a day is still refused', tooLong.status === 400 && /cannot exceed/i.test(String(tooLong.json?.error)), tooLong.json?.error)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
