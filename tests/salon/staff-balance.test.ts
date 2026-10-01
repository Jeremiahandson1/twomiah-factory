// crm-salon — what staff owe the business, and the three ways it comes back. (Salon RR9)
//
// The repayment built last round could only record money ARRIVING. That left out the state a salon
// is actually in between finding an over-payment and getting it back — days or weeks in which
// nobody could see it, chase it, or take it off a pay run, and nothing to write off if it never
// came. Every established system models it as a receivable, and so does this now.
//
// The decisions under test, because each one is a judgement somebody could disagree with:
//   · the SAME ledger as the client account balance, anchored on the user row instead of the
//     contact row — one implementation of "balance", locked on the subject's own row.
//   · nothing is ever raised automatically. A person decides an over-payment happened.
//   · a payroll deduction is OFF until the business switches it on, and refused without a recorded
//     authorisation. Taking money from wages is not the same kind of act as the other two.
//   · `totalPay` on a pay run stays what was EARNED. Deductions sit beside it, never inside it.
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
  name: 'Owed Salon', slug: 'owed-salon', email: 'owed@test.local', state: 'OH',
  enabledFeatures: ['expense_tracking', 'time_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Stylist', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owedown')
const manager = await mkUser('manager', 'owedmgr')
const stylist = await mkUser('field', 'owedsty')
const other = await mkUser('field', 'owedsty2')

const app = new Hono()
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.route('/api/time', (await import('./src/routes/time.ts')).default)
app.route('/api/payroll', (await import('./src/routes/payroll.ts')).default)
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

const claim = async (who: any, desc: string, amount: number, pay = true) => {
  const made = await as(who)('POST', '/api/expenses', { category: 'stock', description: desc, amount, date: yesterday, reimbursable: true })
  const id = body(made)?.id
  await asMgr('POST', `/api/expenses/${id}/approve`)
  if (pay) await asMgr('POST', `/api/expenses/${id}/reimburse`)
  return id as string
}
const owedFor = async (who: any) => {
  const r = await asMgr('GET', '/api/expenses/owed')
  return n2((r.json?.people || []).find((p: any) => p.userId === who.id)?.owed)
}

// ══════════ raising it: the state that had nowhere to live ══════════════════════════════════════
{
  const id = await claim(stylist, 'Owed probe stock', 50)
  const raise = await asMgr('POST', `/api/expenses/${id}/overpayment`, { amount: 10, reason: 'Receipt was 40, paid 50' })
  check('an over-payment can be recorded as still owed', raise.status === 200, { status: raise.status, body: raise.json })
  check('…against the person who claimed it', raise.json?.userId === stylist.id, raise.json)
  check('…and their balance says so', n2(raise.json?.owed) === 10, raise.json?.owed)

  const [row] = await rows(sql`SELECT amount, reimbursed, repaid_amount FROM expense WHERE id = ${id}`)
  check('the claim is untouched — it was paid what it was paid',
    n2(row?.amount) === 50 && row?.reimbursed === true && n2(row?.repaid_amount) === 0, row)

  const list = await asMgr('GET', '/api/expenses/owed')
  const person = (list.json?.people || []).find((p: any) => p.userId === stylist.id)
  check('the owed list names them', !!person && n2(person.owed) === 10, list.json)
  check('…with a name rather than an id', /owedsty/.test(String(person?.name || '')), person?.name)
  check('…and the balance explains itself', /Receipt was 40/.test(String(person?.history?.[0]?.reason)), person?.history?.[0])
  check('…and the total is the sum of everybody', n2(list.json?.total) === 10, list.json?.total)

  // A stylist sees their own, and only their own.
  const mine = await asSty('GET', '/api/expenses/owed')
  check('a stylist can see what the shop says they owe', n2(mine.json?.total) === 10, mine.json)
  check('…and nobody else\'s', (mine.json?.people || []).every((p: any) => p.userId === stylist.id), mine.json?.people?.length)
  const theirs = await as(other)('GET', '/api/expenses/owed')
  check('…while somebody who owes nothing sees nothing', n2(theirs.json?.total) === 0 && (theirs.json?.people || []).length === 0, theirs.json)
}

// ══════════ what it refuses ═════════════════════════════════════════════════════════════════════
{
  const unpaid = await claim(stylist, 'Owed probe unpaid', 20, false)
  const early = await asMgr('POST', `/api/expenses/${unpaid.id ?? unpaid}/overpayment`, { amount: 5, reason: 'Nothing was paid' })
  check('nobody can be over-paid on a claim that was never paid',
    early.status === 409 && String(early.json?.code) === 'not_reimbursed', { status: early.status, body: early.json })

  const paid = await claim(stylist, 'Owed probe caps', 30)
  const toomuch = await asMgr('POST', `/api/expenses/${paid}/overpayment`, { amount: 40, reason: 'More than the claim' })
  check('…nor for more than the claim was paid', toomuch.status === 400 && String(toomuch.json?.code) === 'exceeds_paid',
    { status: toomuch.status, body: toomuch.json })
  await asMgr('POST', `/api/expenses/${paid}/overpayment`, { amount: 20, reason: 'Twenty of it' })
  const rest = await asMgr('POST', `/api/expenses/${paid}/overpayment`, { amount: 15, reason: 'And fifteen more' })
  check('…nor twice over, past what is left of that payment', rest.status === 400 && n2(rest.json?.alreadyOwed) === 20,
    { status: rest.status, body: rest.json })

  const byStylist = await asSty('POST', `/api/expenses/${paid}/overpayment`, { amount: 1, reason: 'By the claimant' })
  check('the person who was paid cannot raise it against themselves', byStylist.status === 403, byStylist.status)
  const noReason = await asMgr('POST', `/api/expenses/${paid}/overpayment`, { amount: 1 })
  check('…and it needs a reason, in English', noReason.status === 400 && /why the money came back|explain itself/i.test(String(noReason.json?.error)), noReason.json?.error)
}

// ══════════ settling: cash ══════════════════════════════════════════════════════════════════════
{
  const before = await owedFor(stylist)
  check('there is a balance to settle', before > 0, before)
  const part = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, { amount: 5, reason: 'Five back in cash', via: 'cash' })
  check('cash settles part of it', part.status === 200 && n2(part.json?.owed) === n2(before - 5), { status: part.status, body: part.json })
  const toomuch = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, { amount: before, reason: 'More than is owed', via: 'cash' })
  check('…and more than is owed is refused', toomuch.status === 409 && /less than/.test(String(toomuch.json?.error)), toomuch.json)
  const byStylist = await asSty('POST', `/api/expenses/owed/${stylist.id}/settle`, { amount: 1, reason: 'Settling my own', via: 'cash' })
  check('…and only a manager settles', byStylist.status === 403, byStylist.status)
}

