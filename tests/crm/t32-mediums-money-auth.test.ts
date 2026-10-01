// T32 M6, M7 and M12 — three mediums that each take something real from somebody.
//
// M6  An over-payment of $29.55 was recorded, then repayments of $40 and $29.55 were BOTH accepted:
//     $69.55 came back against $29.55 owed, "Owed" read $0, and "the extra $40 taken from the
//     employee is tracked nowhere". That is money off somebody's pay with no record of why.
// M7  As `field`: PUT /api/jobs/:id with estimatedValue 1. A 200. JOB-00119 went from $11,183 to $1,
//     which feeds job costing's revenue and the project's contract value.
// M12 GET /api/documents/file/* answered `Cache-Control: private, max-age=86400`, so the browser
//     served the file again WITHOUT credentials. After sign-out on a shared office PC the next
//     person can open it from history.
import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, job, expense, staffAccountEntry } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Med Co', slug: 'med-co', email: 'm@test.local', state: 'OH', settings: {},
  enabledFeatures: ['expense_tracking', 'projects', 'time_tracking'],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-med@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
const tech = await mk('field', 'field')
const viewer = await mk('viewer', 'viewer')
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Med Client', type: 'customer' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Med Site', number: 'PRJ-MED', status: 'active',
} as any).returning()

