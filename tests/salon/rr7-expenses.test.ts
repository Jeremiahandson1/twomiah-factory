// crm-salon — RR7 X1 / X2 / X3 / X4 / X5 / X6: the expense sheet, one round on.
//
// RR6 closed the authority chain. RR7 found the module still unusable for a salon, and the reason
// was a vocabulary split I left behind:
//
//   X1 (High)  the server accepts stock / retail / tools / rent / … and the FORM offered the shared
//              contractor list — materials / equipment / labor / travel / other. Only travel and
//              other existed on both sides, so pressing Save on the form exactly as it opened
//              answered 400, and an expense stored as `tools` opened in the Edit dialog reading
//              "Materials", one Save away from being quietly relabelled. The screen now asks the
//              server that validates it, so a vertical customising the list gets the form for free.
//   X2         E2 fixed "sent is not changed" for TIME and I did not carry it to expenses. Pressing
//              Save on an approved claim without touching anything ended the approval, and "80" and
//              "80.00" both did it.
//   X3         I hid Approve on your own claim for EVERY role, including the owner the server lets
//              approve their own — a one-person salon had a claim it was allowed to approve and no
//              way to.
//   X4         Delete was offered on a reimbursed expense, where it can only ever answer 409; and
//              Approve sat below Edit under a comment claiming it came first.
//   X5         E7 scoped the LIST to your own claims and left /summary and /:id alone, so a stylist
//              could still read the salon's whole spend; and DELETE checked the payment state before
//              ownership, answering a question about a record the reader may not see.
//   X6         both 409 messages said "add a new expense for the difference", which is impossible in
//              one of the two directions: a negative amount is refused, so overpayment had no route.
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
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'RR7 Salon', slug: 'rr7-expenses', email: 'rr7@test.local', state: 'OH',
  enabledFeatures: ['time_tracking', 'expense_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'rr7own')
const manager = await mkUser('manager', 'rr7mgr')
const stylist = await mkUser('field', 'rr7sty')
const stylist2 = await mkUser('field', 'rr7sty2')

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
const asOwner = as(owner), asMgr = as(manager), asSty = as(stylist), asSty2 = as(stylist2)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const body = (r: any) => r.json?.data || r.json
const addExpense = async (who: any, desc: string, amount = 20, extra: Record<string, unknown> = {}) => {
  const r = await who('POST', '/api/expenses', { category: 'stock', description: desc, amount, date: yesterday, reimbursable: true, ...extra })
  return { ...r, id: body(r)?.id }
}

// ══════════ X1 · one list, and it is the server's ═══════════════════════════════════════════════
{
  const res = await asOwner('GET', '/api/expenses/categories')
  const cats = (res.json?.categories || []) as Array<{ value: string; label: string }>
  check('X1: the form can ASK what this salon is allowed to record', res.status === 200 && cats.length > 0,
    { status: res.status, body: res.json })
  check('X1: …and gets the salon\'s own words, not the contractor default',
    cats.some((c) => c.value === 'stock') && cats.some((c) => c.value === 'tools') && !cats.some((c) => c.value === 'materials'),
    cats.map((c) => c.value))

  // Every value it offers must be a value POST accepts — that is the whole point of asking.
  for (const c of cats) {
    const made = await addExpense(asOwner, `RR7 cat ${c.value}`, 5, { category: c.value })
    check(`X1: the offered category "${c.value}" is accepted on save`, made.status === 200 || made.status === 201,
      { status: made.status, body: made.json })
  }
  // …and the word the old form opened on is still refused, which is what made X1 a High.
  const contractorWord = await addExpense(asOwner, 'RR7 old default', 5, { category: 'materials' })
  check('X1: the form\'s OLD first option is refused by this salon — pressing Save used to 400',
    contractorWord.status === 400, { status: contractorWord.status, body: contractorWord.json })

  check('X1: …and a picker entry reads as a person would say it', cats.find((c) => c.value === 'stock')?.label === 'Stock & colour',
    cats.map((c) => c.label))
  check('X1: …with title-casing where no label is configured', cats.find((c) => c.value === 'utilities')?.label === 'Utilities',
    cats.map((c) => c.label))

  // A stylist records expenses too, so a stylist has to be able to read the list.
  const styCats = await asSty('GET', '/api/expenses/categories')
  check('X1: a stylist can read the list — they are the ones filling the form in',
    styCats.status === 200 && (styCats.json?.categories || []).length === cats.length, { status: styCats.status })

  // And /categories has to be registered ABOVE /:id, or Hono hands it to the by-id route.
  const src = stripComments((await Bun.file(`${ROOT}packages/tenant-backend/src/expenses/expenses.ts`).text()).replace(/\r\n/g, '\n'))
  check('X1: /categories is registered before /:id, so it is not read as an id',
    src.indexOf("app.get('/categories'") > 0 && src.indexOf("app.get('/categories'") < src.indexOf("app.get('/:id'"),
    { categories: src.indexOf("app.get('/categories'"), byId: src.indexOf("app.get('/:id'") })
}
{
  // The screen half. The 400 was only half the finding: the edit dialog RELABELLED a stored value.
  const page = (await Bun.file(`${ROOT}packages/tenant-ui/src/people/ExpensesPage.tsx`).text()).replace(/\r\n/g, '\n')
  const code = stripComments(page)
  check('X1: the screen fetches the list from the server that validates it',
    /api\.get\('\/api\/expenses\/categories'\)/.test(code), null)
  check('X1: …and uses it for the picker in BOTH dialogs — one <select> serves Add and Edit',
    /\{formCategories\.map\(/.test(code) && !/\{categories\.map\(\(c\) => <option/.test(code), null)
  check('X1: …falling back to the configured list when the fetch fails, rather than emptying the form',
    /serverCategories \|\| config\?\.categories \|\| DEFAULT_EXPENSE_CATEGORIES/.test(code), null)
  check('X1: …and keeping a stored value the list no longer has, so Edit shows what is on the record',
    /editing && form\.category && !categories\.some\(\(c\) => c\.value === form\.category\)/.test(code), null)
  check('X1: …only asked once, not on every page change', /\}, \[api\]\)/.test(code), null)
}

// ══════════ X2 · a save is not a change ═════════════════════════════════════════════════════════
{
  const made = await addExpense(asSty, 'RR7 approved claim', 80)
  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  const [before] = await rows(sql`SELECT approved FROM expense WHERE id = ${made.id}`)
  check('X2: the claim starts approved', before?.approved === true, before)

  // What the Edit dialog actually PUTs: every field back, the amount as a string.
  const resend = await asMgr('PUT', `/api/expenses/${made.id}`, {
    date: yesterday, category: 'stock', description: 'RR7 approved claim (receipt attached)', amount: '80.00', reimbursable: true,
  })
  check('X2: a save carrying the SAME amount keeps the approval — every edit used to cost one',
    resend.status === 200 && body(resend)?.approved === true, { status: resend.status, body: resend.json })
  check('X2: …and does not claim it removed an approval it kept', !(body(resend)?.warnings || []).length, resend.json?.warnings)

  const sameDay = await asMgr('PUT', `/api/expenses/${made.id}`, { date: `${yesterday}T09:30:00.000Z` })
  check('X2: …and the same DAY sent as a timestamp is the same day', body(sameDay)?.approved === true, sameDay.json)

  const real = await asMgr('PUT', `/api/expenses/${made.id}`, { amount: 95 })
  check('X2: a REAL change to the amount still ends the approval', body(real)?.approved === false, real.json)
  check('X2: …and says so, so nobody thinks it is still vouched for',
    (body(real)?.warnings || []).some((w: string) => /approv/i.test(w)), real.json?.warnings)

  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  const tax = await asMgr('PUT', `/api/expenses/${made.id}`, { taxAmount: 7.6 })
  check('X2: changing the TAX ends it too — it is part of what was claimed', body(tax)?.approved === false, tax.json)
  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  const sameTax = await asMgr('PUT', `/api/expenses/${made.id}`, { taxAmount: '7.60' })
  check('X2: …while re-sending the same tax keeps it', body(sameTax)?.approved === true, sameTax.json)

  // The same comparison decides the REIMBURSED refusal, so a reimbursed row is still editable
  // everywhere except the money.
  const paid = await addExpense(asSty, 'RR7 paid claim', 24.5)
  await asMgr('POST', `/api/expenses/${paid.id}/approve`)
  await asMgr('POST', `/api/expenses/${paid.id}/reimburse`)
  const note = await asMgr('PUT', `/api/expenses/${paid.id}`, {
    date: yesterday, category: 'stock', description: 'RR7 paid claim — receipt 4471', amount: '24.50', reimbursable: true,
  })
  check('X2: a reimbursed claim can still have its description fixed', note.status === 200, { status: note.status, body: note.json })
  const [kept] = await rows(sql`SELECT amount, reimbursed FROM expense WHERE id = ${paid.id}`)
  check('X2: …and the figure that was paid is untouched', Number(kept?.amount) === 24.5 && kept?.reimbursed === true, kept)
  const rewrite = await asMgr('PUT', `/api/expenses/${paid.id}`, { amount: 500 })
  check('X2: …but the figure itself is still refused', rewrite.status === 409, { status: rewrite.status, body: rewrite.json })
}

// ══════════ X5 · every door scoped the same way ═════════════════════════════════════════════════
{
  const mine = await addExpense(asSty, 'RR7 sty own', 13)
  const theirs = await addExpense(asSty2, 'RR7 other sty', 200)

  const mgrSummary = await asMgr('GET', '/api/expenses/summary')
  const stySummary = await asSty('GET', '/api/expenses/summary')
  check('X5: a manager still sees the salon\'s whole spend', Number(mgrSummary.json?.total) > Number(stySummary.json?.total),
    { manager: mgrSummary.json?.total, stylist: stySummary.json?.total })
  const [ownSum] = await rows(sql`SELECT COALESCE(SUM(amount), 0) AS s FROM expense WHERE submitted_by_id = ${stylist.id}`)
  check('X5: a stylist\'s summary is only their own claims — it used to be the whole salon\'s',
    Math.abs(Number(stySummary.json?.total) - Number(ownSum?.s)) < 0.005, { summary: stySummary.json?.total, ownRows: ownSum?.s })
  check('X5: …and the colleague\'s $200 is not in it', Number(stySummary.json?.total) < 200, stySummary.json)

  const own = await asSty('GET', `/api/expenses/${mine.id}`)
  check('X5: …and they can still open their own', own.status === 200, { status: own.status, body: own.json })
  const peek = await asSty('GET', `/api/expenses/${theirs.id}`)
  check('X5: …but not read a colleague\'s by id', peek.status === 404, { status: peek.status, body: peek.json })
  check('X5: …and the refusal does not describe the row they may not see',
    !/200|other sty/.test(JSON.stringify(peek.json)), peek.json)

  // Ordering: ownership is decided BEFORE anything about the record is revealed.
  const paid = await addExpense(asSty2, 'RR7 other sty paid', 60)
  await asMgr('POST', `/api/expenses/${paid.id}/approve`)
  await asMgr('POST', `/api/expenses/${paid.id}/reimburse`)
  const del = await asSty('DELETE', `/api/expenses/${paid.id}`)
  check('X5: deleting a colleague\'s reimbursed claim reads as not found, not "already reimbursed"',
    del.status === 404 && !/reimbursed/i.test(String(del.json?.error)), { status: del.status, body: del.json })
  const [survives] = await rows(sql`SELECT id FROM expense WHERE id = ${paid.id}`)
  check('X5: …and it is still there', !!survives?.id, survives)

  const ownApproved = await addExpense(asSty, 'RR7 sty own approved', 8)
  await asMgr('POST', `/api/expenses/${ownApproved.id}/approve`)
  const late = await asSty('DELETE', `/api/expenses/${ownApproved.id}`)
  check('X5: their own APPROVED claim is a manager\'s to remove, and says so', late.status === 403,
    { status: late.status, body: late.json })
  const own2 = await asSty('DELETE', `/api/expenses/${mine.id}`)
  check('X5: …while their own unapproved one is still theirs to delete', own2.status === 204 || own2.status === 200, own2.status)
}

// ══════════ X6 · advice that works in both directions ═══════════════════════════════════════════
{
  const made = await addExpense(asSty, 'RR7 overpaid', 50)
  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  await asMgr('POST', `/api/expenses/${made.id}/reimburse`)

  // The premise of the finding: there is genuinely no way to enter the other direction.
  const negative = await addExpense(asMgr, 'RR7 repayment', -10)
  check('X6: a negative amount really is refused, so "the difference" was impossible one way',
    negative.status === 400 && /greater than 0/i.test(String(negative.json?.error)), { status: negative.status, body: negative.json })

  for (const [what, r] of [
    ['editing', await asMgr('PUT', `/api/expenses/${made.id}`, { amount: 40 })],
    ['deleting', await asMgr('DELETE', `/api/expenses/${made.id}`)],
  ] as Array<[string, any]>) {
    const msg = String(r.json?.error || '')
    check(`X6: ${what} a reimbursed claim is still refused`, r.status === 409, { status: r.status, body: r.json })
    check(`X6: …and no longer says only "add a new expense for the difference"`, !/for the difference/i.test(msg), msg)
    check(`X6: …it names the shortfall case`, /shortfall/i.test(msg), msg)
    // This used to assert the ADMISSION — "this sheet cannot record a repayment yet, settle it
    // outside the expense sheet" — which was the honest answer while there was nowhere to record
    // one. RR8 asked for the real thing and it now exists, so the advice names it. The assertion
    // moves with the product rather than pinning it to a sentence that has stopped being true;
    // tests/salon/expense-repayment.test.ts is where the door itself is proven.
    check(`X6: …and points the reader at the repayment, which now exists`,
      /Record repayment/.test(msg) && !/cannot record a repayment/i.test(msg), msg)
  }
}

// ══════════ X3 / X4 · the row menu offers what will work, in the order it happens ═══════════════
{
  const page = (await Bun.file(`${ROOT}packages/tenant-ui/src/people/ExpensesPage.tsx`).text()).replace(/\r\n/g, '\n')
  const code = stripComments(page)

  check('X3: an owner or admin IS offered Approve on their own claim — the server allows it',
    /const ownApprovalOk = \['owner', 'admin'\]\.includes/.test(code)
    && /const canApprove = \(r: Expense\) => manager && \(ownApprovalOk \|\| !isMine\(r\)\)/.test(code), null)
  check('X3: …and both approve-side actions use that one rule',
    // Still exactly two, and still the SAME rule in both — which is the whole point of X3. T43
    // added `maySettle &&` in front of each, so the match no longer starts at canApprove.
    (code.match(/show: \(r\) => [^\n]*canApprove\(r\)/g) || []).length === 2, (code.match(/show: \(r\) => [^\n]*canApprove\(r\)/g) || []).length)
  check('X3: …while a manager is still not the second person for their own claim',
    /!isMine\(r\)/.test(code), null)

  const at = (label: string) => code.indexOf(`label: '${label}'`)
  check('X4: Approve really does come before Edit now — the comment said so and the array did not',
    at('Approve') > 0 && at('Approve') < at('Edit'), { approve: at('Approve'), edit: at('Edit') })
  check('X4: …and Mark reimbursed follows Approve, which is the order it happens in',
    at('Approve') < at('Mark reimbursed') && at('Mark reimbursed') < at('Edit'), { reimbursed: at('Mark reimbursed') })
  check('X4: Delete is not offered on a reimbursed claim, where it can only answer 409',
    // `mayRemove &&` in front since T43 (expenses:delete). The property is that the predicate
    // still refuses a reimbursed claim, where the server can only answer 409.
    /label: 'Delete'[^\n]*show: \(r\) => [^\n]*!r\.reimbursed/.test(code), null)
  check('X4: …nor Edit on an approved claim a stylist may not change',
    // `maySettle &&` in front since T43, and the pair is now parenthesised so the && binds the
    // way it reads. The property is unchanged: a manager always, or your own claim until approval.
    /label: 'Edit'[^\n]*show: \(r\) => [^\n]*manager \|\| !r\.approved/.test(code), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