// ══════════ settling: off their next claim ═════════════════════════════════════════════════════
{
  const owedNow = await owedFor(stylist)
  const nextClaim = await claim(stylist, 'Owed probe next claim', 60, false)
  const unapproved = await as(stylist)('POST', '/api/expenses', { category: 'stock', description: 'Owed probe unapproved', amount: 60, date: yesterday, reimbursable: true })

  const notApproved = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, {
    amount: 5, reason: 'Off an unapproved claim', via: 'offset', againstExpenseId: body(unapproved)?.id,
  })
  check('an offset cannot come off a claim nobody has approved',
    notApproved.status === 409 && String(notApproved.json?.code) === 'approval_required', { status: notApproved.status, body: notApproved.json })

  const wrongPerson = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, {
    amount: 5, reason: 'Off somebody else\'s claim', via: 'offset', againstExpenseId: await claim(other, 'Owed probe other person', 40, false),
  })
  check('…nor off somebody else\'s claim', wrongPerson.status === 400 && String(wrongPerson.json?.code) === 'wrong_claimant',
    { status: wrongPerson.status, body: wrongPerson.json })

  const off = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, {
    amount: 5, reason: 'Held back from their next claim', via: 'offset', againstExpenseId: nextClaim,
  })
  check('it comes off an approved, unpaid claim of theirs', off.status === 200, { status: off.status, body: off.json })
  check('…their balance drops', n2(off.json?.owed) === n2(owedNow - 5), { before: owedNow, after: off.json?.owed })
  check('…the claim is settled in full on the record', n2(off.json?.claimAmount) === 60, off.json)
  check('…and the record says how much of it was actually cash', n2(off.json?.paidInCash) === 55, off.json)
  const [claimRow] = await rows(sql`SELECT amount, reimbursed, applied_to_owed FROM expense WHERE id = ${nextClaim}`)
  check('…with the held-back part named on the claim itself, so it does not read as a short payment',
    n2(claimRow?.amount) === 60 && claimRow?.reimbursed === true && n2(claimRow?.applied_to_owed) === 5, claimRow)

  const again = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, {
    amount: 1, reason: 'Off the same claim twice', via: 'offset', againstExpenseId: nextClaim,
  })
  check('…and the same claim cannot pay twice — it has been paid', again.status === 409 && String(again.json?.code) === 'already_reimbursed',
    { status: again.status, body: again.json })
}