const app = new Hono()
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.route('/api/expenses', (await import('./src/routes/expenses.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asTech = as(tech), asViewer = as(viewer)

// ══════════ M7 · jobs:update is not permission to reprice the job ══════════════════════════════
{
  const made = await asOwner('POST', '/api/jobs', {
    title: 'Deck rebuild', contactId: client.id, projectId: proj.id, estimatedValue: 11_183,
  })
  check('a job is created with its value', made.status === 201 && cents(made.json?.estimatedValue) === 1_118_300,
    { status: made.status, value: made.json?.estimatedValue })
  const id = made.json?.id

  const drop = await asTech('PUT', `/api/jobs/${id}`, { estimatedValue: 1 })
  check('field cannot reprice a job', drop.status === 403, { status: drop.status, body: drop.text?.slice(0, 220) })
  check('…and the refusal names the field', /estimatedValue/.test(JSON.stringify(drop.json)), drop.json)
  const [after] = await db.select().from(job).where(eq(job.id, id))
  check('…the value is untouched', cents(after?.estimatedValue) === 1_118_300, after?.estimatedValue)

  // The work itself is still theirs to run — that is what jobs:update is for, and taking it away
  // would be the more expensive mistake.
  const note = await asTech('PUT', `/api/jobs/${id}`, { notes: 'Footings poured, cure 48h', status: 'in_progress' })
  check('field CAN still run the work — notes and status', note.status === 200, { status: note.status, body: note.text?.slice(0, 200) })
  const [ran] = await db.select().from(job).where(eq(job.id, id))
  check('…the note saved', /Footings poured/.test(ran?.notes || ''), ran?.notes)
  check('…and the status moved', ran?.status === 'in_progress', ran?.status)

  // Re-sending the SAME value must not be refused: the edit form posts the whole record back, so a
  // technician saving a note would otherwise be told they cannot change the price they did not touch.
  const resend = await asTech('PUT', `/api/jobs/${id}`, { estimatedValue: 11_183, notes: 'Second note' })
  check('…and re-sending the UNCHANGED value is not a refusal (the form posts the whole record back)',
    resend.status === 200, { status: resend.status, body: resend.text?.slice(0, 200) })

  const byManager = await asManager('PUT', `/api/jobs/${id}`, { estimatedValue: 12_000 })
  check('a manager can reprice it', byManager.status === 200 && cents(byManager.json?.estimatedValue) === 1_200_000,
    { status: byManager.status, value: byManager.json?.estimatedValue })
  const byViewer = await asViewer('PUT', `/api/jobs/${id}`, { estimatedValue: 5 })
  check('a viewer cannot (it has no jobs:update at all)', byViewer.status === 403, { status: byViewer.status })
}

// ══════════ M6 · a repayment cannot exceed what was over-paid ══════════════════════════════════
{
  // A claim of $120, reimbursed. Then $29.55 of it was over-paid.
  const [claim] = await db.insert(expense).values({
    companyId: co.id, date: new Date(), category: 'materials', description: 'Fixings run',
    amount: '120.00', submittedById: tech.id, approved: true, reimbursable: true, reimbursed: true,
    reimbursedById: owner.id, reimbursedAt: new Date(),
  } as any).returning()

  const over = await asOwner('POST', `/api/expenses/${claim.id}/overpayment`, { amount: 29.55, reason: 'Paid twice' })
  check('the over-payment is recorded as a debt', over.status === 200 || over.status === 201, { status: over.status, body: over.text?.slice(0, 220) })
  const owedRow: any = await db.execute(sql`SELECT COALESCE(SUM(amount), 0) AS bal FROM staff_account_entry WHERE user_id = ${tech.id}`)
  check('…and the person owes $29.55', cents((owedRow.rows || owedRow)[0]?.bal) === -2955, (owedRow.rows || owedRow)[0])

  const tooMuch = await asOwner('POST', `/api/expenses/${claim.id}/repayment`, { amount: 40, reason: 'Cash back' })
  check('a $40 repayment against $29.55 owed is REFUSED', tooMuch.status === 400, { status: tooMuch.status, body: tooMuch.text?.slice(0, 260) })
  check('…naming what was over-paid, not what the claim was worth', /29\.55/.test(JSON.stringify(tooMuch.json)) && !/120/.test(String(tooMuch.json?.error || '')), tooMuch.json)
  check('…and saying why it matters', /off somebody's pay/i.test(String(tooMuch.json?.error || '')), tooMuch.json?.error)

  const right = await asOwner('POST', `/api/expenses/${claim.id}/repayment`, { amount: 29.55, reason: 'Cash back' })
  check('the exact amount owed comes back fine', right.status === 200, { status: right.status, body: right.text?.slice(0, 220) })
  check('…and it clears the debt', cents(right.json?.clearedOwed) === 2955, right.json?.clearedOwed)
  const settled: any = await db.execute(sql`SELECT COALESCE(SUM(amount), 0) AS bal FROM staff_account_entry WHERE user_id = ${tech.id}`)
  check('…so they owe nothing', cents((settled.rows || settled)[0]?.bal) === 0, (settled.rows || settled)[0])

  /**
   * The part the first fix would have missed. After the debt is settled the per-PERSON balance reads
   * zero — so a ceiling taken from the balance would fall back to "what the claim was worth" and let
   * the next repayment through, which is exactly the $40 the report got away with. The ceiling is
   * read from the LEDGER ENTRY, which is permanent.
   */
  const again = await asOwner('POST', `/api/expenses/${claim.id}/repayment`, { amount: 29.55, reason: 'Again' })
  check('a SECOND repayment is refused even though the balance now reads zero', again.status === 400,
    { status: again.status, body: again.text?.slice(0, 240) })
  check('…saying the whole over-payment has come back', /already come back/i.test(String(again.json?.error || '')), again.json?.error)
  const [finalRow] = await db.select().from(expense).where(eq(expense.id, claim.id))
  check('…and the total returned is $29.55, not $69.55', cents(finalRow?.repaidAmount) === 2955,
    { repaid: finalRow?.repaidAmount, reportGot: '69.55' })
}

// ══════════ M6b · handing back part of a paid claim still works with no debt recorded ══════════
{
  // The case this endpoint was built for: nothing was over-paid and no debt was raised, somebody is
  // simply returning part of a claim. Capping on the debt would have broken this.
  const [claim] = await db.insert(expense).values({
    companyId: co.id, date: new Date(), category: 'materials', description: 'Returned a part',
    amount: '50.00', submittedById: tech.id, approved: true, reimbursable: true, reimbursed: true,
    reimbursedById: owner.id, reimbursedAt: new Date(),
  } as any).returning()
  const back = await asOwner('POST', `/api/expenses/${claim.id}/repayment`, { amount: 10, reason: 'Part returned to the supplier' })
  check('$10 back against a $50 claim with no debt recorded is accepted', back.status === 200, { status: back.status, body: back.text?.slice(0, 220) })
  check('…and the claim is the ceiling there', cents(back.json?.netAmount) === 4000, back.json?.netAmount)
  const over = await asOwner('POST', `/api/expenses/${claim.id}/repayment`, { amount: 45, reason: 'Too much' })
  check('…but more than the claim is still refused', over.status === 400, { status: over.status })
}

// M12 — the browser cache on authenticated file routes — is NOT asserted here. It is a property of
// the response headers on a route that reads from R2, and R2 is unconfigured in a sandbox, so the
// only thing a test here could do is grep the source. That is a guard's job, not a test's:
// scripts/check-authenticated-files-no-store.ts, which also covers the photo route the report did
// not reach.

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
