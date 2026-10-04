// crm-salon — the repayment. (RR7 X6 admitted the gap; RR8 asked for it to be closed properly.)
//
// A claim paid at $50 that should have been $40 leaves the salon $10 out of pocket, and the product
// had no way to record the stylist handing it back. The refusal on a reimbursed expense said so out
// loud — "this sheet cannot record a repayment yet, settle it outside the expense sheet" — which is
// honest and is not a feature.
//
// What this is NOT, and each of these is load-bearing:
//   · not a rewrite of the amount. $50 was paid and that is what happened. RR6 E4 and RR7 X2 both
//     turn on the record of a payment being unrewritable.
//   · not a negative expense. Every amount in this module is positive on purpose; a credit note is
//     a different document, and faking one would leave every total guessing which rows are money in.
//   · not a second approval. Approval protects money going OUT. This is money arriving, and a
//     second signature on it would only delay putting the books right. It takes the authority that
//     pays a claim (manager+), demands a written reason, and is audited.
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
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Repayment Salon', slug: 'repay-salon', email: 'repay@test.local', state: 'OH',
  enabledFeatures: ['expense_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'repayown')
const manager = await mkUser('manager', 'repaymgr')
const stylist = await mkUser('field', 'repaysty')

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
const asOwner = as(owner), asMgr = as(manager), asSty = as(stylist)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const body = (r: any) => r.json?.data || r.json
const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

/** A claim, approved and paid — the only state a repayment can exist against. */
const paidClaim = async (desc: string, amount: number) => {
  const made = await as(stylist)('POST', '/api/expenses', { category: 'stock', description: desc, amount, date: yesterday, reimbursable: true })
  const id = body(made)?.id
  await asMgr('POST', `/api/expenses/${id}/approve`)
  await asMgr('POST', `/api/expenses/${id}/reimburse`)
  return id as string
}

// ══════════ the correction the refusal used to admit it could not make ══════════════════════════
{
  const id = await paidClaim('Repay overpaid stock', 50)
  const [before] = await rows(sql`SELECT amount, reimbursed, repaid_amount FROM expense WHERE id = ${id}`)
  check('a claim is paid at 50', n2(before?.amount) === 50 && before?.reimbursed === true, before)
  check('…with nothing repaid yet', n2(before?.repaid_amount) === 0, before)

  const back = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 10, reason: 'Overpaid by 10, returned in cash' })
  check('10 comes back', back.status === 200, { status: back.status, body: back.json })
  check('…and the expense still says it was paid 50 — the record of a payment is not rewritten',
    n2(body(back)?.amount) === 50 && body(back)?.reimbursed === true, { amount: body(back)?.amount, reimbursed: body(back)?.reimbursed })
  check('…the repayment is recorded against it', n2(body(back)?.repaidAmount) === 10, body(back)?.repaidAmount)
  check('…the net cost is 40, worked out by the server rather than by whoever is reading',
    n2(body(back)?.netAmount) === 40, body(back)?.netAmount)
  check('…and it knows it is not fully back', body(back)?.fullyRepaid === false, body(back)?.fullyRepaid)
  check('…who recorded it and why are on the row',
    body(back)?.repaidById === manager.id && /Overpaid by 10/.test(String(body(back)?.repaidReason)), body(back))

  // In instalments, because money comes back in instalments.
  const more = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 5, reason: 'Second instalment' })
  check('a second repayment adds to the first', n2(body(more)?.repaidAmount) === 15, body(more)?.repaidAmount)
  check('…and the net follows', n2(body(more)?.netAmount) === 35, body(more)?.netAmount)

  // …and never more than went out.
  const toomuch = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 40, reason: 'More than was ever paid' })
  check('more coming back than went out is refused', toomuch.status === 400, { status: toomuch.status, body: toomuch.json })
  check('…and the refusal says how much is actually outstanding',
    /35\.00 of the 50\.00/.test(String(toomuch.json?.error)) && n2(toomuch.json?.outstanding) === 35, toomuch.json)
  const [unchanged] = await rows(sql`SELECT repaid_amount FROM expense WHERE id = ${id}`)
  check('…and nothing was recorded', n2(unchanged?.repaid_amount) === 15, unchanged)

  // The rest of it, exactly.
  const rest = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 35, reason: 'The remainder' })
  check('the remainder can come back to the penny', rest.status === 200 && n2(body(rest)?.repaidAmount) === 50, body(rest)?.repaidAmount)
  check('…and it says the claim is square', body(rest)?.fullyRepaid === true && n2(body(rest)?.netAmount) === 0, body(rest))
  const nothingLeft = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 1, reason: 'One more' })
  check('…after which there is nothing left to give back', nothingLeft.status === 400 && /already been paid back/i.test(String(nothingLeft.json?.error)),
    { status: nothingLeft.status, body: nothingLeft.json })
}

