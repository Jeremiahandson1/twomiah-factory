// T32 L8 and M4 — takeoff quantities, and the Export to PO button that never fired.
//
// L8  "Takeoff quantities fractional and rounded up: 11.97 studs and 7.98 sheets; 11.9625 is shown
//     as 11.97." Rounding up was the right instinct — a takeoff with waste tells you what to ORDER,
//     and 11 studs leaves the wall short — applied to two decimals instead of to the unit.
// M4  "Export to PO has no click handler." Wiring it exposed something behind it: the service wrote
//     to `purchase_order`, the INVENTORY restock table, with a free-text vendor and a `locationId`
//     the code filled with the vendor id as an admitted placeholder. The Purchase Orders screen, the
//     vendor portal and the commitment total all read `job_purchase_order` — so an exported takeoff
//     produced a record the user could never see, on any screen, counting towards nothing.
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
const { company, user, contact, project, jobPurchaseOrder, jobPurchaseOrderLine } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Takeoff Co', slug: 'takeoff-co', email: 't@test.local', state: 'OH', settings: {},
  enabledFeatures: ['takeoff_tools', 'purchase_orders', 'projects'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-tk@test.local', passwordHash: 'x', firstName: 'Tor', lastName: 'Kelly',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Takeoff Client', type: 'customer' } as any).returning()
const [vendorCo] = await db.insert(contact).values({ companyId: co.id, name: 'Builders Merchant', type: 'vendor' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Wall Framing', number: 'PRJ-TK', status: 'active',
} as any).returning()

const app = new Hono()
app.route('/api/takeoffs', (await import('./src/routes/takeoffs.ts')).default)
app.route('/api/purchase-orders', (await import('./src/routes/purchaseOrders.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// An assembly whose quantities land on awkward fractions on purpose: 0.75 studs per linear foot with
// 10% waste over 14.5 ft is 11.9625 studs — the report's exact figure. And a sheet unit, and a
// pound unit, so the discrete/continuous split is exercised in one sheet.
const asm = await api('POST', '/api/takeoffs/assemblies', {
  name: 'Wall (2x4)', category: 'framing', measurementType: 'linear', wasteFactor: 10,
  materials: [
    { name: '2x4x8 Stud', quantityPer: 0.75, unit: 'each', unitCost: 4.5 },
    { name: '1/2" Drywall 4x8', quantityPer: 0.5, unit: 'sheet', unitCost: 12 },
    { name: '16d Framing Nails', quantityPer: 0.5, unit: 'lb', unitCost: 3 },
  ],
})
check('an assembly is created', asm.status === 201 || asm.status === 200, { status: asm.status, body: asm.text?.slice(0, 200) })

const sheet = await api('POST', `/api/takeoffs/project/${proj.id}`, { name: 'Ground floor', description: 'Framing' })
check('a takeoff sheet is created', sheet.status === 201 || sheet.status === 200, { status: sheet.status, body: sheet.text?.slice(0, 200) })
const sheetId = sheet.json?.id

const item = await api('POST', `/api/takeoffs/sheets/${sheetId}/items`, {
  assemblyId: asm.json?.id, description: 'North wall', length: 14.5, quantity: 1,
})
check('an item is measured onto the sheet', item.status === 201 || item.status === 200, { status: item.status, body: item.text?.slice(0, 220) })

// ══════════ L8 · whole units for things, decimals for measures ═════════════════════════════════
{
  const totals = await api('GET', `/api/takeoffs/sheets/${sheetId}/totals`)
  check('the totals answer', totals.status === 200, { status: totals.status, body: totals.text?.slice(0, 200) })
  const mats: any[] = totals.json?.materials || []
  const byName = (n: string) => mats.find((m) => String(m.name).includes(n))

  const stud = byName('Stud')
  check('studs are a WHOLE number — you cannot buy 11.97 of them',
    Number.isInteger(stud?.totalQuantity), { totalQuantity: stud?.totalQuantity, reportSaw: 11.97 })
  check('…rounded UP, because 11 studs leaves the wall short', Number(stud?.totalQuantity) === 12,
    { totalQuantity: stud?.totalQuantity })
  check('…and the measured figure is still reported, not thrown away',
    Math.abs(Number(stud?.exactQuantity) - 11.9625) < 0.0001, { exactQuantity: stud?.exactQuantity })

  const sheets = byName('Drywall')
  check('sheets are whole too', Number.isInteger(sheets?.totalQuantity) && Number(sheets?.totalQuantity) === 8,
    { totalQuantity: sheets?.totalQuantity, exact: sheets?.exactQuantity })

  const nails = byName('Nails')
  check('nails are sold by the POUND, so they keep their decimals — rounding that up invents material',
    !Number.isInteger(Number(nails?.totalQuantity)) && Math.abs(Number(nails?.totalQuantity) - 7.98) < 0.01,
    { totalQuantity: nails?.totalQuantity })
}

// ══════════ M4 · the export raises a REAL purchase order ═══════════════════════════════════════
{
  const before = await api('GET', '/api/purchase-orders?limit=50')
  const countBefore = (before.json?.data || []).length

  const exported = await api('POST', `/api/takeoffs/sheets/${sheetId}/export-po`, { vendorId: vendorCo.id })
  check('the export answers', exported.status === 201, { status: exported.status, body: exported.text?.slice(0, 260) })
  check('…numbered in the project\'s PO sequence, not PO-TK-<epoch>',
    /^PO-\d{5}$/.test(String(exported.json?.number || '')), exported.json?.number)

  // The point: it is visible on the screen that lists purchase orders.
  const after = await api('GET', '/api/purchase-orders?limit=50')
  check('…and it appears on the Purchase Orders list', (after.json?.data || []).length === countBefore + 1,
    { before: countBefore, after: (after.json?.data || []).length })
  const row = (after.json?.data || []).find((p: any) => p.id === exported.json?.id)
  check('…addressed to the vendor as a CONTACT, not free text', row?.vendor?.name === 'Builders Merchant',
    { vendor: row?.vendor })
  check('…attached to the sheet\'s project', row?.projectId === proj.id, { projectId: row?.projectId })
  check('…as a draft, so it is not a commitment until somebody sends it', row?.status === 'draft', row?.status)

  // And it is internally consistent: the old code put a ceil'd quantity beside an un-ceil'd cost.
  const lines = await db.select().from(jobPurchaseOrderLine).where(eq(jobPurchaseOrderLine.purchaseOrderId, exported.json.id))
  check('every line has a quantity, a unit cost and a total that multiply out', lines.length === 3 &&
    lines.every((l: any) => cents(l.total) === cents(Number(l.quantity) * Number(l.unitCost))),
    lines.map((l: any) => `${l.quantity}×${l.unitCost}=${l.total}`))
  const [po] = await db.select().from(jobPurchaseOrder).where(eq(jobPurchaseOrder.id, exported.json.id))
  const lineSum = lines.reduce((s: number, l: any) => s + Number(l.total), 0)
  check('…and the order total is the sum of its lines', cents(po?.total) === cents(lineSum),
    { total: po?.total, lineSum })
  check('…the stud line is for 12, the figure somebody will order',
    cents(lines.find((l: any) => /Stud/.test(l.description))?.quantity) === 1200,
    lines.find((l: any) => /Stud/.test(l.description))?.quantity)

  // Nothing landed in the inventory restock table, which is where this used to go.
  const inv: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM purchase_order`)
  check('nothing was written to the INVENTORY purchase_order table', Number((inv.rows || inv)[0]?.n) === 0,
    (inv.rows || inv)[0])
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
