// T69 viewer note — "Landscaping: a T43 test recurring invoice still shows its next run date as Oct 9, which has
// passed. Worth checking whether its invoice was generated."
//
// It was not, and no schedule anywhere ever had been: nothing called processRecurringInvoices — no cron, no internal
// caller, no worker — so a schedule billed only when someone pressed "Generate now". Now the shared service starts a
// processor at boot in every template that mounts recurring invoices. Asserted here through the real service and
// routes:
//   · the processor bills a due schedule, and catches up one that is several periods behind — one invoice per
//     period, the schedule left in the future; a paused schedule and a future one are not touched
//   · ONE INVOICE PER PERIOD under a race: another caller moving the period between the read and the write (made
//     deterministic by a db whose transaction() lets a rival win first) writes nothing; and "Generate now" pressed
//     three times at once beside the processor never bills a period twice — every invoice is its own period
//   · each of the four templates starts it at boot
//   · the Agreements window says what the agreement itself bills, beside the plan's list price (the same note)
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, invoice, invoiceLineItem } = await import('./db/schema.ts') as any
const service = (await import('./src/services/recurring.ts')).default as any
const { createRecurringService, RecurringPeriodTaken, calculateNextDate } = await import('./src/shared/index.ts') as any

const [co] = await db.insert(company).values({ name: 'Verge Lawns', slug: 'verge-t69r', email: 'v69r@test.local', state: 'OH', settings: {}, enabledFeatures: ['recurring_jobs', 'invoices'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner@v69r.local', passwordHash: 'x', firstName: 'O', lastName: 'W', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const person = async (name: string) => (await db.insert(contact).values({ companyId: co.id, name, type: 'client', email: `${name.toLowerCase().replace(/\W+/g, '')}@test.local` } as any).returning())[0]

const app = new Hono()
app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const rowsOf = (r: any) => (r?.rows || r) as any[]
const schedule = async (who: any, nextRun: string, status = 'active') => {
  const r = await call('POST', '/api/recurring', { contactId: who.id, frequency: 'monthly', startDate: '2026-01-09', lineItems: [{ description: 'Mowing', quantity: 1, rate: 10 }] })
  if (r.status !== 201 && r.status !== 200) throw new Error('could not create a schedule: ' + r.text.slice(0, 200))
  const id = r.json?.id
  await db.execute(sql`UPDATE recurring_invoice SET next_run_date = ${nextRun}::timestamp, status = ${status} WHERE id = ${id}`)
  return id as string
}
const state = async (id: string) => rowsOf(await db.execute(sql`SELECT status, (EXTRACT(EPOCH FROM next_run_date) * 1000)::float8 AS next_ms, invoice_count FROM recurring_invoice WHERE id = ${id}`))[0]
const invoicesFor = async (who: any) => rowsOf(await db.execute(sql`SELECT id, number, status FROM invoice WHERE contact_id = ${who.id}`))
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

// ── the processor runs the schedule ────────────────────────────────────────────────────────────────
const dueC = await person('Due Client'), behindC = await person('Behind Client'), pausedC = await person('Paused Client'), futureC = await person('Future Client')
const due = await schedule(dueC, iso(Date.now() - 2 * DAY))                 // the T43 shape: due two days ago
const behind = await schedule(behindC, iso(Date.now() - 95 * DAY))         // three-plus periods missed
const paused = await schedule(pausedC, iso(Date.now() - 40 * DAY), 'paused')
const future = await schedule(futureC, iso(Date.now() + 20 * DAY))
const behindStart = new Date((await state(behind)).next_ms)

const proc = service.startRecurringProcessor({ firstRunMs: 0, intervalMs: 3_600_000 })
await new Promise((r) => setTimeout(r, 50))
const ran = await proc.lastRun()
proc.stop()

{
  const s = await state(due), inv = await invoicesFor(dueC)
  check('a schedule due two days ago is billed by the processor — nobody pressed anything', inv.length === 1 && s.invoice_count === 1, { inv, s })
  check('…its next run moves into the future', s.next_ms > Date.now(), s)
  check('…as a draft (autoSend off): nothing was sent', inv.every((i: any) => i.status === 'draft'), inv)
}
{
  const s = await state(behind), inv = await invoicesFor(behindC)
  let expect = 0
  for (let d = behindStart; d.getTime() <= Date.now(); d = calculateNextDate(d, 'monthly', 9)) expect++
  check(`a schedule ${expect} periods behind is caught up in one run — one invoice per missed period`, expect >= 3 && inv.length === expect && s.invoice_count === expect, { expect, got: inv.length, s })
  check('…and left in the future', s.next_ms > Date.now(), s)
  check('…every invoice its own number', new Set(inv.map((i: any) => i.number)).size === inv.length, inv.map((i: any) => i.number))
}
check('a paused schedule is not billed', (await invoicesFor(pausedC)).length === 0 && (await state(paused)).invoice_count === 0)
check('a schedule not yet due is not billed', (await invoicesFor(futureC)).length === 0 && (await state(future)).invoice_count === 0)
check('the run reports what it did', ran.generated === (await invoicesFor(dueC)).length + (await invoicesFor(behindC)).length && ran.failed === 0, ran)

// ── one invoice per period: a rival wins between the read and the write ────────────────────────────
{
  const who = await person('Race Client')
  const id = await schedule(who, iso(Date.now() - DAY))
  const rivalDb = new Proxy(db, {
    get(t: any, k) {
      if (k === 'transaction') return async (fn: any) => {
        // another caller bills this period first: the date moves on before our transaction takes the row
        await db.execute(sql`UPDATE recurring_invoice SET next_run_date = next_run_date + interval '1 month', invoice_count = invoice_count + 1 WHERE id = ${id}`)
        return t.transaction(fn)
      }
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v
    },
  })
  const racing = createRecurringService({ db: rivalDb, tables: { invoice, invoiceLineItem }, emailService: { sendInvoice: async () => ({}) } })
  let err: any = null
  try { await racing.generateInvoiceFromRecurring(id) } catch (e) { err = e }
  check('a caller that finds its period already taken is refused (RecurringPeriodTaken)', err instanceof RecurringPeriodTaken, String(err))
  check('…and writes NO invoice — the rival billed that period, not us', (await invoicesFor(who)).length === 0, await invoicesFor(who))
  check('…and does not move the schedule a second time', (await state(id)).invoice_count === 1, await state(id))
}

// PGlite runs one transaction at a time, so two real callers never overlap here. On Postgres (READ COMMITTED) the
// re-read only refuses the loser if it WAITS for the winner — the row lock is what makes it wait. Pinned on the source:
{
  const src = readFileSync(ROOT + 'packages/tenant-backend/src/recurring/recurring.ts', 'utf8')
  const gen = src.slice(src.indexOf('async function generateInvoiceFromRecurring('), src.indexOf('async function processRecurringInvoices('))
  const tx = gen.slice(gen.indexOf('db.transaction(async (tx: any) => {'))
  check('the period is claimed under a row lock, inside the invoice\'s transaction, before the invoice is written',
    /tx\.execute\(sql`SELECT status, next_run_date FROM recurring_invoice WHERE id = \$\{recurringId\} FOR UPDATE`\)/.test(tx)
    && tx.indexOf('FOR UPDATE') < tx.indexOf('UPDATE recurring_invoice SET next_run_date') && tx.indexOf('UPDATE recurring_invoice SET next_run_date') < tx.indexOf('tx.insert(invoice)')
    && !/\bdb\.execute\(sql`\s*UPDATE recurring_invoice SET next_run_date/.test(gen))
}

// ── "Generate now" ×3 beside the processor: no period billed twice ─────────────────────────────────
{
  const who = await person('Click Client')
  const id = await schedule(who, iso(Date.now() - DAY))
  const start = new Date((await state(id)).next_ms)
  const results = await Promise.all([
    call('POST', `/api/recurring/${id}/generate`), call('POST', `/api/recurring/${id}/generate`), call('POST', `/api/recurring/${id}/generate`),
    service.processDueRecurring(),
  ])
  const s = await state(id), inv = await invoicesFor(who)
  let expectNext = start
  for (let n = 0; n < inv.length; n++) expectNext = calculateNextDate(expectNext, 'monthly', 9)
  check(`every invoice is its own period: ${inv.length} invoice(s), the schedule moved exactly ${inv.length} period(s)`, inv.length >= 1 && s.invoice_count === inv.length && s.next_ms === expectNext.getTime(), { inv: inv.length, s, expectNext })
  const statuses = results.slice(0, 3).map((r: any) => r.status)
  check(`each "Generate now" answers 201, or 409 when its period was taken — never 500 (${statuses.join(', ')})`, statuses.every((x: number) => x === 201 || x === 409), results.slice(0, 3).map((r: any) => r.text.slice(0, 120)))
  const conflict = results.slice(0, 3).find((r: any) => r.status === 409)
  if (conflict) check('…a 409 names what happened', conflict.json?.code === 'period_already_generated', conflict.json)
}

// ── resume picks up where the schedule is, not "due now" — and nothing bills before its start ─────────
// The live T43 probe: created 5 Oct to start 1 June 2027, paused and resumed 9 Oct; the resume route wrote
// next_run_date = now, so the schedule sat "due 9 Oct 2026" and the processor billed it before it began.
{
  const at = async (who: any, start: string, next: string, status = 'active') => {
    const r = await call('POST', '/api/recurring', { contactId: who.id, frequency: 'monthly', startDate: start, lineItems: [{ description: 'Mowing', quantity: 1, rate: 10 }] })
    if (r.status !== 201 && r.status !== 200) throw new Error('could not create a schedule: ' + r.text.slice(0, 200))
    await db.execute(sql`UPDATE recurring_invoice SET next_run_date = ${next}::timestamp, status = ${status} WHERE id = ${r.json?.id}`)
    return r.json?.id as string
  }
  const startAhead = new Date(Date.now() + 200 * DAY), startMs = Date.UTC(startAhead.getUTCFullYear(), startAhead.getUTCMonth(), startAhead.getUTCDate())

  // a schedule not yet started, paused and resumed
  const notYetC = await person('Not Yet Client')
  const notYet = await at(notYetC, iso(startMs), iso(startMs))
  await call('POST', `/api/recurring/${notYet}/pause`)
  const resumed = await call('POST', `/api/recurring/${notYet}/resume`)
  check('resuming a schedule that has not started keeps it on its start date — not "due now"', resumed.status === 200 && (await state(notYet)).next_ms === startMs, { status: resumed.status, s: await state(notYet), startMs })

  // paused mid-period: the next period has not come yet, so resuming changes nothing
  const midC = await person('Mid Client')
  const midNext = Date.now() + 10 * DAY
  const mid = await at(midC, '2026-01-09', iso(midNext), 'paused')
  await call('POST', `/api/recurring/${mid}/resume`)
  check('resuming mid-period leaves the next period where it was — the month is not billed twice', Math.abs((await state(mid)).next_ms - midNext) < 1000, await state(mid))

  // paused across two periods: those are skipped (a pause bills nothing), the next one is in the future
  const longC = await person('Long Pause Client')
  const long = await at(longC, '2026-01-09', iso(Date.now() - 70 * DAY), 'paused')
  await call('POST', `/api/recurring/${long}/resume`)
  const ls = await state(long)
  check('resuming after a long pause moves on to the next period to come — the paused ones are not owed', ls.next_ms > Date.now() && ls.next_ms < Date.now() + 32 * DAY, ls)

  // the old rows that the previous resume wrote: next run BEFORE the start, start still ahead
  const oldC = await person('Old Row Client')
  const oldRow = await at(oldC, iso(startMs), iso(Date.now() - 2 * DAY))
  const before2 = await state(oldRow)
  await service.processDueRecurring()
  const after2 = await state(oldRow)
  check('an old row due before its own start is put back on its start date by the processor', before2.next_ms < Date.now() && after2.next_ms === startMs, { before2, after2, startMs })
  check('…and nothing is billed for the schedules above — not started, mid-period, long pause, old row', (await invoicesFor(notYetC)).length + (await invoicesFor(midC)).length + (await invoicesFor(longC)).length + (await invoicesFor(oldC)).length === 0)
  // the exact T43 shape, PAUSED: next run already before a start that is still ahead. Resuming must land on the start,
  // not a month after the stale date (which would still be months before the contract begins)
  const t43C = await person('T43 Shape Client'), t43Svc = await person('T43 Shape Service')
  const t43 = await at(t43C, iso(startMs), iso(Date.now() - 2 * DAY), 'paused')
  await call('POST', `/api/recurring/${t43}/resume`)
  check('resuming a paused schedule whose next run is before its start lands ON the start (the route)', (await state(t43)).next_ms === startMs, { s: await state(t43), startMs })
  const t43b = await at(t43Svc, iso(startMs), iso(Date.now() - 2 * DAY), 'paused')
  const viaService = await service.resumeRecurringInvoice(t43b, co.id)
  check('…and through the service\'s own resume, the same rule', viaService?.nextRunDate?.getTime?.() === startMs && (await state(t43b)).next_ms === startMs, { got: viaService?.nextRunDate, startMs })
}

// ── every template that mounts recurring invoices starts the processor ─────────────────────────────
for (const t of ['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping']) {
  const idx = readFileSync(`${ROOT}templates/${t}/backend/src/index.ts`, 'utf8')
  const mounts = /app\.route\('\/api\/recurring', recurringRoutes\)/.test(idx)
  check(`${t}: mounts recurring invoices and starts their processor at boot`, mounts && /^import recurringService from '\.\/services\/recurring\.ts'/m.test(idx) && /^recurringService\.startRecurringProcessor\(\)/m.test(idx), { mounts })
}
// …and no other template mounts them without it
for (const t of ['crm-dispensary', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-restaurant', 'crm-store']) {
  const idx = readFileSync(`${ROOT}templates/${t}/backend/src/index.ts`, 'utf8')
  check(`${t}: has no recurring-invoice mount (so nothing to start)`, !/['"]\/api\/recurring['"],\s*recurringRoutes/.test(idx))
}

// ── the Agreements window: the agreement's own price beside the plan's list price ──────────────────
{
  const page = readFileSync(ROOT + 'packages/tenant-ui/src/agreements/AgreementsPage.tsx', 'utf8').replace(/\r\n/g, '\n')
  const modal = page.slice(page.indexOf('function AgreementFormModal('))
  check('Agreements window: says what THIS agreement bills (its amount and frequency), for a seat that sees money', /agreement && maySeeMoney && \(/.test(modal) && /This agreement bills \$\{money\(agreement\.amount\)\}\/\$\{agreement\.billingFrequency\}/.test(modal))
  check('…in the same money() as the table\'s Price cell, so the two read alike', /\{maySeeMoney && <td[^>]*>\s*\{money\(agreement\.amount\)\}/.test(page) && /^import \{ money \} from '\.\.\/invoicing\/ui'/m.test(page))
  check('…and warns that a different plan re-prices it on save', /form\.planId !== agreement\.planId/.test(modal) && /bills the agreement at the plan’s price/.test(modal))
}

console.log(`\nt69 recurring runs: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
