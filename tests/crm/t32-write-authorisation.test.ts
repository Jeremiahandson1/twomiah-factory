// T32 M9 — "confirm that bids and AP payments being admin/owner-only is intentional".
//
// It is, and this file is the answer, because "intentional" asserted in a commit message is worth
// nothing next time somebody edits the matrix. Each row below is a WRITE, and the status every role
// gets on it. A change to BASE_ROLE_PERMISSIONS that moves one of these fails here with the role and
// the route named.
//
// The answer in full, read off packages/tenant-backend/src/auth/permissions.ts:
//
//   bids            owner/admin  bids:*         manager  bids:read ONLY      field —   viewer read
//   bills           owner/admin  bills:*        manager  read/create/update  field —   viewer —
//                                               …pay and delete withheld on purpose
//   purchase-orders owner/admin  full           manager  FULL                field —   viewer —
//   change-orders   owner/admin  full           manager  FULL                field —   viewer read
//
// So the asymmetry the tester noticed is real and narrow: a manager runs purchase orders and change
// orders outright, can enter and correct a vendor bill, and cannot PAY one or touch a bid. That is
// the same line payments:* already draws — committing spend is managing work, releasing money is
// not — and the matrix says so in a comment written at the time.
//
// The screens now match. Every action in BillsPage, BidsPage, PurchaseOrdersPage and
// ChangeOrdersPage is offered only to someone the route will let through, because the tester found
// this by opening "Record payment", typing an amount, and then being refused.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, vendorBill, jobPurchaseOrder, bid, changeOrder } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Gate Co', slug: 'gate-co', email: 'g@test.local', state: 'OH', settings: { timezone: 'UTC' },
  // All four modules ON, so a 403 can only be authorisation and never the feature switch.
  enabledFeatures: ['bids', 'purchase_orders', 'accounts_payable', 'change_orders', 'projects', 'jobs'],
} as any).returning()

const ROLES = ['owner', 'admin', 'manager', 'field', 'viewer'] as const
const users: Record<string, any> = {}
for (const role of ROLES) {
  users[role] = (await db.insert(user).values({
    email: `${role}@gate.local`, passwordHash: 'x', firstName: role, lastName: 'Gate',
    role, companyId: co.id, isActive: true,
  } as any).returning())[0]
}

const [vendor] = await db.insert(contact).values({ companyId: co.id, name: 'Ash Supply', type: 'vendor' } as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: vendor.id, name: 'Gate Project', number: 'PRJ-G1', status: 'active',
} as any).returning()

