// T37 — POST /api/recurring/process billed the whole company for anyone with a login.
//
// Found while CONFIRMING something that turned out to be correct. The T37 report asked me to confirm
// a note: "Recurring invoice schedules answer 200 for viewer; viewer already has invoices:read, so
// probably intended." It is intended — every read in recurring.ts is gated on invoices:read, a
// schedule is an invoice template, and viewer holds invoices:read. But reading the file to check that
// put the last route in it on the screen:
//
//     // Cron endpoint — secure with an internal secret, not the user session.
//     app.post('/process', async (c) => {
//       const cronSecret = c.req.header('x-cron-secret')
//       if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) return 401
//       return c.json(await service.processDueRecurring())
//     })
//
// Every clause of that comment was wrong:
//
//   · It is NOT secret-only. `app.use('*', authenticate)` sits at the top of the same router, so a
//     session has always been required and a secret-only caller could never reach it.
//   · The secret check was fail-OPEN: `if (process.env.CRON_SECRET && …)`. CRON_SECRET is not written
//     into a tenant's environment by the deploy pipeline, the generator or render.yaml — so on every
//     tenant the condition was false and the whole check was skipped.
//   · It had no permission gate, alone among the writes in the file (create, update, pause, resume,
//     cancel, generate and delete all have one).
//
// So any signed-in person could run every due schedule for the company and issue the invoices: a
// viewer, whose entire contract is read-only, or a field technician. No screen offers it and nothing
// calls it, which is why five rounds of role matrices never found it — the tester drives the UI and
// the sweeps drive GETs.
//
// THE ASSERTIONS ARE ABOUT INVOICES EXISTING, not about status codes. A 403 that still wrote the row
// would be the T32 500-2 fault again (that route answered 500 and billed anyway), so each refusal is
// followed by a count of the invoice table.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Process Co', slug: 'process-co', email: 'process@test.local', state: 'OH', settings: {},
  enabledFeatures: ['recurring_jobs', 'invoices'],
} as any).returning()
const seat = async (email: string, role: string) => {
  const [u] = await db.insert(user).values({
    email, passwordHash: 'x', firstName: role, lastName: 'Seat', role, companyId: co.id, isActive: true,
  } as any).returning()
  return u
}
const owner = await seat('owner-proc@test.local', 'owner')
const viewer = await seat('viewer-proc@test.local', 'viewer')
const field = await seat('field-proc@test.local', 'field')
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Okonkwo', type: 'client', email: 'okonkwo@test.local',
} as any).returning()

const app = new Hono()
app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asViewer = as(viewer), asField = as(field)

const invoiceCount = async () => {
  const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  return Number(((r as any).rows || r)[0]?.n ?? 0)
}

// A schedule that is DUE, so /process has real work to do. A gate asserted over a schedule with
// nothing to run would pass on an empty queue and prove nothing — the same mistake as asserting a
// refusal over an empty commissions table.
const made = await asOwner('POST', '/api/recurring', {
  contactId: client.id, frequency: 'monthly', startDate: '2026-01-15',
  lineItems: [{ description: 'Monthly retainer', quantity: 1, rate: 500 }],
  taxRate: 5.5,
})
check('a due schedule exists to be processed', made.status === 201 || made.status === 200, { status: made.status, body: made.text?.slice(0, 200) })
await db.execute(sql`UPDATE recurring_invoice SET next_run_date = NOW() - INTERVAL '1 day', status = 'active' WHERE company_id = ${co.id}`)

const before = await invoiceCount()
check('…and no invoice has been raised from it yet', before === 0, { before })

// ══════════ a read-only seat cannot bill the company ══════════════════════════════════════════
{
  const r = await asViewer('POST', '/api/recurring/process')
  check('a viewer is REFUSED /recurring/process', r.status === 403, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and nothing was billed', (await invoiceCount()) === before, { count: await invoiceCount(), before })
}

// ══════════ nor a field technician ═════════════════════════════════════════════════════════════
{
  const r = await asField('POST', '/api/recurring/process')
  check('a field technician is REFUSED', r.status === 403, { status: r.status, body: r.text?.slice(0, 200) })
  check('…and still nothing was billed', (await invoiceCount()) === before, { count: await invoiceCount(), before })
}

// ══════════ the owner can still run it — the gate must not break the feature ═══════════════════
//
// This is the half that stops the fix becoming the bug. Nothing calls /process today, but it is the
// endpoint a scheduler will call, and a gate that refuses everybody is not a gate.
{
  const r = await asOwner('POST', '/api/recurring/process')
  check('the owner can run the due schedules', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  const after = await invoiceCount()
  check('…and exactly one invoice was raised', after === before + 1, { before, after })
}

// ══════════ the reads the T37 note asked about — confirmed correct, and pinned ═════════════════
//
// A viewer reading schedules IS intended (invoices:read, which viewer holds). Pinned here so the
// refusal added above is never widened into the reads by someone "tidying up" the gates.
{
  const list = await asViewer('GET', '/api/recurring')
  check('a viewer may still LIST recurring schedules — a schedule is an invoice template', list.status === 200, { status: list.status, body: list.text?.slice(0, 160) })
  const stats = await asViewer('GET', '/api/recurring/stats')
  check('…and read the stats', stats.status === 200, { status: stats.status })

  // …but not change one. The writes were already gated; this confirms the round did not loosen them.
  const paused = await asViewer('POST', '/api/recurring/does-not-matter/pause')
  check('a viewer cannot pause a schedule', paused.status === 403, { status: paused.status })
  const made2 = await asViewer('POST', '/api/recurring', {
    contactId: client.id, frequency: 'monthly', startDate: '2026-10-31',
    lineItems: [{ description: 'nope', quantity: 1, rate: 1 }],
  })
  check('…nor create one', made2.status === 403, { status: made2.status })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
