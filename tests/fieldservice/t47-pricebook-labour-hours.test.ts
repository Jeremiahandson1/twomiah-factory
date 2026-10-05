// crm-fieldservice — the pricebook knows how long the work takes, and the estimate never asked.
//
//   "pricebook labour hours ignored"   — T42 medium
//
// `pricebook_item.labor_hours` exists, every quote line records which catalogue item it was priced
// from (`quote_line_item.pricebook_item_id`, kept as provenance), and the estimate read neither:
//
//     const estimatedLaborHours = num(jobRow.estimatedHours)
//
// — one number somebody typed on the job, or 0 when nobody did. A quote built entirely from the
// catalogue therefore estimated zero hours, and the variance against actual hours meant nothing.
//
// This is the HOURS half of the gap T41 closed for cost: that one found pricebook_item.cost had
// "nowhere to land" and added unit_cost to the line. The hours were already on the catalogue item.
//
// WHAT IS PINNED, and the second half matters as much as the first: hours come from the catalogue
// where it states them, and the job's own typed figure is still used when the quote yields none — so
// a hand-typed estimate and every quote already in the system keep the meaning they had. A test that
// only checked the new path would pass while the fallback was broken for everybody else.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, quote, quoteLineItem, job, pricebookItem } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Wrench & Co', slug: 'wrench-t47', email: 'w47@test.local',
  settings: {}, enabledFeatures: ['jobs', 'quotes', 'pricebook', 'reports', 'time_tracking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t47@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Imelda Park', email: 'imelda-t47@test.local',
} as any).returning()

// The catalogue: one item that states its hours, one that does not.
const [pbService] = await db.insert(pricebookItem).values({
  companyId: co.id, name: 'Condenser coil clean', category: 'Maintenance',
  price: '180.00', cost: '40.00', laborHours: '1.5',
} as any).returning()
const [pbNoHours] = await db.insert(pricebookItem).values({
  companyId: co.id, name: 'Misc sundries', category: 'Other',
  price: '25.00', cost: '10.00',
} as any).returning()

const app = new Hono()
app.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
const api = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** A quote with the given lines, and a job pointing at it. */
const jobWithQuote = async (tag: string, lines: any[], estimatedHours?: string) => {
  const [q] = await db.insert(quote).values({
    companyId: co.id, contactId: client.id, number: `QTE-${tag}`, name: `Quote ${tag}`,
    status: 'approved', subtotal: '0', taxRate: '0', taxAmount: '0', discount: '0', total: '0',
  } as any).returning()
  if (lines.length) {
    await db.insert(quoteLineItem).values(lines.map((l, i) => ({ ...l, quoteId: q.id, sortOrder: i })) as any)
  }
  const [j] = await db.insert(job).values({
    companyId: co.id, contactId: client.id, number: `JOB-${tag}`, title: `Job ${tag}`,
    status: 'completed', quoteId: q.id, ...(estimatedHours ? { estimatedHours } : {}),
  } as any).returning()
  return { quote: q, job: j }
}

// ══════════ the catalogue's hours reach the estimate ════════════════════════════════════════════
console.log('\n══════════ hours from the pricebook ══════════')
{
  // 4 × a 1.5 h service = 6 h, and a sundry line that states no hours adds nothing.
  const { job: j } = await jobWithQuote('0001', [
    { description: 'Condenser coil clean', quantity: 4, unitPrice: '180.00', total: '720.00', type: 'labor', unitCost: '40.00', pricebookItemId: pbService.id },
    { description: 'Misc sundries', quantity: 2, unitPrice: '25.00', total: '50.00', type: 'material', unitCost: '10.00', pricebookItemId: pbNoHours.id },
  ])
  const r = await api(`/api/job-costing/job/${j.id}`)
  check('the analysis opens', r.status === 200, { status: r.status, body: r.text?.slice(0, 200) })
  check('T42: the estimate takes its hours from the catalogue — 4 × 1.5 = 6',
    r.json?.estimated?.laborHours === 6, { laborHours: r.json?.estimated?.laborHours })
  check('…and a catalogue item that states no hours contributes none rather than a guess',
    r.json?.estimated?.laborHours === 6, { laborHours: r.json?.estimated?.laborHours })
  check('…while the cost side still reads the line costs (4×40 + 2×10)',
    Number(r.json?.estimated?.totalCost) === 180, { totalCost: r.json?.estimated?.totalCost })
}

// ══════════ the fallback, which must keep working ═══════════════════════════════════════════════
console.log('\n══════════ a quote the catalogue cannot price ══════════')
{
  // Hand-typed lines with no pricebook link at all — the job's own figure must still be used.
  const { job: j } = await jobWithQuote('0002', [
    { description: 'Hand-written labour', quantity: 3, unitPrice: '100.00', total: '300.00', type: 'labor', unitCost: '45.00' },
  ], '7.25')
  const r = await api(`/api/job-costing/job/${j.id}`)
  check("a hand-typed quote still uses the job's own estimated hours",
    r.json?.estimated?.laborHours === 7.25, { laborHours: r.json?.estimated?.laborHours })
}

{
  // No lines at all, and no typed hours: zero, not a guess.
  const { job: j } = await jobWithQuote('0003', [])
  const r = await api(`/api/job-costing/job/${j.id}`)
  check('no quote lines and no typed hours gives zero, not an invention',
    r.json?.estimated?.laborHours === 0, { laborHours: r.json?.estimated?.laborHours })
}

{
  // The catalogue wins over the typed figure when both exist — they are two answers to one question.
  const { job: j } = await jobWithQuote('0004', [
    { description: 'Condenser coil clean', quantity: 2, unitPrice: '180.00', total: '360.00', type: 'labor', unitCost: '40.00', pricebookItemId: pbService.id },
  ], '99')
  const r = await api(`/api/job-costing/job/${j.id}`)
  check('the catalogue wins over a typed figure — 2 × 1.5 = 3, not 99',
    r.json?.estimated?.laborHours === 3, { laborHours: r.json?.estimated?.laborHours })
}

// ══════════ and the variance against actual hours now means something ══════════════════════════
console.log('\n══════════ the variance ══════════')
{
  const { job: j } = await jobWithQuote('0005', [
    { description: 'Condenser coil clean', quantity: 2, unitPrice: '180.00', total: '360.00', type: 'labor', unitCost: '40.00', pricebookItemId: pbService.id },
  ])
  const r = await api(`/api/job-costing/job/${j.id}`)
  // no time logged, so actual is 0 and the variance is the whole estimate, with a sign
  check('hours variance is actual − estimated, and is no longer measured against zero',
    r.json?.variance?.hours === -3, { variance: r.json?.variance?.hours, estimated: r.json?.estimated?.laborHours })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
