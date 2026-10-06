// A link that names one customer, and one of their addresses, must not answer with the whole yard.
//
// T51, contractor: "View All ignores the project." The reported case was Change Orders, but the same
// omission was on four other links, and the worst of them is this one: ContactDetailPage links to
// `/crm/equipment?contactId=<id>` from a customer's record and to `…&siteId=<id>` from one of their
// service addresses. The screen read neither.
//
// On a field-service shop that means "see this customer's equipment" returned every unit the company
// has ever recorded — and the one list it would not give you was this customer's. `contactId` had
// been a filter on the API all along. `siteId` was not a filter at all: the column is written when a
// unit is created and nothing had ever queried it, so a customer with three service addresses got
// all three mixed together with no way to separate them.
//
// Worth a test rather than a look because the filter is behind `opt.sites` — a column that does not
// exist in the verticals which do not enable sites — so a careless version of this fix 500s on half
// the fleet and nothing at build time would say so.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, contact, site, equipment } = schema

const [co] = await db.insert(company).values({
  name: 'Vandersteen Heating', slug: 'vandersteen-t51', email: 'hv51@test.local',
  settings: {}, enabledFeatures: ['contacts', 'equipment_tracking', 'jobs', 'team'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t51e@test.local', passwordHash: 'x', firstName: 'Olive', lastName: 'V',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

// Two customers. One of them has two service addresses — the case the siteId link exists for.
const [marit] = await db.insert(contact).values({
  companyId: co.id, name: 'Marit Vandersteen', email: 'marit-t51e@test.local',
} as any).returning()
const [other] = await db.insert(contact).values({
  companyId: co.id, name: 'Someone Else', email: 'else-t51e@test.local',
} as any).returning()

const [shop] = await db.insert(site).values({
  companyId: co.id, contactId: marit.id, name: 'The shop on Mill Lane', address: '4 Mill Lane',
} as any).returning()
const [house] = await db.insert(site).values({
  companyId: co.id, contactId: marit.id, name: 'The house', address: '91 Orchard Road',
} as any).returning()

/** Two units at the shop, one at the house, one belonging to somebody else entirely. */
const mk = async (name: string, contactId: string | null, siteId: string | null) =>
  (await db.insert(equipment).values({
    companyId: co.id, name, contactId, siteId, status: 'active',
    manufacturer: 'Carrier', model: '59SC2C', serialNumber: `SN-${name.replace(/\s+/g, '')}`,
  } as any).returning())[0]

const shopBoiler = await mk('Shop boiler', marit.id, shop.id)
const shopRtu = await mk('Shop rooftop unit', marit.id, shop.id)
const houseFurnace = await mk('House furnace', marit.id, house.id)
const theirs = await mk('Not hers', other.id, null)

const app = new Hono()
app.route('/api/equipment', (await import('./src/routes/equipment.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const call = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const namesOf = (r: any) => {
  const rows = Array.isArray(r.json) ? r.json : (r.json?.data ?? [])
  return rows.map((x: any) => x.name).sort()
}

console.log('\n══════════ the whole yard, when nothing is asked ══════════')
{
  const r = await call('/api/equipment?limit=100')
  check('every unit comes back unfiltered', r.status === 200 && namesOf(r).length === 4,
    { status: r.status, names: namesOf(r) })
}

console.log('\n══════════ one customer ══════════')
{
  const r = await call(`/api/equipment?contactId=${marit.id}&limit=100`)
  check('the list is scoped to that customer', r.status === 200, { status: r.status, body: r.text?.slice(0, 220) })
  check('…her three units, and not the fourth',
    JSON.stringify(namesOf(r)) === JSON.stringify(['House furnace', 'Shop boiler', 'Shop rooftop unit']),
    { names: namesOf(r) })
  check('…so somebody else\'s unit is not in it', !namesOf(r).includes('Not hers'), { names: namesOf(r) })
}

console.log('\n══════════ one of her addresses ══════════')
{
  const r = await call(`/api/equipment?contactId=${marit.id}&siteId=${shop.id}&limit=100`)
  check('T51: the site narrows it further', r.status === 200, { status: r.status, body: r.text?.slice(0, 220) })
  check('…the two units at the shop only',
    JSON.stringify(namesOf(r)) === JSON.stringify(['Shop boiler', 'Shop rooftop unit']),
    { names: namesOf(r), expected: ['Shop boiler', 'Shop rooftop unit'] })
  check('…and the furnace at her other address is left out', !namesOf(r).includes('House furnace'), { names: namesOf(r) })
}
{
  // The site on its own, which is what a site panel would send if it did not know the customer.
  const r = await call(`/api/equipment?siteId=${house.id}&limit=100`)
  check('a site with no contactId still filters', JSON.stringify(namesOf(r)) === JSON.stringify(['House furnace']),
    { names: namesOf(r) })
}
{
  // An id that is real but belongs to no equipment answers empty, not "everything".
  const r = await call(`/api/equipment?siteId=${shop.id}&contactId=${other.id}&limit=100`)
  check('a contact and a site that do not go together answer EMPTY, not everything',
    namesOf(r).length === 0, { names: namesOf(r) })
}
{
  // …and the other filters still work alongside it, so the new clause has not displaced them.
  const r = await call(`/api/equipment?contactId=${marit.id}&search=rooftop&limit=100`)
  check('search still composes with the contact filter',
    JSON.stringify(namesOf(r)) === JSON.stringify(['Shop rooftop unit']), { names: namesOf(r) })
}
{
  const r = await call(`/api/equipment?status=active&siteId=${shop.id}&limit=100`)
  check('…and so does status', JSON.stringify(namesOf(r)) === JSON.stringify(['Shop boiler', 'Shop rooftop unit']),
    { names: namesOf(r) })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