// ══════════ settling: off their pay, which is off until the business says otherwise ═════════════
{
  const owedNow = await owedFor(stylist)
  check('there is still something owed', owedNow > 0, owedNow)

  const blocked = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, {
    amount: 1, reason: 'Off their pay', via: 'payroll', authorisation: 'She agreed in the staff room',
  })
  check('a payroll deduction is refused until the business switches it on',
    blocked.status === 409 && String(blocked.json?.code) === 'payroll_deductions_off', { status: blocked.status, body: blocked.json })
  check('…and the refusal says where the switch is, and mentions written authorisation',
    /Settings/.test(String(blocked.json?.error)) && /written authorisation/i.test(String(blocked.json?.error)), blocked.json?.error)
  const listOff = await asMgr('GET', '/api/expenses/owed')
  check('…and the screen is told so it can explain rather than offer a dead option',
    listOff.json?.payrollDeductionsAllowed === false, listOff.json?.payrollDeductionsAllowed)

  // The owner switches it on.
  await db.execute(sql`UPDATE company SET settings = '{"allowPayrollDeductions": true}'::json WHERE id = ${co.id}`)
  const listOn = await asMgr('GET', '/api/expenses/owed')
  check('once it is on, the screen knows', listOn.json?.payrollDeductionsAllowed === true, listOn.json?.payrollDeductionsAllowed)

  const noAuth = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, { amount: 1, reason: 'Off their pay', via: 'payroll' })
  check('…but it still refuses without a recorded authorisation',
    noAuth.status === 400 && String(noAuth.json?.code) === 'authorisation_required', { status: noAuth.status, body: noAuth.json })
  check('…saying why, in the words a person would use',
    /verbal say-so/i.test(String(noAuth.json?.error)), noAuth.json?.error)

  const done = await asMgr('POST', `/api/expenses/owed/${stylist.id}/settle`, {
    amount: 2, reason: 'Recovered from the 15 Oct pay run', via: 'payroll', authorisation: 'Signed deduction form, staff file',
  })
  check('with both in place, it comes off', done.status === 200 && n2(done.json?.settled) === 2, { status: done.status, body: done.json })
  const history = (await asMgr('GET', '/api/expenses/owed')).json?.people?.find((p: any) => p.userId === stylist.id)?.history || []
  const payrollRow = history.find((h: any) => h.source === 'payroll_deduction')
  check('…recorded as a payroll deduction', !!payrollRow, history.map((h: any) => h.source))
  check('…carrying the authorisation, because that is the whole point of asking for it',
    /Signed deduction form/.test(String(payrollRow?.reason)), payrollRow?.reason)
}

