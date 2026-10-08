// Which snow contract. (T59, owner pass)
//
//   "edit rows for snow contracts show 'Snow contract' instead of which contract."
//
// A snow contract has no name column: the edit row read contract.name (always null) and the screen fell
// back to "Snow contract"; the create and delete rows said "per_push contract", which is the pricing mode
// and identical for every per-push contract. Every snow audit row — contract create / edit / delete and
// visit create / delete — now names the SITE the contract covers, then the mode.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, site, auditLog } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Snow Names Co', slug: 'snow-t59', email: 's59@test.local', state: 'WI', settings: {},
  enabledFeatures: ['contacts', 'invoices', 'snow_removal'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-s59@test.local', passwordHash: 'x', firstName: 'Sam', lastName: 'Snow', role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [cust] = await db.insert(contact).values({ name: 'Oak Street Partners', type: 'client', companyId: co.id } as any).returning()
const [plaza] = await db.insert(site).values({ name: 'Oak Street Plaza', address: '12 Oak St', contactId: cust.id, companyId: co.id } as any).returning()
const [lot] = await db.insert(site).values({ name: 'Elm Ave Lot', address: '9 Elm Ave', contactId: cust.id, companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/snow', (await import('./src/routes/snowBilling.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
// audit.log is fire-and-forget in this module, so give each write a moment to land.
const settle = () => new Promise((r) => setTimeout(r, 150))
const rowsFor = async (entity: string, entityId: string) =>
  (await db.select().from(auditLog).where(and(eq(auditLog.companyId, co.id), eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)))) as any[]

console.log('\n══════════ two per-push contracts, two sites ══════════')
let a = '', b = ''
{
  const ra = await api('POST', '/api/snow/contracts', { siteId: plaza.id, billingMode: 'per_push', perPushRate: '65' })
  const rb = await api('POST', '/api/snow/contracts', { siteId: lot.id, billingMode: 'per_push', perPushRate: '55' })
  check('both contracts are made', ra.status === 201 && rb.status === 201, { a: ra.status, b: rb.status, body: ra.text?.slice(0, 200) })
  a = ra.json?.id; b = rb.json?.id
  await settle()
  const [ca] = await rowsFor('snow_contract', a), [cb] = await rowsFor('snow_contract', b)
  check('the create rows name the site', ca?.entityName === 'Oak Street Plaza — per push' && cb?.entityName === 'Elm Ave Lot — per push', [ca?.entityName, cb?.entityName])
  check('…so two per-push contracts no longer read the same', ca?.entityName !== cb?.entityName)
}

console.log('\n══════════ editing one ══════════')
{
  const up = await api('PUT', `/api/snow/contracts/${a}`, { perPushRate: '70' })
  check('the edit saves', up.status === 200, { status: up.status, body: up.text?.slice(0, 200) })
  await settle()
  const edit = (await rowsFor('snow_contract', a)).find((r) => r.action === 'update')
  check('THE EDIT ROW names which contract (it read "Snow contract")', edit?.entityName === 'Oak Street Plaza — per push', { entityName: edit?.entityName })
  check('…and still carries the before → after', (edit?.changes as any)?.perPushRate?.new !== undefined, edit?.changes)
}

console.log('\n══════════ a visit, then the deletes ══════════')
{
  const ev = await api('POST', '/api/snow/events', { snowContractId: a, pushes: 2 })
  check('a visit is logged', ev.status === 201, { status: ev.status, body: ev.text?.slice(0, 200) })
  await settle()
  const [er] = await rowsFor('snow_event', ev.json?.id)
  check('the visit row names the site', /Oak Street Plaza — per push/.test(er?.entityName || ''), { entityName: er?.entityName })
  const dv = await api('DELETE', `/api/snow/events/${ev.json?.id}`)
  await settle()
  const dvr = (await rowsFor('snow_event', ev.json?.id)).find((r) => r.action === 'delete')
  check('deleting the visit names the site too', dv.status === 204 && /Oak Street Plaza/.test(dvr?.entityName || ''), { status: dv.status, entityName: dvr?.entityName })
  const dc = await api('DELETE', `/api/snow/contracts/${b}`)
  await settle()
  const dcr = (await rowsFor('snow_contract', b)).find((r) => r.action === 'delete')
  check('deleting a contract names its site', dc.status === 204 && dcr?.entityName === 'Elm Ave Lot — per push', { status: dc.status, entityName: dcr?.entityName })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
