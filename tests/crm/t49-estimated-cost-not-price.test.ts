// Estimated cost comes from what the work COSTS, not what it sells for. (T49)
//
// crm, crm-basic and crm-landscaping summed `quote_line_item.total` — the line's PRICE — for the
// labour and material halves of the estimate. crm-fieldservice's own comment has said for two rounds
// why that is wrong: reporting revenue back as cost states a 0% margin on work nobody has costed,
// which is the inverse of the 100% margin T41 fixed and just as invented. Those three had never run
// the migration that gave them a cost column, so they kept the behaviour.
//
// This pins the new basis on crm, and the three things that make it honest rather than merely
// different:
//
//   · a costed line is priced at quantity × unit_cost — NOT its total
//   · an UNCOSTED line contributes nothing and is COUNTED, so a $0 estimate can explain itself
//     instead of looking like a break-even job
//   · labour hours come from the pricebook item the line was priced from
//
// …and that a 'service' line counts as labour (T48), because a catalogue types its work that way far
// more often than 'labor', and the hours already come off those same lines.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}
const money = (got: unknown, want: number) => Math.abs(Number(got) - want) < 0.005

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, contact, quote, quoteLineItem, pricebookItem, job } = schema

check('the migration landed: a quote line can record a cost and the item it was priced from',
  'unitCost' in quoteLineItem && 'pricebookItemId' in quoteLineItem,
  Object.keys(quoteLineItem).filter((k: string) => /cost|pricebook/i.test(k)))

const [co] = await db.insert(company).values({
  name: 'Væring Build', slug: 'vaering-t49', email: 'q49@test.local',
  settings: {}, enabledFeatures: ['quotes', 'jobs', 'job_costing', 'pricebook', 'contacts'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t49@test.local', passwordHash: 'x', firstName: 'Olive', lastName: 'V',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Ingrid Væring', email: 'ingrid-t49@test.local',
} as any).returning()

/**
 * A catalogue item that states BOTH what it costs us and how long it takes. The picker copies the
 * cost onto the line; the hours stay on the item and are read through the line's link.
 */
const [pbService] = await db.insert(pricebookItem).values({
  companyId: co.id, name: 'Kitchen fit — day rate', code: 'SVC-0049',
  type: 'service', price: '900.00', cost: '400.00', laborHours: '8.00', active: true,
} as any).returning()
const [pbPart] = await db.insert(pricebookItem).values({
  companyId: co.id, name: 'Worktop — oak', code: 'MAT-0049',
  type: 'material', price: '650.00', cost: '410.00', active: true,
} as any).returning()

const [q] = await db.insert(quote).values({
  companyId: co.id, contactId: client.id, number: 'QT-0049', name: 'Kitchen, phase 1',
  status: 'approved', subtotal: '3100.00', total: '3100.00',
} as any).returning()

// Two costed lines from the catalogue…
await db.insert(quoteLineItem).values({
  quoteId: q.id, description: 'Kitchen fit — day rate (SVC-0049)', type: 'service',
  quantity: '2.00', unitPrice: '900.00', total: '1800.00',
  unitCost: '400.00', pricebookItemId: pbService.id, sortOrder: 0,
} as any)
await db.insert(quoteLineItem).values({
  quoteId: q.id, description: 'Worktop — oak (MAT-0049)', type: 'material',
  quantity: '1.00', unitPrice: '650.00', total: '650.00',
  unitCost: '410.00', pricebookItemId: pbPart.id, sortOrder: 1,
} as any)
// …and one typed by hand that nobody costed. It must NOT be priced at its revenue.
await db.insert(quoteLineItem).values({
  quoteId: q.id, description: 'Make good and decorate', type: 'labor',
  quantity: '1.00', unitPrice: '650.00', total: '650.00',
  unitCost: null, pricebookItemId: null, sortOrder: 2,
} as any)

const [j] = await db.insert(job).values({
  companyId: co.id, contactId: client.id, number: 'JOB-00049', title: 'Kitchen, phase 1',
  status: 'completed', completedAt: new Date('2026-09-28'), quoteId: q.id, estimatedHours: '3.00',
} as any).returning()

const app = new Hono()
app.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (p: string) => {
  const res = await app.request(p, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let x: any = t; try { x = JSON.parse(t) } catch {}
  return { status: res.status, json: x, text: t }
}

console.log('\n══════════ the estimate reads cost, not price ══════════')
const d = await get(`/api/job-costing/job/${j.id}`)
check('the detail answers', d.status === 200, { status: d.status, body: d.text?.slice(0, 220) })
const e = d.json?.estimated ?? {}

// 2 × 400 = 800. The PRICE of those lines is 1,800 — the old behaviour's answer.
check('T49: a costed SERVICE line is labour at 2 × its cost (800), not its price (1800)',
  money(e.laborCost ?? e.labor, 800), { got: e.laborCost ?? e.labor, expected: 800, oldAnswer: 1800 })

// 1 × 410 = 410. Price was 650.
check('…and a costed material line at its cost (410), not its price (650)',
  money(e.materialCost ?? e.material, 410), { got: e.materialCost ?? e.material, expected: 410, oldAnswer: 650 })

check('T49: the uncosted line adds NOTHING — not its £650 of revenue',
  money((e.laborCost ?? e.labor) + (e.materialCost ?? e.material), 1210),
  { total: (e.laborCost ?? e.labor) + (e.materialCost ?? e.material), expected: 1210 })

check('…and is counted, so a screen can say why the figure is short',
  e.uncostedLines === 1, { uncostedLines: e.uncostedLines })

check('T49: labour hours come from the catalogue — 2 × 8h = 16, beating the 3h typed on the job',
  money(e.laborHours ?? e.hours, 16), { got: e.laborHours ?? e.hours, expected: 16, onTheJob: 3 })

console.log('\n══════════ and a quote with nothing costed says so ══════════')
{
  const [q2] = await db.insert(quote).values({
    companyId: co.id, contactId: client.id, number: 'QT-0050', name: 'Bathroom',
    status: 'approved', subtotal: '1000.00', total: '1000.00',
  } as any).returning()
  await db.insert(quoteLineItem).values({
    quoteId: q2.id, description: 'Bathroom, all in', type: 'labor',
    quantity: '1.00', unitPrice: '1000.00', total: '1000.00', unitCost: null, sortOrder: 0,
  } as any)
  const [j2] = await db.insert(job).values({
    companyId: co.id, contactId: client.id, number: 'JOB-00050', title: 'Bathroom',
    status: 'completed', completedAt: new Date('2026-09-29'), quoteId: q2.id,
  } as any).returning()
  const d2 = await get(`/api/job-costing/job/${j2.id}`)
  const e2 = d2.json?.estimated ?? {}
  check('an entirely uncosted quote estimates $0 — it does NOT report its revenue as cost',
    money(e2.laborCost ?? e2.labor, 0) && money(e2.materialCost ?? e2.material, 0),
    { labor: e2.laborCost ?? e2.labor, material: e2.materialCost ?? e2.material, oldAnswer: 1000 })
  check('…and says one line has no cost recorded, rather than implying it breaks even',
    e2.uncostedLines === 1, { uncostedLines: e2.uncostedLines })
}

console.log('\n══════════ the roll-up agrees with the detail ══════════')
{
  const s = await get('/api/job-costing/summary?limit=100')
  check('the roll-up answers', s.status === 200, { status: s.status })
  const row = (s.json?.jobs || []).find((x: any) => x.number === 'JOB-00049')
  check('…and reports the same estimated cost as the detail (1210)',
    money(row?.estimatedCost, 1210), { got: row?.estimatedCost, expected: 1210 })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