// ══════════ the pay run shows it, or the money is recovered twice ══════════════════════════════
{
  // Hours to be paid for, on the same day as the deduction.
  const logged = await asSty('POST', '/api/time', { hours: 4, date: yesterday, description: 'Owed probe shift', hourlyRate: 20 })
  check('hours are logged', logged.status === 200 || logged.status === 201, { status: logged.status, body: logged.json })

  // A window either side of the entry rather than exactly its day: a pay period is measured in the
  // SHOP's days (storeDayRange), so a date stored at UTC midnight sits in the previous shop day west
  // of Greenwich. That boundary has its own test (t28-evening-dates); this one is about the
  // deduction being reported, and pinning it to a single day would make it fail for the other reason.
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const run = await asMgr('GET', `/api/payroll/summary?startDate=${from}&endDate=${to}`)
  check('the pay run answers', run.status === 200, { status: run.status, body: run.json })
  const line = (run.json?.users || []).find((u: any) => u.user?.id === stylist.id)
  check('…with what they earned', n2(line?.totalPay) === 80, line)
  check('…what was recovered from it', n2(line?.deductions) === 2, line)
  check('…and what is actually left to pay', n2(line?.netPay) === 78, line)
  check('…earned is never quietly adjusted — it is still hours × rate', n2(line?.totalPay) === 80, line)
  check('…and what they still owe, so the shop can see whether to keep recovering', n2(line?.stillOwed) > 0, line?.stillOwed)
  check('the totals add up', n2(run.json?.totals?.pay) - n2(run.json?.totals?.deductions) === n2(run.json?.totals?.net), run.json?.totals)

  /**
   * …and a pay run never reports a negative wage.
   *
   * I found this by reading the screen against the API rather than by testing: earned $0.00,
   * recovered −$2.00, to pay **−$2.00**. Nobody pays a negative wage, and that is the column
   * somebody copies into a bank transfer. It is not only a probe artefact — a light week, or
   * somebody leaving mid-period, lands here for real.
   */
  const bigDebt = await claim(other, 'Owed probe big debt', 100)
  await asMgr('POST', `/api/expenses/${bigDebt}/overpayment`, { amount: 90, reason: 'Ninety over' })
  await db.execute(sql`UPDATE company SET settings = '{"allowPayrollDeductions": true}'::json WHERE id = ${co.id}`)
  await asMgr('POST', `/api/expenses/owed/${other.id}/settle`, {
    amount: 90, reason: 'Recovered from a light week', via: 'payroll', authorisation: 'Signed form',
  })
  // They earned nothing in the window, so nothing could actually come off the run.
  const run2 = await asMgr('GET', `/api/payroll/summary?startDate=${from}&endDate=${to}`)
  const poor = (run2.json?.users || []).find((u: any) => u.user?.id === other.id)
  if (!poor) {
    // No hours at all in the window means no line, which is correct — log an hour and look again.
    await as(other)('POST', '/api/time', { hours: 1, date: yesterday, description: 'Owed probe one hour', hourlyRate: 10 })
  }
  const run3 = await asMgr('GET', `/api/payroll/summary?startDate=${from}&endDate=${to}`)
  const line3 = (run3.json?.users || []).find((u: any) => u.user?.id === other.id)
  check('somebody owing more than they earned is never paid a negative wage',
    n2(line3?.netPay) >= 0, { earned: line3?.totalPay, recovered: line3?.deductions, toPay: line3?.netPay })
  check('…and what could NOT come off the run is reported rather than folded away',
    n2(line3?.unrecovered) === n2(n2(line3?.deductions) - n2(line3?.totalPay)),
    { recovered: line3?.deductions, earned: line3?.totalPay, unrecovered: line3?.unrecovered })
  check('…the totals never go negative either', n2(run3.json?.totals?.net) >= 0, run3.json?.totals)
}

// ══════════ money arriving clears the debt, so the two cannot disagree ═════════════════════════
{
  const id = await claim(other, 'Owed probe repay clears', 40)
  await asMgr('POST', `/api/expenses/${id}/overpayment`, { amount: 10, reason: 'Ten over' })
  check('they owe ten', await owedFor(other) === 10, await owedFor(other))

  const back = await asMgr('POST', `/api/expenses/${id}/repayment`, { amount: 10, reason: 'Handed back in cash' })
  check('recording the money as returned also clears the balance',
    back.status === 200 && n2(back.json?.clearedOwed) === 10, { status: back.status, cleared: back.json?.clearedOwed })
  check('…so the balance and the claim agree', await owedFor(other) === 0, await owedFor(other))
  const [row] = await rows(sql`SELECT repaid_amount FROM expense WHERE id = ${id}`)
  check('…and the claim records what came back', n2(row?.repaid_amount) === 10, row)

  // A repayment with no debt behind it is still the ordinary case this endpoint was built for.
  const plain = await claim(other, 'Owed probe plain repayment', 25)
  const alone = await asMgr('POST', `/api/expenses/${plain}/repayment`, { amount: 5, reason: 'No debt was ever raised' })
  check('a repayment with no balance behind it still works', alone.status === 200 && !alone.json?.clearedOwed,
    { status: alone.status, cleared: alone.json?.clearedOwed })
}

