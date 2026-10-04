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
import { sql } from 'drizzle-orm'

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

// ══════════ THE THREE MEDIUMS FROM THE SAME SECTION ═════════════════════════════════════════════
//
//   "Staff also sees Parts Inventory cost and value, Rentals revenue $2,125, and service revenue on
//    the dashboard."
//
// Same shape as the highs above, three more doors. The line each one draws is the same line: what
// the person SELLS WITH stays, what the business PAID or TOOK goes.
console.log('\n── the parts bin ──')
{
  const { inventoryItem, inventoryLocation, stockLevel } = await import('./db/schema.ts')
  const [loc] = await db.insert(inventoryLocation).values({
    companyId: co.id, name: 'Main Warehouse', type: 'warehouse',
  } as any).returning()
  // Figures chosen so each one is distinct and none can be mistaken for another:
  //   cost 41.25, retail 89.99, eight on the shelf → stock value 330.00
  const [part] = await db.insert(inventoryItem).values({
    companyId: co.id, sku: 'PART-T41', name: 'Slide-out seal kit', category: 'chassis',
    unitCost: '41.25', unitPrice: '89.99', unit: 'each', vendor: 'Lippert',
  } as any).returning()
  await db.insert(stockLevel).values({ itemId: part.id, locationId: loc.id, quantity: 8 } as any)

  const inv = new Hono()
  inv.route('/api/inventory', (await import('./src/routes/inventory.ts')).default)
  inv.onError((await import('./src/utils/errors.ts')).errorHandler)
  const invAs = (who: any) => async (path: string) => {
    const res = await inv.request(path, { headers: { 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const ownerParts = await invAs(owner)('/api/inventory/items')
  check('the owner sees the part with its cost',
    ownerParts.status === 200 && /41\.25/.test(ownerParts.text || ''), { status: ownerParts.status, body: ownerParts.text?.slice(0, 200) })

  const floorParts = await invAs(salesperson)('/api/inventory/items')
  const row = (floorParts.json?.data || [])[0]
  check('T41: the floor still gets the parts list — knowing there are eight on the shelf is the work',
    floorParts.status === 200 && row?.sku === 'PART-T41' && Number(row?.totalStock) === 8,
    { status: floorParts.status, row })
  check('T41: …with the RETAIL price, which is what they quote', Number(row?.unitPrice) === 89.99, row?.unitPrice)
  check('T41: …and no unitCost key at all', !('unitCost' in (row || {})), row)
  check('T41: …and 41.25 appears nowhere in the payload', !/41\.25/.test(floorParts.text || ''),
    (floorParts.text || '').slice(0, 300))
  check('T41: …the supplier and the part number survive — that is how a part gets ordered',
    row?.vendor === 'Lippert' && 'sku' in (row || {}), { vendor: row?.vendor })

  const floorLoc = await invAs(salesperson)(`/api/inventory/locations/${loc.id}/inventory`)
  check('T41: a location\'s stock carries no cost either', floorLoc.status === 200 && !/41\.25/.test(floorLoc.text || ''),
    { status: floorLoc.status, body: (floorLoc.text || '').slice(0, 200) })

  // The valuation report is nothing BUT money, so it is refused rather than emptied.
  const ownerValue = await invAs(owner)('/api/inventory/reports/value')
  check('the owner can still run the inventory valuation', ownerValue.status === 200,
    { status: ownerValue.status, body: (ownerValue.text || '').slice(0, 160) })
  check('…and it says 330.00 of stock at cost', /330/.test(ownerValue.text || ''), (ownerValue.text || '').slice(0, 200))
  const floorValue = await invAs(salesperson)('/api/inventory/reports/value')
  check('T41: the floor is REFUSED the valuation report — there is nothing left of it without the money',
    floorValue.status === 403, { status: floorValue.status, body: (floorValue.text || '').slice(0, 160) })
}

console.log('\n── the rental fleet ──')
{
  const { rentalReservation } = await import('./db/schema.ts')
  // $1,400 + $725 = $2,125, the figure the report quotes, plus a cancelled one that must not count.
  const mkRental = (label: string, rate: string, days: number, total: string, status: string) =>
    db.insert(rentalReservation).values({
      companyId: co.id, unitId: rig.id, unitLabel: label, customerName: 'Rental Customer',
      startDate: '2026-07-01', endDate: '2026-07-08', days, dailyRate: rate, total, status,
    } as any)
  await mkRental('Vista A', '200.00', 7, '1400.00', 'out')
  await mkRental('Vista B', '145.00', 5, '725.00', 'reserved')
  await mkRental('Vista C', '500.00', 2, '1000.00', 'cancelled')

  const rent = new Hono()
  rent.route('/api/rentals', (await import('./src/routes/rentals.ts')).default)
  rent.onError((await import('./src/utils/errors.ts')).errorHandler)
  const rentAs = (who: any) => async (path: string) => {
    const res = await rent.request(path, { headers: { 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const ownerRent = await rentAs(owner)('/api/rentals/list')
  check('the owner sees rental revenue of 2,125 — the cancelled booking is not in it',
    ownerRent.status === 200 && Number(ownerRent.json?.summary?.revenue) === 2125,
    { status: ownerRent.status, summary: ownerRent.json?.summary })

  const floorRent = await rentAs(salesperson)('/api/rentals/list')
  check('T41: the floor still gets the reservations', floorRent.status === 200 && (floorRent.json?.rentals || []).length === 3,
    { status: floorRent.status, n: (floorRent.json?.rentals || []).length })
  check('T41: …with the daily rate and the total on each one — that is the quote they give',
    (floorRent.json?.rentals || []).some((r: any) => Number(r.rate) === 200 && Number(r.total) === 1400),
    (floorRent.json?.rentals || []).map((r: any) => [r.unit, r.rate, r.total]))
  check('T41: …and the availability counts', floorRent.json?.summary?.active === 1 && floorRent.json?.summary?.reserved === 1,
    floorRent.json?.summary)
  check('T41: …but NO revenue key on the summary', !('revenue' in (floorRent.json?.summary || {})),
    floorRent.json?.summary)
  check('T41: …absent rather than zeroed', !/"revenue"/.test(JSON.stringify(floorRent.json?.summary || {})),
    floorRent.json?.summary)

  const mgrRent = await rentAs(manager)('/api/rentals/list')
  check('…and the manager still sees it — a permission, not a rank',
    Number(mgrRent.json?.summary?.revenue) === 2125, mgrRent.json?.summary)
}

console.log('\n── the dashboard ──')
{
  const { repairOrder } = await import('./db/schema.ts')
  // Completed inside this month, so it lands in the month's service revenue.
  const now = new Date()
  const inMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(15, now.getDate()))
  await db.insert(repairOrder).values({
    companyId: co.id, customerId: buyer.id, roNumber: 'RO-T41', status: 'closed',
    services: [], actualTotal: '1845.50', completedAt: inMonth,
  } as any)
  await db.insert(repairOrder).values({
    companyId: co.id, customerId: buyer.id, roNumber: 'RO-T41-OPEN', status: 'in_progress', services: [],
  } as any)

  const dash = new Hono()
  dash.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
  dash.onError((await import('./src/utils/errors.ts')).errorHandler)
  const dashAs = (who: any) => async () => {
    const res = await dash.request('/api/dashboard/stats', { headers: { 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const ownerDash = await dashAs(owner)()
  check('the owner\'s dashboard carries the month\'s service revenue',
    ownerDash.status === 200 && Number(ownerDash.json?.service?.revenueThisMonth) === 1845.5,
    { status: ownerDash.status, service: ownerDash.json?.service })

  const floorDash = await dashAs(salesperson)()
  check('T41: the floor still gets the service WORKLOAD — that is how the day is run',
    floorDash.status === 200 && Number(floorDash.json?.service?.openRepairOrders) === 1
    && Number(floorDash.json?.service?.repairOrdersThisMonth) >= 1,
    { status: floorDash.status, service: floorDash.json?.service })
  check('T41: …and no revenueThisMonth key', !('revenueThisMonth' in (floorDash.json?.service || {})),
    floorDash.json?.service)
  check('T41: …1845.5 appears nowhere in the payload', !/1845/.test(floorDash.text || ''),
    (floorDash.text || '').slice(0, 300))
  // The rest of the dashboard is the floor's own work and must survive.
  check('T41: …while inventory counts and the sales pipeline are untouched',
    typeof floorDash.json?.inventory?.total === 'number' && typeof floorDash.json?.sales?.openLeads === 'number',
    { inventory: floorDash.json?.inventory?.total, sales: floorDash.json?.sales?.openLeads })
}

// ══════════ T42: THE SEAT T41 LEFT HOLDING EVERYTHING ═══════════════════════════════════════════
//
//   "Viewer sees what staff can't: /api/units cost on 16 of 25 units; /api/fi/products cost; the full
//    Accounting ledger (64 entries, $29,065); rental revenue; team list; syndication token."
//                                                                             — RV, HIGH
//
//   "Decide whether viewers should see money, then apply the staff stripping to viewer or document it
//    as intended."                                                     — T42, fleet-wide
//
// T41 gated every figure above on `invoices:read`, which `viewer` holds — so the sales floor lost the
// cost and the read-only seat kept it. The decision T42 asked for is that this is TWO questions:
//
//   REVENUE      the ledger, rental income, the roster — a bookkeeper's job. Stays.
//   COST/MARGIN  what the store PAID. `margin:read`: owner, admin, manager.
//
// Both halves are asserted, because "apply the staff stripping to viewer" would have emptied the one
// seat whose purpose is reading the books, and that would be the other bug.
console.log('\n══════════ T42 · revenue is the office seat\'s, cost is not ══════════')
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const viewer = await mk('viewer', 'books')
{
  const ledger = await as(viewer)('/api/accounting/status')
  check('the read-only seat still reads the invoice ledger — revenue is what it is for',
    ledger.status === 200, { status: ledger.status, body: ledger.text?.slice(0, 160) })
  check('…and the 29,065 is on it', /29065|29,065/.test(ledger.text || ''), (ledger.text || '').slice(0, 200))

  const units = await as(viewer)('/api/units')
  check('…it reads the inventory', units.status === 200 && /ST-T41/.test(units.text || ''),
    { status: units.status, n: (units.json?.data || []).length })
  check('…with MSRP, listed and internet price — what the unit SELLS at',
    /129900/.test(units.text || '') && /114900/.test(units.text || ''), (units.text || '').slice(0, 200))
  check('T42: …and NOT the 92,450 dealer cost', !/92450/.test(units.text || '') && !/"cost"/.test(units.text || ''),
    (units.text || '').slice(0, 300))

  const one = await as(viewer)(`/api/units/${rig.id}`)
  check('T42: …nor on the single unit', one.status === 200 && !/92450/.test(one.text || ''),
    { status: one.status, body: (one.text || '').slice(0, 200) })

  const menu = await as(viewer)('/api/fi/products')
  check('T42: …nor the F&I product cost, while the 1,895 selling price stays',
    menu.status === 200 && /1895/.test(menu.text || '') && !/1100/.test(menu.text || '') && !/"cost"/.test(menu.text || ''),
    (menu.text || '').slice(0, 240))

  // …and the manager keeps it, which is what makes this a permission rather than a rank.
  const mgrUnits = await as(manager)('/api/units')
  check('the manager still sees the dealer cost — margin:read, not a rank',
    /92450/.test(mgrUnits.text || ''), (mgrUnits.text || '').slice(0, 200))
}

// ══════════ T42: the public feed token is ISSUED by this GET ═════════════════════════════════════
//
// GET /syndication/token asked `contacts:read` — every seat — and MINTED a token when the company had
// none. A read that creates a credential is not a read. Rotating one has always needed
// `contacts:update`; so does this now, which is the line the portal link draws on the contractor
// template: whoever may hand the URL out is whoever may create it.
console.log('\n── the syndication feed token ──')
{
  const synd = new Hono()
  synd.route('/api/syndication', (await import('./src/routes/syndication.ts')).default)
  synd.onError((await import('./src/utils/errors.ts')).errorHandler)
  const syndAs = (who: any) => async (path: string) => {
    const res = await synd.request(path, { headers: { 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const byViewer = await syndAs(viewer)('/api/syndication/token')
  check('T42: the read-only seat is refused the feed token', byViewer.status === 403,
    { status: byViewer.status, body: (byViewer.text || '').slice(0, 160) })
  check('…and no token or URL comes back with the refusal',
    !/inventory\.csv/.test(byViewer.text || '') && !byViewer.json?.token, (byViewer.text || '').slice(0, 200))

  const byFloor = await syndAs(salesperson)('/api/syndication/token')
  check('T42: …and so is the sales floor', byFloor.status === 403, { status: byFloor.status })

  // Nothing was minted while those two were being refused.
  const before = await rows(sql`SELECT feed_token FROM company WHERE id = ${co.id}`)
  check('…and a refused read did not quietly create the credential',
    !before[0]?.feed_token, before[0])

  const byOwner = await syndAs(owner)('/api/syndication/token')
  check('the owner gets the token and the three feed URLs — the feature still works',
    byOwner.status === 200 && !!byOwner.json?.token && /inventory\.csv$/.test(String(byOwner.json?.urls?.csv || '')),
    { status: byOwner.status, csv: byOwner.json?.urls?.csv })
  const after = await rows(sql`SELECT feed_token FROM company WHERE id = ${co.id}`)
  check('…and THAT read is what issued it', String(after[0]?.feed_token || '') === String(byOwner.json?.token),
    { stored: after[0]?.feed_token, returned: byOwner.json?.token })

  // The FEED itself is the listing data a marketplace pulls publicly. Still open to every seat.
  const feed = await syndAs(salesperson)('/api/syndication/feed')
  check('the feed itself is unchanged — the floor can still export the listings',
    feed.status === 200, { status: feed.status, body: (feed.text || '').slice(0, 120) })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