// ══════════ what it will not do ═════════════════════════════════════════════════════════════════
{
  // Nothing went out, so nothing can come back.
  const made = await as(stylist)('POST', '/api/expenses', { category: 'stock', description: 'Repay unpaid claim', amount: 20, date: yesterday, reimbursable: true })
  const id = body(made)?.id
  const early = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 5, reason: 'Nothing was paid' })
  check('a repayment against an UNPAID claim is refused', early.status === 409 && String(early.json?.code) === 'not_reimbursed',
    { status: early.status, body: early.json })
  check('…and says to correct the amount instead, which IS possible on an unpaid claim',
    /Correct the amount instead/.test(String(early.json?.error)), early.json?.error)
  const fix = await asMgr('PUT', `/api/expenses/${id}`, { amount: 15 })
  check('…and that correction works', fix.status === 200 && n2(body(fix)?.amount) === 15, body(fix)?.amount)
}
{
  const id = await paidClaim('Repay rules', 30)
  const noReason = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 5 })
  check('a repayment without a reason is refused — the sheet has to explain itself later',
    noReason.status === 400 && /why the money came back/i.test(String(noReason.json?.error)), { status: noReason.status, body: noReason.json })
  const zero = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 0, reason: 'Nothing' })
  check('…and 0 is not a repayment', zero.status === 400, { status: zero.status, body: zero.json })
  const negative = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: -5, reason: 'Backwards' })
  check('…nor a negative one, which would be a payment wearing a disguise', negative.status === 400, { status: negative.status, body: negative.json })
  const text = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 'abc', reason: 'Typed it' })
  check('…and "abc" is answered in words a person recognises',
    text.status === 400 && /Amount must be a number/.test(String(text.json?.error)), text.json?.error)

  const byStylist = await asSty('POST', `/api/expenses/${id}/repayment`, { amount: 5, reason: 'By the claimant' })
  check('the person who was paid cannot record their own repayment — same authority as paying it out',
    byStylist.status === 403, { status: byStylist.status, body: byStylist.json })
  const byOwner = await asOwner('POST', `/api/expenses/${id}/repayment`, { amount: 5, reason: 'By the owner' })
  check('…an owner can', byOwner.status === 200, { status: byOwner.status, body: byOwner.json })

  const missing = await asMgr('POST', '/api/expenses/repay-no-such-id/repayment', { amount: 5, reason: 'Nowhere' })
  check('…and an id that does not exist is not found', missing.status === 404, missing.status)
}

// ══════════ the totals tell the truth about what was spent ══════════════════════════════════════
{
  const id = await paidClaim('Repay summary probe', 100)
  const beforeSummary = await asMgr('GET', '/api/expenses/summary')
  const beforeTotal = n2(beforeSummary.json?.total)
  await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 40, reason: 'Overpaid on the summary probe' })
  const after = await asMgr('GET', '/api/expenses/summary')

  check('the summary total drops by what came back — the salon spent 40 less',
    n2(after.json?.total) === n2(beforeTotal - 40), { before: beforeTotal, after: after.json?.total })
  check('…and the gross is still there beside it, so the two can be reconciled',
    n2(after.json?.claimed) === n2(beforeSummary.json?.claimed ?? beforeTotal) && n2(after.json?.repaid) > 0,
    { claimed: after.json?.claimed, repaid: after.json?.repaid, total: after.json?.total })
  check('…and the arithmetic holds', n2(after.json?.claimed) - n2(after.json?.repaid) === n2(after.json?.total), after.json)

  const cat = (after.json?.byCategory || {}).stock
  check('…per category too', cat && n2(cat.claimed) - n2(cat.repaid) === n2(cat.amount), cat)
}

// ══════════ the refusal now points at a door that exists ════════════════════════════════════════
{
  const id = await paidClaim('Repay advice', 25)
  const edit = await asMgr('PUT', `/api/expenses/${id}`, { amount: 500 })
  check('rewriting a reimbursed amount is still refused', edit.status === 409, { status: edit.status })
  for (const [what, msg] of [
    ['editing', String(edit.json?.error)],
    ['deleting', String((await asMgr('DELETE', `/api/expenses/${id}`)).json?.error)],
  ] as Array<[string, string]>) {
    check(`${what}: the advice names the repayment, instead of sending them outside the system`,
      /Record repayment/.test(msg), msg)
    check(`${what}: …and no longer says the sheet cannot record one`, !/cannot record a repayment/i.test(msg), msg)
  }
}

// ══════════ it is on the screen, because a rule with no screen is not a feature ═════════════════
{
  const page = strip((await Bun.file(`${ROOT}packages/tenant-ui/src/people/ExpensesPage.tsx`).text()).replace(/\r\n/g, '\n'))
  // RR9 merged the two controls. "Record repayment" and "Record over-payment" as separate menu
  // items made the reader choose between two things that sound the same, so there is now ONE action
  // that asks the question that actually distinguishes them — has the money come back yet? — and
  // sends the answer to this endpoint or to /overpayment. tests/salon/staff-balance.test.ts proves
  // the other branch.
  check('the Expenses screen can record one', /expenses\/\$\{repayFor\.id\}\/\$\{path\}`/.test(page)
    && /const path = repayForm\.settled \? 'repayment' : 'overpayment'/.test(page), null)
  check('…from an action offered only where money actually went out',
    // T43 put `maySettle &&` in front of this predicate (expenses:update — the action was offered
    // to a seat the API refuses). The property is the two conditions AFTER it: a manager, on a row
    // where money actually went out and some of it is still unaccounted for.
    /label: 'Correct an over-payment'[^\n]*show: \(r\) => [^\n]*manager && !!r\.reimbursed && outstanding\(r\) > 0/.test(page), null)
  check('…with a reason box, because the server insists on one', /What happened \*/.test(page) && /repayForm\.reason/.test(page), null)
  check('…and the row shows what came back and what it cost in the end',
    /money\(repaid\(row\)\)/.test(page) && /money\(outstanding\(row\)\)/.test(page), null)
  check('…while the claim keeps the figure it was paid at', /<span>\{money\(v\)\}<\/span>/.test(page), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