// ══════════ writing it off is still a decision somebody made ═══════════════════════════════════
{
  const id = await claim(other, 'Owed probe write off', 30)
  await asMgr('POST', `/api/expenses/${id}/overpayment`, { amount: 3, reason: 'Three over, not worth chasing' })
  const off = await asOwner('POST', `/api/expenses/owed/${other.id}/settle`, { amount: 3, reason: 'Too small to chase', via: 'write_off' })
  check('it can be written off', off.status === 200 && n2(off.json?.owed) === 0, { status: off.status, body: off.json })
  const history = (await asMgr('GET', '/api/expenses/owed?all=1')).json
  const ledger = await rows(sql`SELECT source, reason FROM staff_account_entry WHERE user_id = ${other.id} AND source = 'write_off'`)
  check('…and it is written down as a write-off, with the reason', ledger.length === 1 && /Too small/.test(String(ledger[0]?.reason)), ledger)
  check('…and they no longer appear as owing anything', !(history?.people || []).some((p: any) => p.userId === other.id), history?.people)
}

// ══════════ one ledger, one lock ════════════════════════════════════════════════════════════════
{
  const store = strip(await Bun.file(`${ROOT}packages/tenant-backend/src/team/staffBalance.ts`).text())
  check('the staff balance reuses the client-balance ledger rather than being a second one',
    /createAccountBalanceStore\(table, tableName, anchorTableName, \{ column: 'user_id', field: 'userId' \}\)/.test(store), null)
  const shared = strip(await Bun.file(`${ROOT}packages/tenant-backend/src/clients/accountBalance.ts`).text())
  check('…and that ledger still locks the SUBJECT row before it reads — the six-way race fix',
    /FROM \$\{anchor\} WHERE id = \$\{contactId\} AND company_id = \$\{companyId\} FOR UPDATE/.test(shared), null)
  check('…with the identifiers quoted, because one of the anchors is the reserved word `user`',
    /const quoted = \(n: string\) => sql\.raw\(`"\$\{n\}"`\)/.test(shared), null)
  check('settling takes the lock first', /const before = await owed\(tx, input\.companyId, input\.userId, true\)/.test(store), null)
}

// ══════════ and it is on the screen ═════════════════════════════════════════════════════════════
{
  const page = strip((await Bun.file(`${ROOT}packages/tenant-ui/src/people/ExpensesPage.tsx`).text()).replace(/\r\n/g, '\n'))
  check('one control asks the real question instead of two that sound alike',
    /label: 'Correct an over-payment'/.test(page) && !/label: 'Record repayment'/.test(page), null)
  check('…and the answer decides which door it goes through',
    /const path = repayForm\.settled \? 'repayment' : 'overpayment'/.test(page), null)
  check('the owed panel exists', /api\.get\('\/api\/expenses\/owed'\)/.test(page), null)
  check('…and hides itself when nobody owes anything', /owed && owed\.people\.length > 0 && \(/.test(page), null)
  check('settling offers all four routes', ['cash', 'offset', 'payroll', 'write_off'].every((v) => new RegExp(`value="${v}"`).test(page)), null)
  check('…with the payroll one disabled and explained when the setting is off',
    /disabled=\{!owed\?\.payrollDeductionsAllowed\}/.test(page) && /switched off in Settings/.test(page), null)
  check('…and the offset asking which claim', /Which claim \*/.test(page) && /offsettable\(settleFor\)/.test(page), null)
  check('…and the payroll route asking who authorised it', /Authorised by \*/.test(page), null)

  const time = strip((await Bun.file(`${ROOT}packages/tenant-ui/src/people/TimePage.tsx`).text()).replace(/\r\n/g, '\n'))
  check('the pay run finally has a screen — the report existed for rounds with none',
    /api\.get\('\/api\/payroll\/summary'/.test(time), null)
  check('…showing what was recovered and what is left to pay',
    /\{money\(u\.netPay \?\? u\.totalPay\)\}/.test(time) && /money\(u\.deductions\)/.test(time), null)
  check('…and what they still owe', /money\(u\.stillOwed\)/.test(time), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
