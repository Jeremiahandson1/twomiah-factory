// crm-salon — RR8 Y1 / Y2 / Y3 / Y4, and the two observations worth fixing.
//
// Y1 (medium) is the interesting one, and it is the same rule I have now written three times. An
// expense entered WITHOUT "Reimburse me" is a cost the salon has already paid. Approving it says
// "yes, that was a proper expense". Flipping the flag on afterwards turns that same approved row
// into money owed to a person — and the old approval now covers a payout nobody approved. I had
// already decided that changing the amount, the tax or the date ends an approval because it changes
// what is being vouched for; this changes WHO GETS PAID, which is at least as much.
//
// Y4 is its mirror at the other end: a reimbursed claim could be marked "not reimbursable", leaving
// a row that says paid and not-a-claim at once.
//
// Y3: RR7 X5 made GET and DELETE answer 404 for a colleague's expense so a refusal could not be
// used to prove a row exists. PUT still said "You can only change expenses you entered" — 403 for a
// real row, 404 for an imaginary one, which is exactly the tell that was closed everywhere else.
//
// Y2: the form asks the server for its categories (X1) and falls back when that request fails. The
// fallback was the shared contractor list, so one failed request — a cold start is enough — brought
// the X1 High back for that visit.
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
const read = async (p: string) => (await Bun.file(ROOT + p).text()).replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'RR8 Salon', slug: 'rr8-expenses', email: 'rr8@test.local', state: 'OH',
  enabledFeatures: ['time_tracking', 'expense_tracking', 'team'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'rr8own')
const manager = await mkUser('manager', 'rr8mgr')
const stylist = await mkUser('field', 'rr8sty')
const stylist2 = await mkUser('field', 'rr8sty2')

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
const asOwner = as(owner), asMgr = as(manager), asSty = as(stylist), asSty2 = as(stylist2)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
const body = (r: any) => r.json?.data || r.json
const addExpense = async (who: any, desc: string, amount = 20, extra: Record<string, unknown> = {}) => {
  const r = await who('POST', '/api/expenses', { category: 'stock', description: desc, amount, date: yesterday, ...extra })
  return { ...r, id: body(r)?.id }
}

// ══════════ Y1 · turning "Reimburse me" ON ends the approval ════════════════════════════════════
{
  // A cost the salon already paid: no "Reimburse me".
  const made = await addExpense(asSty, 'RR8 stylist bought stock', 14.4, { reimbursable: false })
  check('a claim is entered as a cost the salon paid', made.status === 200 || made.status === 201, { status: made.status, body: made.json })
  const appr = await asMgr('POST', `/api/expenses/${made.id}/approve`)
  check('…and the manager approves it', appr.status === 200, { status: appr.status, body: appr.json })

  const flip = await asMgr('PUT', `/api/expenses/${made.id}`, { reimbursable: true })
  check('Y1: turning it into a claim answers 200 — it is a legitimate correction', flip.status === 200, { status: flip.status, body: flip.json })
  check('Y1: …but the approval is GONE. It covered a cost, not a payment to a person',
    body(flip)?.approved === false, { approved: body(flip)?.approved, reimbursable: body(flip)?.reimbursable })
  check('Y1: …and it is still a claim, so the correction stuck', body(flip)?.reimbursable === true, body(flip))
  check('Y1: …and the warning names the flag rather than blaming the amount',
    (body(flip)?.warnings || []).some((w: string) => /reimburs/i.test(w) && /payment to a person/i.test(w)), body(flip)?.warnings)

  // …and the audit says why, because "approved: false" on its own is not an answer.
  const audits = await rows(sql`SELECT action, metadata FROM audit_log WHERE company_id = ${co.id} AND entity_id = ${made.id} ORDER BY created_at DESC LIMIT 5`)
  const why = audits.map((a: any) => (typeof a.metadata === 'string' ? a.metadata : JSON.stringify(a.metadata || {}))).join(' ')
  check('Y1: …and the audit records the reason', /marked reimbursable after approval/i.test(why), audits.map((a: any) => a.metadata))

  // Mark reimbursed is now unreachable until somebody approves the CLAIM.
  const early = await asMgr('POST', `/api/expenses/${made.id}/reimburse`)
  check('Y1: …so it cannot be paid out until it is approved again', early.status === 409, { status: early.status, body: early.json })

  // Turning it OFF keeps the approval: it pays out less than was approved.
  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  const off = await asMgr('PUT', `/api/expenses/${made.id}`, { reimbursable: false })
  check('Y1: turning it OFF keeps the approval — nobody is surprised by being paid less',
    off.status === 200 && body(off)?.approved === true, { status: off.status, approved: body(off)?.approved })
  check('Y1: …with nothing to warn about', !(body(off)?.warnings || []).length, body(off)?.warnings)

  // …and re-sending the flag it already has changes nothing, the way re-sending the amount does not.
  await asMgr('PUT', `/api/expenses/${made.id}`, { reimbursable: true })
  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  const resend = await asMgr('PUT', `/api/expenses/${made.id}`, { reimbursable: true, description: 'RR8 stylist bought stock (receipt)' })
  check('Y1: re-sending the same flag keeps the approval', body(resend)?.approved === true, body(resend))

  // The stylist cannot make the flip on their own approved claim at all — the T-level rule.
  const own = await addExpense(asSty, 'RR8 stylist own cost', 8, { reimbursable: false })
  await asMgr('POST', `/api/expenses/${own.id}/approve`)
  const byStylist = await asSty('PUT', `/api/expenses/${own.id}`, { reimbursable: true })
  check('Y1: a stylist cannot flip their own APPROVED claim', byStylist.status === 403, { status: byStylist.status, body: byStylist.json })
}

