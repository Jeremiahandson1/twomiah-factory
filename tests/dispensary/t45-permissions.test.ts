// crm-dispensary — the T45 permission mediums: who may do what.
//
//   M19  The Team page offered a manager "Add Member" and the server answers 403 — a dialog that
//        takes a name, an email and a role and then refuses.
//   M20  A manager could change owner-level module settings: the SMS switch (which spends the
//        messaging wallet), Offline settings, and referral reward amounts. They could also create
//        locations, store groups and file a tax return.
//   M21  Supplier costs (purchase orders) and wholesale totals were readable by a budtender, and
//        both pages were in the budtender's menu. Other customers' ID scans were readable too.
//   M22  A budtender could text ANY number with any contact id attached — the only thing stopping
//        them was an empty messaging wallet.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Roles Dispensary', slug: 'roles', email: 'roles@test.local', state: 'OH',
  enabledFeatures: [
    'products', 'orders', 'purchase_orders', 'wholesale', 'id_verification', 'multi_location',
    'multi_store', 'franchise', 'offline_mode', 'referrals', 'tax_filing', 'sms_marketing',
  ],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-roles@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, phone: '555-0100', dateOfBirth: '1980-01-01',
} as any).returning()
const [noPhone] = await db.insert(contact).values({
  type: 'customer', name: 'Bo Nophone', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/team', 'team'],
  ['/api/purchase-orders', 'purchase-orders'],
  ['/api/wholesale', 'wholesale'],
  ['/api/id-scanner', 'id-scanner'],
  ['/api/locations', 'locations'],
  ['/api/enterprise', 'enterprise'],
  ['/api/offline', 'offline'],
  ['/api/referrals', 'referrals'],
  ['/api/integrations', 'integrations'],
  ['/api/sms', 'sms'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, text: t, json: j }
}
const asOwner = as(owner)
const asAdmin = as(admin)
const asManager = as(manager)
const asBudtender = as(budtender)

// ── M19: the Team page's Add Member ─────────────────────────────────────────────────────────────
const managerAdds = await asManager('POST', '/api/team', {
  name: 'New Hire', email: 'hire@test.local', role: 'budtender',
})
check('M19: a manager cannot add a team member', managerAdds.status === 403, { status: managerAdds.status, body: managerAdds.json })

const adminAdds = await asAdmin('POST', '/api/team', {
  name: 'New Hire', email: 'hire@test.local', role: 'budtender',
})
check('M19: an admin can', adminAdds.status === 201 || adminAdds.status === 200, { status: adminAdds.status, body: adminAdds.json })

const managerReadsTeam = await asManager('GET', '/api/team')
check('M19: ...and a manager can still see the roster', managerReadsTeam.status === 200, { status: managerReadsTeam.status })

// ── M20: shop-wide settings are an owner or admin decision ──────────────────────────────────────
const cases: Array<[string, string, string, any]> = [
  ['switch SMS on', 'POST', '/api/integrations/sms/toggle', { enabled: true }],
  ['change the offline settings', 'PUT', '/api/offline/config', { offlineEnabled: false }],
  ['change the referral rewards', 'PUT', '/api/referrals/config', { referrerReward: 500 }],
  ['open a location', 'POST', '/api/locations', { name: 'Second Shop', type: 'dispensary' }],
  ['create a store group', 'POST', '/api/enterprise/store-groups', { name: 'Ohio Chain', type: 'chain' }],
]
for (const [what, method, path, body] of cases) {
  const asMgr = await asManager(method, path, body)
  check(`M20: a manager cannot ${what}`, asMgr.status === 403, { status: asMgr.status, body: asMgr.json })
  const asAdm = await asAdmin(method, path, body)
  check(`M20: ...and an admin can`, asAdm.status < 400, { what, status: asAdm.status, body: asAdm.json })
}

// The operational half of those modules stays a manager's job.
const [loc] = ((await db.execute(sql`SELECT id FROM locations WHERE company_id = ${co.id} LIMIT 1`)) as any).rows || []
if (loc) {
  const count = await asManager('POST', `/api/locations/${loc.id}/count`, { items: [] })
  check('M20: ...but a stock count at a location that exists is still manager work', count.status !== 403,
    { status: count.status, body: count.json })
}

// ── M21: what a budtender may read ──────────────────────────────────────────────────────────────
const budPOs = await asBudtender('GET', '/api/purchase-orders')
check('M21: a budtender cannot read supplier costs', budPOs.status === 403, { status: budPOs.status, body: budPOs.json })
const mgrPOs = await asManager('GET', '/api/purchase-orders')
check('M21: ...a manager can', mgrPOs.status === 200, { status: mgrPOs.status })

const budWholesale = await asBudtender('GET', '/api/wholesale/customers')
check('M21: a budtender cannot read wholesale buyers', budWholesale.status === 403, { status: budWholesale.status, body: budWholesale.json })
const mgrWholesale = await asManager('GET', '/api/wholesale/customers')
check('M21: ...a manager can', mgrWholesale.status === 200, { status: mgrWholesale.status })

const budScans = await asBudtender('GET', '/api/id-scanner/scans')
check('M21: a budtender cannot read other customers\' ID scans', budScans.status === 403, { status: budScans.status, body: budScans.json })
const budHistory = await asBudtender('GET', '/api/id-scanner/history')
check('M21: ...nor the scan history', budHistory.status === 403, { status: budHistory.status })
const mgrScans = await asManager('GET', '/api/id-scanner/scans')
check('M21: ...a manager can', mgrScans.status === 200, { status: mgrScans.status })

// Checking an ID at the counter is the budtender's actual job and must still work.
const budScan = await asBudtender('POST', '/api/id-scanner/scan', {
  scanMethod: 'manual', firstName: 'Ada', lastName: 'Customer', dateOfBirth: '1980-01-01',
})
check('M21: ...and a budtender can still scan an ID', budScan.status === 200 || budScan.status === 201,
  { status: budScan.status, body: budScan.json })

// ── M22: who a budtender may text ───────────────────────────────────────────────────────────────
const anyNumber = await asBudtender('POST', '/api/sms/send', { toPhone: '+15558675309', message: 'hi' })
check('M22: a budtender cannot text a number that is not on the books', anyNumber.status === 403,
  { status: anyNumber.status, body: anyNumber.json })
check('M22: ...and is told what to do instead', anyNumber.json?.code === 'contact_required', anyNumber.json)

const otherTenant = await asBudtender('POST', '/api/sms/send', { contactId: 'not-ours', message: 'hi' })
check('M22: a contact id that is not this shop\'s is refused', otherTenant.status === 404, { status: otherTenant.status, body: otherTenant.json })

const noNumberOnFile = await asBudtender('POST', '/api/sms/send', { contactId: noPhone.id, message: 'hi' })
check('M22: a customer with no number on file is a plain refusal', noNumberOnFile.status === 400, { status: noNumberOnFile.status, body: noNumberOnFile.json })

// Texting a real customer is the job, and must still work — it gets as far as the wallet.
const realCustomer = await asBudtender('POST', '/api/sms/send', { contactId: cust.id, message: 'Your order is ready' })
check('M22: texting one of this shop\'s customers is not blocked by the role',
  realCustomer.status !== 403 && realCustomer.status !== 404, { status: realCustomer.status, body: realCustomer.json })

// A manager may still text a number that is not yet a customer.
const managerFreeNumber = await asManager('POST', '/api/sms/send', { toPhone: '+15558675309', message: 'hi' })
check('M22: a manager may still text a number directly', managerFreeNumber.status !== 403,
  { status: managerFreeNumber.status, body: managerFreeNumber.json })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
