// crm-rv — T41. What the sales floor is not shown.
//
// Three findings, all the same shape: a money read with no gate, while the endpoint that owns that
// money refuses the same seat.
//
// H  "Staff can read the whole ledger: /crm/accounting shows 64 entries, $29,065, each invoice with
//     customer and amount (GET /api/accounting/status 200), plus Connect and Sync to QuickBooks
//     buttons. /api/invoices is correctly 403."
//    That last sentence is the argument: the invoice routes already refuse this seat and this
//    endpoint handed over the same invoices — number, customer, amount — by another door.
//
// H  "Dealer cost sent to staff in the API: /api/units cost on 17 of 26 units; /api/fi/products
//     cost next to price (VSC 1895/1100). Not shown in the UI."
//    "Not shown in the UI" is not a defence. The API is the product.
//
// WHAT IS DELIBERATELY STILL VISIBLE, and asserted: MSRP, listed price and internet price on a
// unit, and the F&I menu's selling price. A salesperson negotiates with all of those. It is the
// COST — the margin they are negotiating against — that is withheld.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, unit, invoice } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Zacho Powersports', slug: 'zacho-t41money', email: 'z-t41@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t41m@zacho.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
const salesperson = await mk('field', 'floor')

const [buyer] = await db.insert(contact).values({
  companyId: co.id, name: 'Dale Buyer', type: 'client', email: 'dale-t41@test.local',
} as any).returning()

// A unit with every price AND the dealer cost.
const [rig] = await db.insert(unit).values({
  companyId: co.id, category: 'motorhome', stockNumber: 'ST-T41', year: 2026,
  make: 'Winnebago', modelName: 'Vista', status: 'available', condition: 'new',
  msrp: '129900.00', listedPrice: '119900.00', internetPrice: '114900.00', cost: '92450.00',
} as any).returning()

// An unposted, postable invoice — the shape the Accounting ledger lists.
await db.insert(invoice).values({
  companyId: co.id, contactId: buyer.id, number: 'INV-T41M-1', status: 'sent',
  subtotal: '29065.00', taxRate: '0', taxAmount: '0', discount: '0', total: '29065.00', amountPaid: '0',
} as any)

const app = new Hono()
app.route('/api/accounting', (await import('./src/routes/accounting.ts')).default)
app.route('/api/units', (await import('./src/routes/units.ts')).default)
app.route('/api/fi', (await import('./src/routes/fi.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ the accounting ledger ═══════════════════════════════════════════════════════════════
console.log('\n── who may read the ledger ──')
{
  const byOwner = await as(owner)('/api/accounting/status')
  check('the owner reads the ledger', byOwner.status === 200, { status: byOwner.status, body: byOwner.text?.slice(0, 160) })
  check('…and the unposted invoice is on it, with the customer and the amount',
    /INV-T41M-1/.test(byOwner.text || '') && /29065/.test(byOwner.text || '') && /Dale Buyer/.test(byOwner.text || ''),
    (byOwner.json?.pending || []).length)

  const byManager = await as(manager)('/api/accounting/status')
  check('a manager reads it too — it holds invoices:read', byManager.status === 200, { status: byManager.status })

  // THE ASSERTION THIS SECTION EXISTS FOR.
  const byFloor = await as(salesperson)('/api/accounting/status')
  check('T41: the sales floor is REFUSED the ledger', byFloor.status === 403,
    { status: byFloor.status, body: byFloor.text?.slice(0, 200) })
  check('T41: …and no invoice number, customer or amount comes back with the refusal',
    !/INV-T41M-1|29065|Dale Buyer/.test(byFloor.text || ''), byFloor.text?.slice(0, 200))
}

// ══════════ dealer cost on a unit ═══════════════════════════════════════════════════════════════
console.log('\n── dealer cost on the inventory ──')
{
  const ownerList = await as(owner)('/api/units?limit=50')
  check('the owner reads the inventory with cost', ownerList.status === 200 && /92450/.test(ownerList.text || ''),
    { status: ownerList.status })

  const floorList = await as(salesperson)('/api/units?limit=50')
  check('T41: the sales floor still reads the inventory — it has to', floorList.status === 200,
    { status: floorList.status })
  check('T41: …and the unit is there', /ST-T41/.test(floorList.text || ''), (floorList.json?.data || []).length)
  // THE ASSERTION.
  check('T41: …with NO dealer cost', !/92450/.test(floorList.text || '') && !/"cost"/.test(floorList.text || ''),
    (floorList.text || '').slice(0, 240))
  // …and every SELLING price kept, because a salesperson negotiates with them.
  check('T41: …but MSRP, listed and internet price all still there',
    /129900/.test(floorList.text || '') && /119900/.test(floorList.text || '') && /114900/.test(floorList.text || ''),
    (floorList.text || '').slice(0, 240))

  const floorOne = await as(salesperson)(`/api/units/${rig.id}`)
  check('T41: the single unit read opens', floorOne.status === 200, { status: floorOne.status })
  check('T41: …also without cost, and still with the prices',
    !/92450/.test(floorOne.text || '') && /114900/.test(floorOne.text || ''), (floorOne.text || '').slice(0, 200))

  const mgrOne = await as(manager)(`/api/units/${rig.id}`)
  check('T41: a manager still sees the cost', /92450/.test(mgrOne.text || ''), (mgrOne.text || '').slice(0, 160))
}

// ══════════ the F&I menu ════════════════════════════════════════════════════════════════════════
console.log('\n── the F&I menu ──')
{
  const ownerMenu = await as(owner)('/api/fi/products')
  check('the owner sees the menu with cost', ownerMenu.status === 200 && /1100/.test(ownerMenu.text || ''),
    { status: ownerMenu.status })

  const floorMenu = await as(salesperson)('/api/fi/products')
  check('T41: the sales floor still gets the MENU — menu selling is the job', floorMenu.status === 200
    && /Vehicle Service Contract/.test(floorMenu.text || ''), { status: floorMenu.status })
  check('T41: …with the 1895 selling price', /1895/.test(floorMenu.text || ''), (floorMenu.text || '').slice(0, 200))
  // THE ASSERTION — the exact pair the report quotes.
  check('T41: …and NOT the 1100 dealer cost', !/1100/.test(floorMenu.text || '') && !/"cost"/.test(floorMenu.text || ''),
    (floorMenu.text || '').slice(0, 240))
  check('T41: …nor any of the other four costs', !/": ?(350|220|300|180)\b/.test(floorMenu.text || ''),
    (floorMenu.text || '').slice(0, 240))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
