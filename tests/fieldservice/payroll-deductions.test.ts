// crm-fieldservice — the pay run, which 500s on three deployed tenants.
//
// GET /api/payroll/summary answered 500 on ctrtest, fstest and lndtest right after the redeploy that
// added the deductions line. The salon's pay run works, so the fault is in the four payroll files I
// patched by script rather than in the shared ledger.
//
// There was no test for payroll in ANY of those four templates — which is why a 500 reached three
// tenants. The salon had one only because the staff-balance test happened to exercise it. So this
// file exists in the fieldservice suite, which is the other end of the same shared module.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()
const { company, user, timeEntry } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Wrench Payroll', slug: 'wrench-payroll', email: 'pay@test.local', state: 'OH',
  enabledFeatures: ['time_tracking', 'expense_tracking', 'team'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-pay@test.local', passwordHash: 'x', firstName: 'O', lastName: 'Wner', role: 'owner', companyId: co.id,
} as any).returning()
const [tech] = await db.insert(user).values({
  email: 'tech-pay@test.local', passwordHash: 'x', firstName: 'Tess', lastName: 'Tech', role: 'field', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/payroll', (await import('./src/routes/payroll.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, raw: t }
}

const yesterday = new Date(Date.now() - 86400000)
await db.insert(timeEntry).values({
  companyId: co.id, userId: tech.id, date: yesterday, hours: '6', hourlyRate: '30',
  description: 'Payroll probe shift', approved: true,
} as any)

const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

// ══════════ it answers at all ═══════════════════════════════════════════════════════════════════
{
  const run = await api('GET', `/api/payroll/summary?startDate=${from}&endDate=${to}`)
  check('the pay run answers — it was 500ing on three deployed tenants', run.status === 200,
    { status: run.status, body: run.raw?.slice(0, 300) })
  const line = (run.json?.users || []).find((u: any) => String(u.user?.id) === String(tech.id))
  check('…with the technician on it', !!line, (run.json?.users || []).length)
  check('…and what they earned: 6h at 30', Math.round(Number(line?.totalPay) * 100) === 18000, line)
  check('…nothing recovered, because nothing is owed', Number(line?.deductions) === 0, line?.deductions)
  check('…so the whole wage is to pay', Math.round(Number(line?.netPay) * 100) === 18000, line?.netPay)
  check('…and nothing is unrecovered', Number(line?.unrecovered) === 0, line?.unrecovered)
  check('…and they owe nothing', Number(line?.stillOwed) === 0, line?.stillOwed)
  check('the totals are there and add up',
    !!run.json?.totals && Math.round(Number(run.json.totals.pay) * 100) === 18000
    && Number(run.json.totals.deductions) === 0 && Math.round(Number(run.json.totals.net) * 100) === 18000,
    run.json?.totals)
}

// ══════════ and with something owed, it reports it ══════════════════════════════════════════════
{
  const { staffAccountEntry } = await import('./db/schema.ts')
  // Owed by the technician: a 40 over-reimbursement, 25 of it taken off this pay run.
  await db.insert(staffAccountEntry).values([
    { companyId: co.id, userId: tech.id, amount: '-40', source: 'over_reimbursement', reason: 'Over-paid a claim', createdBy: owner.id },
    { companyId: co.id, userId: tech.id, amount: '25', source: 'payroll_deduction', reason: 'Recovered on this run', createdBy: owner.id },
  ] as any)

  const run = await api('GET', `/api/payroll/summary?startDate=${from}&endDate=${to}`)
  check('the pay run still answers once a balance exists', run.status === 200, { status: run.status, body: run.raw?.slice(0, 300) })
  const line = (run.json?.users || []).find((u: any) => String(u.user?.id) === String(tech.id))
  check('…earned is untouched — it is hours × rate', Math.round(Number(line?.totalPay) * 100) === 18000, line?.totalPay)
  check('…25 was recovered from the run', Math.round(Number(line?.deductions) * 100) === 2500, line?.deductions)
  check('…so 155 is left to pay', Math.round(Number(line?.netPay) * 100) === 15500, line?.netPay)
  check('…and 15 is still owed afterwards', Math.round(Number(line?.stillOwed) * 100) === 1500, line?.stillOwed)
}

// ══════════ a light week never produces a negative wage ═════════════════════════════════════════
{
  const [quiet] = await db.insert(user).values({
    email: 'quiet-pay@test.local', passwordHash: 'x', firstName: 'Quinn', lastName: 'Quiet', role: 'field', companyId: co.id,
  } as any).returning()
  await db.insert(timeEntry).values({
    companyId: co.id, userId: quiet.id, date: yesterday, hours: '1', hourlyRate: '10', description: 'One hour', approved: true,
  } as any)
  const { staffAccountEntry } = await import('./db/schema.ts')
  await db.insert(staffAccountEntry).values([
    { companyId: co.id, userId: quiet.id, amount: '-90', source: 'over_reimbursement', reason: 'Big over-payment', createdBy: owner.id },
    { companyId: co.id, userId: quiet.id, amount: '90', source: 'payroll_deduction', reason: 'Recovered on this run', createdBy: owner.id },
  ] as any)

  const run = await api('GET', `/api/payroll/summary?startDate=${from}&endDate=${to}`)
  const line = (run.json?.users || []).find((u: any) => String(u.user?.id) === String(quiet.id))
  check('somebody who owes more than they earned is never paid a negative wage', Number(line?.netPay) >= 0,
    { earned: line?.totalPay, recovered: line?.deductions, toPay: line?.netPay })
  check('…and the shortfall is reported rather than hidden',
    Math.round(Number(line?.unrecovered) * 100) === Math.round((Number(line?.deductions) - Number(line?.totalPay)) * 100),
    { recovered: line?.deductions, earned: line?.totalPay, unrecovered: line?.unrecovered })
  check('…and the totals never go negative', Number(run.json?.totals?.net) >= 0, run.json?.totals)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
