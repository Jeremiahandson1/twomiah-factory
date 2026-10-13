// Field service bills a service call straight from the job (invoice.job_id, migration 0025), so its automatic
// commissions reach the job through the invoice's own job column — not a quote, which a service call usually lacks.
// Paid through the real POST /api/jobs/:id/invoice + /api/invoices/:id/payments, then looked for.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const until = async (fn: () => Promise<boolean>, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 40)) } return fn() }

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')
const [co] = await db.insert(S.company).values({ name: 'Cool Air', slug: 'cool-air', email: 'o@ca.test', settings: {}, enabledFeatures: ['contacts', 'jobs', 'invoices', 'team', 'commission_tracking'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(S.user).values({ email: `${tag}@ca.test`, passwordHash: 'x', firstName: tag, lastName: 'C', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), tech = await mk('field', 'tech')
const [cust] = await db.insert(S.contact).values({ name: 'Dana Home', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/commissions', (await import('./src/routes/commissions.ts')).default)
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner)

await O('POST', '/api/commissions/plans', { name: 'Tech flat', planType: 'flat_rate', flatRateAmount: 40, appliesToRole: 'technician', autoEarn: 'job_assignee' })
const [job] = await db.insert(S.job).values({ number: 'JOB-00001', title: 'No cooling', status: 'completed', companyId: co.id, contactId: cust.id, assignedToId: tech.id, estimatedValue: '250' } as any).returning()
const billed = await O('POST', `/api/jobs/${job.id}/invoice`)
check(`the service call is billed from the job, with no quote (${billed.status})`, (billed.status === 200 || billed.status === 201) && !!billed.json?.invoice?.id || !!billed.json?.id, billed.json)
const invId = billed.json?.invoice?.id || billed.json?.id
const [inv] = await db.select().from(S.invoice).where(eq(S.invoice.id, invId))
check('…the invoice carries the job, not a quote', inv?.jobId === job.id && !inv?.quoteId, inv)
if (inv?.status === 'draft') await db.update(S.invoice).set({ status: 'sent' } as any).where(eq(S.invoice.id, invId))
const pay = await O('POST', `/api/invoices/${invId}/payments`, { amount: Number(inv.total), method: 'card' })
const got = await until(async () => (await db.select().from(S.commission).where(and(eq(S.commission.invoiceId, invId), eq(S.commission.source, 'auto')))).length === 1)
const [row] = await db.select().from(S.commission).where(eq(S.commission.invoiceId, invId))
check(`paid in full (${pay.status}) → the technician earns the flat $40.00 through invoice.job_id`, got && row?.userId === tech.id && Number(row?.commissionAmount) === 40 && row?.jobId === job.id, row)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