const app = new Hono()
app.route('/api/bills', (await import('./src/routes/bills.ts')).default)
app.route('/api/bids', (await import('./src/routes/bids.ts')).default)
app.route('/api/purchase-orders', (await import('./src/routes/purchaseOrders.ts')).default)
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (role: string, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': users[role].id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** Fresh rows per role, so one role's write cannot change what the next role is acting on. */
const mkBill = async () => (await db.insert(vendorBill).values({
  companyId: co.id, vendorId: vendor.id, projectId: proj.id, status: 'open', amount: '500.00', amountPaid: '0',
} as any).returning())[0]
const mkPo = async (n: string) => (await db.insert(jobPurchaseOrder).values({
  companyId: co.id, vendorId: vendor.id, projectId: proj.id, number: n, status: 'draft', subtotal: '100.00', total: '100.00',
} as any).returning())[0]
const mkBid = async (n: string) => (await db.insert(bid).values({
  companyId: co.id, number: n, projectName: 'Gate Bid', bidType: 'lump_sum', status: 'draft', bidAmount: '1000.00',
} as any).returning())[0]
const mkCo = async (n: string) => (await db.insert(changeOrder).values({
  companyId: co.id, projectId: proj.id, number: n, title: 'Gate CO', status: 'draft', amount: '250.00',
} as any).returning())[0]

type Expect = Partial<Record<typeof ROLES[number], number>>
/** `403` is the whole point; anything that is not 403 must be a success the matrix intends. */
const ALLOWED = (s: number) => s >= 200 && s < 300
const matrix = async (label: string, expect: Expect, run: (role: string) => Promise<{ status: number; text: string }>) => {
  for (const role of ROLES) {
    const want = expect[role]
    if (want === undefined) continue
    const got = await run(role)
    const ok = want === 403 ? got.status === 403 : ALLOWED(got.status)
    check(`${label} · ${role} ${want === 403 ? 'is refused' : 'is allowed'}`, ok, { got: got.status, want, body: got.text?.slice(0, 140) })
  }
}

const ADMIN_ONLY: Expect = { owner: 200, admin: 200, manager: 403, field: 403, viewer: 403 }
const MANAGER_TOO: Expect = { owner: 200, admin: 200, manager: 200, field: 403, viewer: 403 }

// ══════════ bids · writes are admin and owner only ════════════════════════════════════════════════
await matrix('POST /api/bids', ADMIN_ONLY, (role) =>
  api(role, 'POST', '/api/bids', { projectName: `Bid by ${role}`, bidType: 'lump_sum', bidAmount: 2500 }))

await matrix('PUT /api/bids/:id', ADMIN_ONLY, async (role) => {
  const b = await mkBid(`BID-PUT-${role}`)
  return api(role, 'PUT', `/api/bids/${b.id}`, { bidAmount: 3300 })
})

await matrix('POST /api/bids/:id/submit', ADMIN_ONLY, async (role) => {
  const b = await mkBid(`BID-SUB-${role}`)
  return api(role, 'POST', `/api/bids/${b.id}/submit`)
})

await matrix('DELETE /api/bids/:id', ADMIN_ONLY, async (role) => {
  const b = await mkBid(`BID-DEL-${role}`)
  return api(role, 'DELETE', `/api/bids/${b.id}`)
})

// …and a manager CAN read them, which is the half of the design that makes it reasonable: they see
// the pipeline, they do not move it.
{
  const r = await api('manager', 'GET', '/api/bids')
  check('GET /api/bids · manager can still read the pipeline', ALLOWED(r.status), { got: r.status })
  const v = await api('viewer', 'GET', '/api/bids')
  check('GET /api/bids · viewer can read it too (bids:read)', ALLOWED(v.status), { got: v.status })
  const f = await api('field', 'GET', '/api/bids')
  check('GET /api/bids · field has no bids permission at all', f.status === 403, { got: f.status })
}

// ══════════ bills · enter and correct, but do not pay ═════════════════════════════════════════════
await matrix('POST /api/bills', MANAGER_TOO, (role) =>
  api(role, 'POST', '/api/bills', { vendorId: vendor.id, amount: 400, number: `BILL-${role}` }))

await matrix('PUT /api/bills/:id', MANAGER_TOO, async (role) => {
  const b = await mkBill()
  return api(role, 'PUT', `/api/bills/${b.id}`, { amount: 450 })
})

// THE ONE THE TESTER ASKED ABOUT.
await matrix('POST /api/bills/:id/record-payment', ADMIN_ONLY, async (role) => {
  const b = await mkBill()
  return api(role, 'POST', `/api/bills/${b.id}/record-payment`, { amount: 100 })
})

await matrix('POST /api/bills/:id/void', ADMIN_ONLY, async (role) => {
  const b = await mkBill()
  return api(role, 'POST', `/api/bills/${b.id}/void`)
})

await matrix('DELETE /api/bills/:id', ADMIN_ONLY, async (role) => {
  const b = await mkBill()
  return api(role, 'DELETE', `/api/bills/${b.id}`)
})

// ══════════ purchase orders and change orders · a manager runs these outright ═════════════════════
//
// Included so the test states the whole shape rather than only the restrictive half. If somebody
// later "tidies" the matrix by making these admin-only to match bids, that is a decision, and it
// should have to be made here rather than happen by accident.
await matrix('POST /api/purchase-orders', MANAGER_TOO, (role) =>
  api(role, 'POST', '/api/purchase-orders', { vendorId: vendor.id, lines: [{ description: 'Timber', quantity: 2, unitCost: 50 }] }))

await matrix('POST /api/purchase-orders/:id/send', MANAGER_TOO, async (role) => {
  const p = await mkPo(`PO-SEND-${role}`)
  return api(role, 'POST', `/api/purchase-orders/${p.id}/send`)
})

await matrix('POST /api/change-orders', MANAGER_TOO, (role) =>
  api(role, 'POST', '/api/change-orders', { title: `CO by ${role}`, projectId: proj.id, lineItems: [{ description: 'Extra', quantity: 1, unitPrice: 300 }] }))

await matrix('POST /api/change-orders/:id/approve', MANAGER_TOO, async (role) => {
  const c = await mkCo(`CO-APP-${role}`)
  await api('owner', 'POST', `/api/change-orders/${c.id}/submit`)
  return api(role, 'POST', `/api/change-orders/${c.id}/approve`, {})
})

{
  const v = await api('viewer', 'GET', '/api/change-orders')
  check('GET /api/change-orders · viewer can read (change-orders:read)', ALLOWED(v.status), { got: v.status })
  const vb = await api('viewer', 'GET', '/api/bills')
  check('GET /api/bills · viewer has no bills permission, so AP is closed to them', vb.status === 403, { got: vb.status })
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
