// crm-salon — RR6 N1 / E1 / E2 / E3 / E4 / E5 / E7: the same money, through a different door.
//
// RR4 closed the approval rule for TIME. RR6 found the whole chain still open for EXPENSES, and the
// reason was one missing column: an expense had no submitter, so the server could not tell whose it
// was. Three findings fell out of that, and one of them is a HIGH that I created:
//
//   N1 (High)  I gave the server "an expense must be approved before it can be reimbursed" and gave
//              the screen no way to approve. Mark reimbursed answered 409 and there was no approve
//              anywhere in the product. A server rule with no screen to satisfy it is a module that
//              cannot be used — rule 3, and I broke it while fixing M4.
//   E1         a manager approved AND reimbursed their own $45 expense
//   E7         a stylist saw every expense in the company, and the Edit and Delete offered on their
//              own row always answered 403
//
// …plus two edges where the rule was right and the arithmetic around it was not:
//
//   E2         the Time Edit dialog PUTs the whole entry back, so adding a word to a description
//              arrived carrying hours: 2.5 on a 2.50-hour entry and ended the approval. "Hours were
//              sent" is not "hours changed" — the obstacle my own brief warned against.
//   E3         hourlyRate was not part of the figure, and rate × hours is the pay.
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
  name: 'RR6 Salon', slug: 'rr6-expenses', email: 'rr6@test.local', state: 'OH',
  enabledFeatures: ['time_tracking', 'expense_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'rr6own')
const manager = await mkUser('manager', 'rr6mgr')
const manager2 = await mkUser('manager', 'rr6mgr2')
const stylist = await mkUser('field', 'rr6sty')
const stylist2 = await mkUser('field', 'rr6sty2')

const app = new Hono()
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.route('/api/time', (await import('./src/routes/time.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner), asMgr = as(manager), asMgr2 = as(manager2), asSty = as(stylist), asSty2 = as(stylist2)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const addExpense = (who: any, desc: string, amount = 20) =>
  who('POST', '/api/expenses', { category: 'stock', description: desc, amount, date: yesterday, reimbursable: true })

// ══════════ E1 · an expense knows who claimed it ════════════════════════════════════════════════
{
  const made = await addExpense(asMgr, 'RR6 mgr self-paid', 45)
  const id = (made.json?.data || made.json)?.id
  check('an expense is created', (made.status === 200 || made.status === 201) && !!id, { status: made.status, body: made.json })

  const [row] = await rows(sql`SELECT submitted_by_id FROM expense WHERE id = ${id}`)
  check('…and records WHO submitted it — the column that did not exist', row?.submitted_by_id === manager.id, row)

  const self = await asMgr('POST', `/api/expenses/${id}/approve`)
  check('a manager approving their OWN expense is refused — it used to answer 200',
    self.status === 403 && String(self.json?.code) === 'self_approval', { status: self.status, body: self.json })

  const selfPay = await asMgr('POST', `/api/expenses/${id}/reimburse`)
  check('…and reimbursing their own is refused too — the second door', selfPay.status === 403, { status: selfPay.status, body: selfPay.json })

  const byPeer = await asMgr2('POST', `/api/expenses/${id}/approve`)
  check('a DIFFERENT manager can approve it', byPeer.status === 200, { status: byPeer.status, body: byPeer.json })
  const [after] = await rows(sql`SELECT approved, approved_by_id, approved_at FROM expense WHERE id = ${id}`)
  check('…and the approver is recorded', after?.approved_by_id === manager2.id && !!after?.approved_at, after)

  const paid = await asMgr2('POST', `/api/expenses/${id}/reimburse`)
  check('…and can reimburse it', paid.status === 200, { status: paid.status })
  const [pd] = await rows(sql`SELECT reimbursed_by_id FROM expense WHERE id = ${id}`)
  check('…with who paid it recorded', pd?.reimbursed_by_id === manager2.id, pd)
}
{
  // The owner carve-out, same as time: nobody above them to ask.
  const made = await addExpense(asOwner, 'RR6 owner own', 30)
  const id = (made.json?.data || made.json)?.id
  const self = await asOwner('POST', `/api/expenses/${id}/approve`)
  check('an OWNER may approve their own expense', self.status === 200, { status: self.status, body: self.json })
}

// ══════════ N1 · the screen can approve, and only offers what will work ═════════════════════════
{
  const made = await addExpense(asSty, 'RR6 stylist claim', 18)
  const id = (made.json?.data || made.json)?.id

  const early = await asMgr('POST', `/api/expenses/${id}/reimburse`)
  check('reimbursing before approval is still refused', early.status === 409, { status: early.status, body: early.json })

  const appr = await asMgr('POST', `/api/expenses/${id}/approve`)
  check('a manager can approve a stylist\'s claim — the step that had no screen at all', appr.status === 200,
    { status: appr.status, body: appr.json })
  const paid = await asMgr('POST', `/api/expenses/${id}/reimburse`)
  check('…and then reimburse it', paid.status === 200, { status: paid.status })
}
{
  // The screen half: the actions have to exist and be offered only where they can succeed.
  const root = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
  const page = (await Bun.file(`${root}packages/tenant-ui/src/people/ExpensesPage.tsx`).text()).replace(/\r\n/g, '\n')
  check('N1: the Expenses screen has an Approve action at all', /label: 'Approve'/.test(page), null)
  check('N1: …that calls the approve endpoint', /\/approve`\)/.test(page), null)
  check('N1: …shown only to a manager, on an unapproved claim that is not their own',
    /label: 'Approve'[^\n]*show: \(r\) => manager && !r\.approved && !isMine\(r\)/.test(page), null)
  check('N1: Mark reimbursed is hidden until the claim is APPROVED, so the 409 is unreachable',
    /label: 'Mark reimbursed'[^\n]*!!r\.approved/.test(page), null)
  check('N1: …and the list shows whether it is approved', /key: 'approved', label: 'Approved'/.test(page), null)
}

// ══════════ E7 · a stylist sees and edits their own ═════════════════════════════════════════════
{
  const mine = await addExpense(asSty, 'RR6 sty own', 9.5)
  const mineId = (mine.json?.data || mine.json)?.id
  await addExpense(asSty2, 'RR6 other stylist', 11)
  await addExpense(asMgr, 'RR6 manager claim', 12)

  const list = await asSty('GET', '/api/expenses')
  const seen = (list.json?.data || []) as any[]
  check('a stylist sees their OWN claims', seen.some((e: any) => e.id === mineId), seen.map((e: any) => e.description))
  check('…and not the rest of the company\'s — they used to see every one',
    !seen.some((e: any) => /other stylist|manager claim|mgr self-paid/.test(String(e.description))), seen.map((e: any) => e.description))

  const fix = await asSty('PUT', `/api/expenses/${mineId}`, { amount: 9.5, description: 'RR6 sty own (corrected)' })
  check('…and can correct their own unapproved claim — Edit used to be offered and always 403',
    fix.status === 200, { status: fix.status, body: fix.json })

  const theirs = (await addExpense(asSty2, 'RR6 not yours', 5)).json
  const theirsId = (theirs?.data || theirs)?.id
  const meddle = await asSty('PUT', `/api/expenses/${theirsId}`, { amount: 500 })
  check('…but not somebody else\'s', meddle.status === 403 || meddle.status === 404, { status: meddle.status, body: meddle.json })

  await asMgr('POST', `/api/expenses/${mineId}/approve`)
  const late = await asSty('PUT', `/api/expenses/${mineId}`, { amount: 40 })
  check('…and not their own once it has been approved', late.status === 403, { status: late.status, body: late.json })

  const managerSees = await asMgr('GET', '/api/expenses')
  check('a manager still sees everything', ((managerSees.json?.data || []) as any[]).length >= 4,
    ((managerSees.json?.data || []) as any[]).length)
}

// ══════════ E4 / E5 · a reimbursed expense is a record of a payment ═════════════════════════════
{
  const made = await addExpense(asSty, 'RR6 paid out', 46)
  const id = (made.json?.data || made.json)?.id
  await asMgr('POST', `/api/expenses/${id}/approve`)
  await asMgr('POST', `/api/expenses/${id}/reimburse`)

  const edit = await asMgr('PUT', `/api/expenses/${id}`, { amount: 500 })
  check('a reimbursed amount still cannot be rewritten', edit.status === 409, { status: edit.status, body: edit.json })
  check('E5: …and the message no longer offers a "reverse" that does not exist',
    !/reverse this one/i.test(String(edit.json?.error)), edit.json?.error)

  const del = await asMgr('DELETE', `/api/expenses/${id}`)
  check('E4: …and it cannot be DELETED either — that removed the record of the payment altogether',
    del.status === 409 && String(del.json?.code) === 'already_reimbursed', { status: del.status, body: del.json })
  const [still] = await rows(sql`SELECT id, amount FROM expense WHERE id = ${id}`)
  check('…the row is still there', !!still?.id && Number(still?.amount) === 46, still)

  // An UNPAID expense is still deletable — the rule is about the payment, not about tidiness.
  const spare = await addExpense(asSty, 'RR6 unpaid', 7)
  const spareId = (spare.json?.data || spare.json)?.id
  const delOk = await asMgr('DELETE', `/api/expenses/${spareId}`)
  check('an unpaid expense can still be deleted', delOk.status === 200 || delOk.status === 204, delOk.status)
}

// ══════════ E2 / E3 · what the approval vouches for ═════════════════════════════════════════════
{
  const made = await asSty('POST', '/api/time', { hours: 2.5, date: yesterday, description: 'RR6 manual log' })
  const id = (made.json?.data || made.json)?.id
  await asMgr('POST', `/api/time/${id}/approve`)

  // E2 — the screen sends the whole entry back on every save.
  const resend = await asMgr('PUT', `/api/time/${id}`, { hours: 2.5, description: 'RR6 manual log (desk)' })
  check('E2: a save carrying the SAME hours keeps the approval — every screen edit used to cost one',
    resend.status === 200 && (resend.json?.data || resend.json)?.approved === true, { status: resend.status, body: resend.json })
  const asString = await asMgr('PUT', `/api/time/${id}`, { hours: '2.50', description: 'RR6 manual log (desk 2)' })
  check('E2: …and "2.50" is the same figure as 2.5', (asString.json?.data || asString.json)?.approved === true, asString.json)
  const sameDay = await asMgr('PUT', `/api/time/${id}`, { date: yesterday })
  check('E2: …and re-sending the same date keeps it too', (sameDay.json?.data || sameDay.json)?.approved === true, sameDay.json)

  // …and a real change still ends it.
  const real = await asMgr('PUT', `/api/time/${id}`, { hours: 6 })
  check('E2: a REAL change to the hours still ends the approval', (real.json?.data || real.json)?.approved === false, real.json)

  // E3 — the rate.
  await asMgr('POST', `/api/time/${id}/approve`)
  const rate = await asMgr('PUT', `/api/time/${id}`, { hourlyRate: 80 })
  check('E3: changing the hourly RATE ends the approval — rate × hours is the pay',
    (rate.json?.data || rate.json)?.approved === false, rate.json)
  check('E3: …and says so', (rate.json?.warnings || []).some((w: string) => /rate/i.test(w)), rate.json?.warnings)

  await asMgr('POST', `/api/time/${id}/approve`)
  const sameRate = await asMgr('PUT', `/api/time/${id}`, { hourlyRate: 80 })
  check('E3: …while re-sending the same rate keeps it', (sameRate.json?.data || sameRate.json)?.approved === true, sameRate.json)
}

// ══════════ E6 · the running label, on a palette that overrides orange ══════════════════════════
{
  const root = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
  const page = (await Bun.file(`${root}packages/tenant-ui/src/people/TimePage.tsx`).text()).replace(/\r\n/g, '\n')
  // tailwind.config.js does `orange: brandPalette` — every orange-* class is the TENANT'S brand hue,
  // so orange-400 measured 3.68:1 on this salon's blue. amber is not overridden.
  check('E6: the running label does not use the overridden orange scale', !/text-orange-\d00">running/.test(page), null)
  check('E6: …it uses amber, which the brand palette leaves alone, with a dark partner',
    /text-amber-700 dark:text-amber-300">running/.test(page), null)

  // N2 — the Approve item is not offered on your own row unless you are owner/admin.
  check('N2: Approve is hidden on your own entry', /ownApprovalOk \|\| r\.userId !== auth\.user\?\.id/.test(page), null)
  check('N2: …with the owner/admin carve-out the server makes', /const ownApprovalOk = \['owner', 'admin'\]/.test(page), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
