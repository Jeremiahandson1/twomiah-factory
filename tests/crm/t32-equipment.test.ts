// T32 H9 — "Equipment saves the name and drops everything else."
//
// The report added a piece of equipment with customer "T32 Client Rivera", install date 20 Oct 2024
// and a 24-month warranty. The saved record had no customer link, purchaseDate null, warrantyExpiry
// null and no category. And then `?warrantyExpiring=true` returned that record anyway, while the
// Warranty Expiring tile next to it said 0.
//
// Three separate causes, none of them obvious from the symptom:
//
//  1. VOCABULARY. The shared form asks for an "Install date" and "Warranty (months)" and posts
//     `installDate` / `warrantyMonths`. The service read `purchaseDate` / `warrantyExpiry`. Nothing
//     matched and nothing threw. All FOUR templates that ship this module dropped both fields.
//  2. NO COLUMN. crm-basic, crm-fieldservice and crm-landscaping all have `equipment.contact_id` and
//     all three pass `options: { contacts: true }`. The base contractor CRM had neither, so the
//     Customer field was offered, posted, and discarded.
//  3. A FILTER THAT WAS NOT A FILTER. GET /api/equipment destructured `warrantyExpiring`,
//     `needsMaintenance` and `category` out of the query string and never passed them on, so each
//     returned the unfiltered list. The tile ran a real query and was right; the filter was decoration.
//     On top of that the tile counted a 30-day window and the dedicated endpoint listed a 60-day one.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const day = (iso: string) => iso.slice(0, 10)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, equipment, equipmentCategory, equipmentMaintenance } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Kit Co', slug: 'kit-co', email: 'k@test.local', state: 'OH', settings: {},
  enabledFeatures: ['equipment_tracking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-kit@test.local', passwordHash: 'x', firstName: 'Ida', lastName: 'Shaw',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [rivera] = await db.insert(contact).values({ companyId: co.id, name: 'T32 Client Rivera', type: 'customer' } as any).returning()
const [other] = await db.insert(contact).values({ companyId: co.id, name: 'Someone Else', type: 'customer' } as any).returning()
const [cat] = await db.insert(equipmentCategory).values({ companyId: co.id, name: 'Furnaces' } as any).returning()

const app = new Hono()
app.route('/api/equipment', (await import('./src/routes/equipment.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ the record the report tried to create ══════════════════════════════════════════════
{
  const made = await api('POST', '/api/equipment', {
    name: 'Carrier 59SC5A', model: '59SC5A', manufacturer: 'Carrier', serialNumber: 'SN-11821',
    contactId: rivera.id, categoryId: cat.id, installDate: '2024-10-20', warrantyMonths: 24,
    location: 'Basement', notes: 'Second floor zone',
  })
  check('equipment is created', made.status === 201, { status: made.status, body: made.text?.slice(0, 220) })
  const id = made.json?.id
  const [row] = await db.select().from(equipment).where(eq(equipment.id, id))

  check('the CUSTOMER is linked', row?.contactId === rivera.id, { contactId: row?.contactId, expected: rivera.id })
  check('the install date is stored', row?.purchaseDate && day(new Date(row.purchaseDate).toISOString()) === '2024-10-20',
    { purchaseDate: row?.purchaseDate })
  check('24 months becomes a warranty expiry of 20 Oct 2026',
    row?.warrantyExpiry && day(new Date(row.warrantyExpiry).toISOString()) === '2026-10-20',
    { warrantyExpiry: row?.warrantyExpiry })
  check('the category is stored', row?.categoryId === cat.id, { categoryId: row?.categoryId })
  check('…and so is everything else that was typed',
    row?.model === '59SC5A' && row?.manufacturer === 'Carrier' && row?.serialNumber === 'SN-11821' && row?.location === 'Basement',
    { model: row?.model, manufacturer: row?.manufacturer, serial: row?.serialNumber, location: row?.location })

  // The form reads these keys back when you open Edit. Returning only the column names showed blanks
  // over stored values, and saving the blank form would then have cleared them.
  check('the response speaks the form\'s language back (installDate)', day(String(made.json?.installDate)) === '2024-10-20', made.json?.installDate)
  check('…and warrantyMonths round-trips as 24', made.json?.warrantyMonths === 24, made.json?.warrantyMonths)

  const detail = await api('GET', `/api/equipment/${id}`)
  check('the detail read carries them too', day(String(detail.json?.installDate)) === '2024-10-20' && detail.json?.warrantyMonths === 24,
    { installDate: detail.json?.installDate, warrantyMonths: detail.json?.warrantyMonths })
  check('…and the customer', detail.json?.contact?.name === 'T32 Client Rivera', detail.json?.contact)

  // Editing must not drop them either — PUT used to spread the raw body onto the row.
  const edited = await api('PUT', `/api/equipment/${id}`, { installDate: '2024-11-01', warrantyMonths: 12, location: 'Attic' })
  check('an edit keeps the translation', edited.status === 200, { status: edited.status, body: edited.text?.slice(0, 200) })
  const [after] = await db.select().from(equipment).where(eq(equipment.id, id))
  check('…the install date moved', day(new Date(after!.purchaseDate!).toISOString()) === '2024-11-01', after?.purchaseDate)
  check('…the warranty recomputed from it', day(new Date(after!.warrantyExpiry!).toISOString()) === '2025-11-01', after?.warrantyExpiry)
  check('…and the other field saved', after?.location === 'Attic', after?.location)
  check('…while the customer was left alone, not nulled by an edit that did not mention it',
    after?.contactId === rivera.id, after?.contactId)
}

// ══════════ a month-end install date does not roll into the next month ═════════════════════════
{
  const made = await api('POST', '/api/equipment', { name: 'Month end', installDate: '2024-01-31', warrantyMonths: 25 })
  const [row] = await db.select().from(equipment).where(eq(equipment.id, made.json.id))
  // 25 months from 31 Jan 2024 is Feb 2026, which has 28 days. Rolling to 3 March would be wrong.
  check('25 months from 31 Jan clamps to the end of February, it does not roll into March',
    day(new Date(row!.warrantyExpiry!).toISOString()) === '2026-02-28', row?.warrantyExpiry)
}

// ══════════ the filters that were not filters ══════════════════════════════════════════════════
{
  const soon = new Date(Date.now() + 20 * 86_400_000)
  const far = new Date(Date.now() + 400 * 86_400_000)
  const [expiring] = await db.insert(equipment).values({
    companyId: co.id, name: 'Warranty soon', status: 'active', contactId: other.id,
    purchaseDate: new Date('2023-01-01'), warrantyExpiry: soon,
  } as any).returning()
  await db.insert(equipment).values({
    companyId: co.id, name: 'Warranty years away', status: 'active',
    purchaseDate: new Date('2024-01-01'), warrantyExpiry: far,
  } as any)
  const [noWarranty] = await db.insert(equipment).values({
    companyId: co.id, name: 'No warranty recorded', status: 'active',
  } as any).returning()

  const all = await api('GET', '/api/equipment?limit=100')
  const filtered = await api('GET', '/api/equipment?warrantyExpiring=true&limit=100')
  const names = (r: any) => (r.json?.data || []).map((x: any) => x.name)

  check('the unfiltered list has everything', names(all).length >= 4, names(all))
  check('?warrantyExpiring=true now actually filters', names(filtered).length === 1 && names(filtered)[0] === 'Warranty soon',
    { got: names(filtered) })
  check('…so the record with NO warranty date is no longer returned by it',
    !names(filtered).includes('No warranty recorded'), names(filtered))

  const stats = await api('GET', '/api/equipment/stats')
  check('…and the tile agrees with the filter, to the row', stats.json?.warrantyExpiring === names(filtered).length,
    { tile: stats.json?.warrantyExpiring, filtered: names(filtered).length })

  const dedicated = await api('GET', '/api/equipment/warranty-expiring')
  check('…as does the dedicated endpoint, which used a different window', (dedicated.json || []).length === names(filtered).length,
    { endpoint: (dedicated.json || []).length, filtered: names(filtered).length })

  // needsMaintenance was the same no-op.
  await db.insert(equipmentMaintenance).values({
    equipmentId: noWarranty.id, type: 'service', performedAt: new Date(Date.now() - 400 * 86_400_000),
    nextDueDate: new Date(Date.now() - 10 * 86_400_000),
  } as any)
  const due = await api('GET', '/api/equipment?needsMaintenance=true&limit=100')
  check('?needsMaintenance=true filters to the one that is overdue',
    names(due).length === 1 && names(due)[0] === 'No warranty recorded', { got: names(due) })

  const byCategory = await api(`GET`, `/api/equipment?categoryId=${cat.id}&limit=100`)
  check('?categoryId filters', names(byCategory).length === 1 && names(byCategory)[0] === 'Carrier 59SC5A', { got: names(byCategory) })

  // And the Jobs screen's picker, which asks by customer — on this template that returned the whole
  // company's equipment, because there was no contact_id to filter on.
  const theirs = await api('GET', `/api/equipment?contactId=${rivera.id}&limit=100`)
  check('?contactId returns only that customer\'s assets', names(theirs).length === 1 && names(theirs)[0] === 'Carrier 59SC5A',
    { got: names(theirs) })
  check('…and not another customer\'s', !names(theirs).includes('Warranty soon'), names(theirs))
  void expiring
}

// ══════════ T41 · the category control, which did nothing at all ═══════════════════════════════
//
// The report named the vocabulary: "Equipment category filter offers HVAC / Plumbing / Electrical /
// Appliance" on a LANDSCAPING tenant. Reading the server to fix it found that none of this control
// worked on any vertical. Equipment is categorised by `categoryId`, a foreign key into the company's
// own equipment_category table, and the page knew nothing about it: it sent ?category=HVAC (a name
// where an id goes, so the filter matched nothing), posted `category: 'HVAC'` (a key createEquipment
// does not read, so the pick was dropped at every save), and rendered `row.category` (a key the list
// has never carried, so the column was blank in every row).
//
// What is pinned here is the SERVER half — the name travelling with the row, and the endpoint the
// screen now calls to create a category, which until now had no caller and therefore no rules.
{
  const rows = (r: any) => r.json?.data || []
  const list = await api('GET', '/api/equipment?limit=200')
  const carrier = rows(list).find((r: any) => r.name === 'Carrier 59SC5A')
  check('T41: a list row carries its category, not just the id',
    carrier?.category?.id === cat.id && carrier?.category?.name === 'Furnaces', carrier?.category)
  check('T41: …and a row with no category says so, rather than being absent',
    'category' in (rows(list).find((r: any) => r.name === 'Month end') || {}), rows(list).find((r: any) => r.name === 'Month end'))

  // The detail read already shaped it this way; the list now matches it instead of a second shape.
  const detail = await api('GET', `/api/equipment/${carrier.id}`)
  check('T41: the list and the detail agree on the shape',
    detail.json?.category?.id === carrier.category.id && detail.json?.category?.name === carrier.category.name,
    { list: carrier?.category, detail: detail.json?.category })

  // POST /types had no caller, so nothing had ever checked what it accepts.
  const blank = await api('POST', '/api/equipment/types', { name: '   ' })
  check('T41: a blank category name is refused', blank.status === 400, { status: blank.status, body: blank.text?.slice(0, 160) })
  const nameless = await api('POST', '/api/equipment/types', {})
  check('T41: …and so is no name at all', nameless.status === 400, { status: nameless.status, body: nameless.text?.slice(0, 160) })

  const mowers = await api('POST', '/api/equipment/types', { name: '  Mowers  ' })
  check('T41: a category is created, trimmed', mowers.status === 201 && mowers.json?.name === 'Mowers',
    { status: mowers.status, name: mowers.json?.name })
  const again = await api('POST', '/api/equipment/types', { name: 'mowers' })
  check('T41: asking again for the same name hands back the SAME row, it does not split the yard in two',
    again.json?.id === mowers.json?.id, { first: mowers.json?.id, second: again.json?.id })

  const types = await api('GET', '/api/equipment/types')
  const mowerRows = (types.json || []).filter((t: any) => String(t.name).toLowerCase() === 'mowers')
  check('T41: …so the company has exactly one "Mowers"', mowerRows.length === 1, types.json)
  check('T41: the list the screen builds its picker from carries both categories',
    (types.json || []).some((t: any) => t.id === cat.id) && (types.json || []).some((t: any) => t.id === mowers.json?.id),
    types.json)

  // And the category actually sticks now — the form sends categoryId.
  const filed = await api('POST', '/api/equipment', { name: 'Toro 60in', categoryId: mowers.json?.id })
  const refetched = rows(await api('GET', `/api/equipment?categoryId=${mowers.json?.id}&limit=100`))
  check('T41: a machine filed under the new category is found by it',
    refetched.length === 1 && refetched[0]?.id === filed.json?.id, { got: refetched.map((r: any) => r.name) })
  check('T41: …and reads its name back', refetched[0]?.category?.name === 'Mowers', refetched[0]?.category)
}

// ══════════ T41 · the four tiles, and what marking a machine broken does to them ════════════════
//
// Two faults, one shared module (crm, crm-fieldservice, crm-basic, crm-landscaping all run this):
//
//   · "Total Equipment" counted status = 'active' only, so a machine dropped out of the TOTAL the
//     moment somebody marked it broken — while the Needs Repair tile counted it separately. A yard
//     of 12 with 2 broken read "Total 10 · Needs Repair 2".
//   · The page renders "Maintenance Due" from stats.needsMaintenance, and getEquipmentStats never
//     returned that key. `?? 0` on the screen turned the missing figure into a confident zero, so
//     that tile has always read 0 — including here, where a machine is 10 days overdue.
//
// And a broken machine must stay ON the maintenance and warranty reports: it is the one you most
// need to go and look at.
{
  const list = async (q = '') => (await api('GET', `/api/equipment?limit=200${q}`)).json?.data || []
  const tiles = async () => (await api('GET', '/api/equipment/stats')).json
  const nameOf = (rows: any[]) => rows.map((r: any) => r.name)

  const before = await tiles()
  const owned = await list()

  check('T41: the Maintenance Due figure is sent at all — it was simply absent before',
    typeof before?.needsMaintenance === 'number', before)
  const dueList = await list('&needsMaintenance=true')
  check('T41: …it is not zero, because one machine is 10 days overdue', before?.needsMaintenance > 0,
    { tile: before?.needsMaintenance, list: nameOf(dueList) })
  check('T41: …and it agrees with its own list, to the row', before?.needsMaintenance === dueList.length,
    { tile: before?.needsMaintenance, list: nameOf(dueList) })
  check('T41: Total Equipment equals what the yard holds', before?.total === owned.length,
    { total: before?.total, rows: owned.length })

  // The overdue machine is the one with the maintenance record. Mark it broken.
  const overdue = dueList[0]
  const broke = await api('POST', `/api/equipment/${overdue.id}/needs-repair`, { notes: 'Will not start' })
  check('T41: a machine can be marked needing repair', broke.status === 200, { status: broke.status })

  const after = await tiles()
  check('T41: …it is counted in Needs Repair', after?.needsRepair === (before?.needsRepair || 0) + 1,
    { before: before?.needsRepair, after: after?.needsRepair })
  // THE ASSERTION THIS SECTION EXISTS FOR.
  check('T41: …and it is STILL IN THE TOTAL — the yard did not shrink because something broke',
    after?.total === before?.total, { before: before?.total, after: after?.total })
  check('T41: …and still on the Maintenance Due tile', after?.needsMaintenance === before?.needsMaintenance,
    { before: before?.needsMaintenance, after: after?.needsMaintenance })

  // Array.isArray, not `|| []`: when this endpoint 500s it answers an error OBJECT, and `.some` on
  // that threw a TypeError that ended the whole file with no summary — a broken endpoint read as a
  // broken test rather than as a failed assertion.
  const dueAfter = await api('GET', '/api/equipment/maintenance-due')
  const dueRows = Array.isArray(dueAfter.json) ? dueAfter.json : []
  check('T41: the maintenance-due list still answers with rows', dueAfter.status === 200 && Array.isArray(dueAfter.json),
    { status: dueAfter.status, body: JSON.stringify(dueAfter.json)?.slice(0, 160) })
  check('T41: …and the broken machine is still on it, which is where somebody would go find it',
    dueRows.some((r: any) => r.id === overdue.id), nameOf(dueRows))

  // Replacing one is the only thing that takes it out of the yard.
  const [spare] = await db.insert(equipment).values({
    companyId: co.id, name: 'Old spare', status: 'active',
  } as any).returning()
  const withSpare = await tiles()
  check('T41: adding a machine raises the total', withSpare?.total === (after?.total || 0) + 1,
    { before: after?.total, after: withSpare?.total })

  const gone = await api('POST', `/api/equipment/${spare.id}/replaced`, { notes: 'Scrapped' })
  check('T41: a machine can be marked replaced', gone.status === 200, { status: gone.status })
  const afterGone = await tiles()
  check('T41: …and THAT is what lowers the total — replaced means gone from the yard',
    afterGone?.total === after?.total, { expected: after?.total, got: afterGone?.total })
  check('T41: …without being counted as needing repair', afterGone?.needsRepair === after?.needsRepair,
    { before: after?.needsRepair, after: afterGone?.needsRepair })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