// ══════════ Y4 · a paid row cannot be marked "not a claim" ══════════════════════════════════════
{
  const made = await addExpense(asSty, 'RR8 paid out', 46, { reimbursable: true })
  await asMgr('POST', `/api/expenses/${made.id}/approve`)
  const paid = await asMgr('POST', `/api/expenses/${made.id}/reimburse`)
  check('a claim is approved and paid', paid.status === 200, { status: paid.status, body: paid.json })

  const unclaim = await asMgr('PUT', `/api/expenses/${made.id}`, { reimbursable: false })
  check('Y4: it cannot be marked as something nobody claimed', unclaim.status === 409, { status: unclaim.status, body: unclaim.json })
  check('Y4: …and the refusal is about the payment, not about the amount',
    /nobody claimed/i.test(String(unclaim.json?.error)) && /shortfall/i.test(String(unclaim.json?.error)), unclaim.json?.error)
  const [after] = await rows(sql`SELECT reimbursed, reimbursable FROM expense WHERE id = ${made.id}`)
  check('Y4: …the record still says paid, and still says claim', after?.reimbursed === true && after?.reimbursable === true, after)

  // Everything else about a paid row is still editable, as RR7 X2 established.
  const note = await asMgr('PUT', `/api/expenses/${made.id}`, { description: 'RR8 paid out — receipt 8891' })
  check('Y4: …while the description can still be fixed', note.status === 200, { status: note.status, body: note.json })
}

// ══════════ Y3 · the edit door answers like the others ══════════════════════════════════════════
{
  const mine = await addExpense(asSty, 'RR8 sty own', 9.5)
  const theirs = await addExpense(asSty2, 'RR8 colleague', 11)

  const real = await asSty('PUT', `/api/expenses/${theirs.id}`, { amount: 500 })
  const imaginary = await asSty('PUT', '/api/expenses/rr8doesnotexistatall', { amount: 500 })
  check('Y3: editing a colleague\'s expense reads as not found', real.status === 404, { status: real.status, body: real.json })
  check('Y3: …the same as an id that was never issued — a 403 here confirmed the row was real',
    real.status === imaginary.status, { colleague: real.status, madeUp: imaginary.status })
  check('Y3: …and says nothing about it', !/entered|approved|reimbursed/i.test(String(real.json?.error)), real.json?.error)
  const [untouched] = await rows(sql`SELECT amount FROM expense WHERE id = ${theirs.id}`)
  check('Y3: …and the colleague\'s row is untouched', Number(untouched?.amount) === 11, untouched)

  // Their own is still theirs to correct, and a manager still reaches everything.
  const own = await asSty('PUT', `/api/expenses/${mine.id}`, { amount: 9.75 })
  check('Y3: their own unapproved claim is still editable', own.status === 200, { status: own.status, body: own.json })
  const byMgr = await asMgr('PUT', `/api/expenses/${theirs.id}`, { description: 'RR8 colleague (checked)' })
  check('Y3: …and a manager can still edit anyone\'s', byMgr.status === 200, { status: byMgr.status })
}

