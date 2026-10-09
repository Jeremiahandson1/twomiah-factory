// T62 Vet — owner's decision (2026-10-09): vet staff do not see practice revenue.
//
//   "Staff can see practice money through /api/invoices/stats and the dashboard revenue tile, even
//    though Reports is refused for them. Either strip it or confirm staff should see it."
//
// Staff keep invoices:read/create/update — they bill a visit and see that visit's charge. The practice's
// TOTALS now also ask revenue:read (admin, manager, viewer; owner '*'). Asserted through the real routes.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, patient, visit, invoice } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Takings Vet', slug: 'takings-vet-t62', email: 'tv62@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@tv62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), viewer = await mk('viewer', 'viewer'), staff = await mk('staff', 'staff')

const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Dana Whitlock', email: 'dana-t62@test.local' } as any).returning()
const [pet] = await db.insert(patient).values({ companyId: co.id, ownerId: client.id, name: 'Juniper', species: 'cat' } as any).returning()
// 4,321.87 — a figure nothing else in either payload can produce. Billed, dated this month, already happened.
const [inv] = await db.insert(invoice).values({
  companyId: co.id, contactId: client.id, number: 'INV-06201', subtotal: '4321.87', total: '4321.87',
  amountPaid: '0', taxAmount: '0', taxRate: '0', discount: '0', status: 'sent',
} as any).returning()
const now = new Date(), startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
await db.insert(visit).values({
  companyId: co.id, patientId: pet.id, visitDate: new Date(Math.max(startOfMonth.getTime() + 1000, now.getTime() - 60000)),
  reason: 'Dental', total: '4321.87', invoiceId: inv.id,
} as any)

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ── staff: the visit's bill, not the practice's month ──
const st = await as(staff)('/api/invoices/stats')
check('vet staff are refused the practice totals (/api/invoices/stats → 403)', st.status === 403, { status: st.status, body: st.text.slice(0, 160) })
check('…and the refusal carries no figure', !/4321/.test(st.text))
const one = await as(staff)(`/api/invoices/${inv.id}`)
check('vet staff still open the invoice they billed (invoices:read untouched)', one.status === 200 && Number(one.json?.total) === 4321.87, { status: one.status })
const list = await as(staff)('/api/invoices')
check('…and still list invoices', list.status === 200, { status: list.status })
const dash = await as(staff)('/api/dashboard/stats')
check('vet staff still get the dashboard — visits this month counted', dash.status === 200 && dash.json?.visits?.thisMonth === 1, dash.json?.visits)
check('…with revenueWithheld and NO revenue keys (absent, so the tile cannot print $0.00)',
  dash.json?.visits?.revenueWithheld === true && !('revenueThisMonth' in (dash.json?.visits || {})) && !('unbilledThisMonth' in (dash.json?.visits || {})) && !('scheduledThisMonth' in (dash.json?.visits || {})), dash.json?.visits)
check('…and the figure is nowhere in the payload', !/4321/.test(dash.text), dash.text.slice(0, 200))

// ── the seats that read the books, unchanged ──
for (const [who, label] of [[owner, 'the owner'], [manager, 'a manager'], [viewer, 'a viewer (sees revenue, not cost)']] as const) {
  const s = await as(who)('/api/invoices/stats')
  check(`${label} reads the practice totals`, s.status === 200 && Number(s.json?.totalAmount) === 4321.87, { status: s.status, body: s.text.slice(0, 160) })
}
const od = await as(owner)('/api/dashboard/stats')
check('the owner\'s dashboard carries the month\'s billed revenue', od.status === 200 && od.json?.visits?.revenueThisMonth === 4321.87 && !od.json?.visits?.revenueWithheld, od.json?.visits)
const md = await as(manager)('/api/dashboard/stats')
check('…and so does a manager\'s', md.status === 200 && md.json?.visits?.revenueThisMonth === 4321.87, md.json?.visits)

console.log(`\nt62 practice revenue: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