// ══════════ Y2 · the fallback list is this salon's own ══════════════════════════════════════════
{
  const cfg = strip(await read('templates/crm-salon/frontend/src/peopleConfig.ts'))
  const route = strip(await read('templates/crm-salon/backend/src/routes/expenses.ts'))
  const ids = (s: string) => [...(s.match(/categories:\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  const frontIds = [...(cfg.match(/categories:\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/value:\s*'([a-z_]+)'/g)].map((m) => m[1])
  check('Y2: the screen configures a fallback list at all — it had none', frontIds.length > 0, frontIds)
  check('Y2: …and it is the list the server accepts, in the same order',
    frontIds.join('|') === ids(route).join('|'), { screen: frontIds, server: ids(route) })
  check('Y2: …so the fallback can never be the contractor default again',
    !frontIds.includes('materials') && frontIds.includes('stock'), frontIds)

  const page = strip(await read('packages/tenant-ui/src/people/ExpensesPage.tsx'))
  check('Y2: the server\'s list still wins over the configured one',
    /serverCategories \|\| config\?\.categories \|\| DEFAULT_EXPENSE_CATEGORIES/.test(page), null)
  check('Y2: …and a failed first fetch is retried when a form is opened',
    /const refreshCategories = \(correctValue: boolean\)/.test(page)
    && /openCreate = \(\) => \{[^}]*refreshCategories\(true\)/.test(page), null)
  check('Y2: …but a row being EDITED never has its stored category corrected by that retry',
    /if \(!list \|\| !correctValue\) return/.test(page) && /refreshCategories\(false\)/.test(page), null)
}

// ══════════ the two observations ════════════════════════════════════════════════════════════════
{
  // Escape closes the row menu. The tester approved an expense by accident because a click aimed at
  // the next row landed on a menu that could not be dismissed from the keyboard.
  const ui = strip(await read('packages/tenant-ui/src/invoicing/ui.tsx'))
  check('the shared row menu closes on Escape', /const onKey = \(e: KeyboardEvent\) => \{ if \(e\.key === 'Escape'\) setMenu\(null\) \}/.test(ui), null)
  check('…and the listener is actually attached, and removed', /document\.addEventListener\('keydown', onKey\)/.test(ui) && /document\.removeEventListener\('keydown', onKey\)/.test(ui), null)
}
{
  // "1 of your own entry was left for someone else to approve."
  const entry = async (who: any) => {
    const r = await who('POST', '/api/time', { hours: 2, date: yesterday, description: 'RR8 bulk probe' })
    return (r.json?.data || r.json)?.id
  }
  const mineId = await entry(asMgr)
  const theirsId = await entry(asSty)
  const bulk = await asMgr('POST', '/api/time/approve', { entryIds: [mineId, theirsId] })
  check('bulk approve still approves the other person\'s and skips your own',
    Number(bulk.json?.approved) === 1 && Number(bulk.json?.skipped) === 1, bulk.json)
  const warning = String((bulk.json?.warnings || [])[0] || '')
  check('…and says so in English', /^Your own entry was left for someone else to approve\.$/.test(warning), warning)

  // Two of the manager's own, alongside somebody else's — a batch of nothing but your own is a 403
  // with its own message, which is the RR4 M3 rule and not what this is checking.
  const second = await entry(asMgr)
  const anotherPersons = await entry(asSty2)
  const bulk2 = await asMgr('POST', '/api/time/approve', { entryIds: [mineId, second, anotherPersons] })
  check('…and counts properly when there are two', /^2 of your own entries were left/.test(String((bulk2.json?.warnings || [])[0] || '')),
    { warnings: bulk2.json?.warnings, approved: bulk2.json?.approved, skipped: bulk2.json?.skipped })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
