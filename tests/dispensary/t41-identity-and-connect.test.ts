// crm-dispensary — T41. What a read-only seat is allowed to read.
//
// V1  The VIEWER could obtain the company's Stripe Connect onboarding link:
//     "GET /api/integrations/stripe/connect-url returns 200 with a live connect.stripe.com setup
//     link, while /integrations/status is 403 for the role." Every sibling on that router demands
//     manager or admin; this one had `authenticate` alone. Worse, the GET WRITES — with no account
//     on the company it calls stripe.accounts.create and saves the id — so the lowest seat in the
//     shop could provision the business's payment processing as a side effect of a read.
//
// V2  The API returned regulated identity the UI never shows:
//     "/api/contacts returns dateOfBirth (75 contacts) and medicalCardNumber/expiry (12) to the
//     viewer; /api/orders carries customerDob and medicalCardNumber too."
//     Both read with a bare select() and no column list, so every column went to anybody holding
//     *:read — every role, viewer and driver included.
//
// The line is `contacts:update`, not a rank: owner, admin, manager and BUDTENDER hold it and have a
// reason to (the budtender checks ID and serves medical patients); viewer and driver do not. So
// this pins BOTH directions — the viewer is refused and the budtender is not, because a redaction
// that breaks the counter is not a fix.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, order } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t41id', email: 'id@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'orders', 'products', 'integrations'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t41id@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('budtender', 'budtender')
const viewer = await mkUser('viewer', 'viewer')
const driver = await mkUser('driver', 'driver')

// A medical patient: both identity fields populated.
const [patient] = await db.insert(contact).values({
  companyId: co.id, name: 'Dana Medical', type: 'customer', email: 'dana-t41@test.local',
  dateOfBirth: '1986-04-11', medicalCardNumber: 'MMJ-77421', medicalCardExpiry: '2027-04-11',
} as any).returning()

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/integrations', (await import('./src/routes/integrations.ts')).default)
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/** Every identity key, in both spellings, anywhere in a JSON payload. */
const IDENTITY = ['dateOfBirth', 'date_of_birth', 'medicalCardNumber', 'medical_card_number', 'medicalCardExpiry', 'medical_card_expiry', 'customerDob', 'customer_dob']
const leakedKeys = (payload: unknown): string[] => {
  const found = new Set<string>()
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(walk); return }
    for (const [k, val] of Object.entries(v)) {
      if (IDENTITY.includes(k) && val !== null && val !== undefined) found.add(k)
      walk(val)
    }
  }
  walk(payload)
  return [...found].sort()
}

// ═════════════════ V1 · the Stripe Connect link is not a read-only read ═════════════════════════
console.log('\n── who can reach the Stripe onboarding link ──')
{
  const byViewer = await as(viewer)('GET', '/api/integrations/stripe/connect-url')
  // THE ASSERTION THIS EXISTS FOR. 403 is the gate; 503 would mean Stripe is simply unconfigured,
  // which would pass for the wrong reason and hide the hole — so it is named as a failure.
  check('V1: a viewer is REFUSED the Stripe connect URL', byViewer.status === 403,
    { status: byViewer.status, body: byViewer.text?.slice(0, 200) })
  check('V1: …and gets no connect link in the body', !/connect\.stripe\.com|connectUrl":"http/.test(byViewer.text || ''),
    byViewer.text?.slice(0, 200))

  const byBudtender = await as(budtender)('GET', '/api/integrations/stripe/connect-url')
  check('V1: a budtender is refused too — serving a customer is not setting up card payments',
    byBudtender.status === 403, { status: byBudtender.status })

  const byDriver = await as(driver)('GET', '/api/integrations/stripe/connect-url')
  check('V1: and a driver', byDriver.status === 403, { status: byDriver.status })

  // Manager is the rung its sibling /stripe/disconnect uses, so manager must get PAST the gate.
  // With no STRIPE_SECRET_KEY in the sandbox the handler answers 503 — which proves the gate let it
  // through, and is the thing to assert rather than a 200 we cannot produce here.
  const byManager = await as(manager)('GET', '/api/integrations/stripe/connect-url')
  check('V1: a manager passes the gate (503 "not set up", not 403)', byManager.status !== 403,
    { status: byManager.status, body: byManager.text?.slice(0, 160) })
}

// ═════════════════ V2 · DOB and medical card ════════════════════════════════════════════════════
console.log('\n── who can read a customer\'s identity ──')
{
  const listAsViewer = await as(viewer)('GET', '/api/contacts?limit=50')
  check('V2: the viewer can still read the customer list', listAsViewer.status === 200, { status: listAsViewer.status })
  check('V2: …and the list carries NO date of birth or medical card', leakedKeys(listAsViewer.json).length === 0,
    leakedKeys(listAsViewer.json))
  // Still a usable list — the redaction must not empty it.
  check('V2: …but it does still contain the customer', /Dana Medical/.test(listAsViewer.text || ''),
    (listAsViewer.json?.data || []).length)

  const detailAsViewer = await as(viewer)('GET', `/api/contacts/${patient.id}`)
  check('V2: the viewer can open the customer', detailAsViewer.status === 200, { status: detailAsViewer.status })
  check('V2: …and the DETAIL carries none of it either', leakedKeys(detailAsViewer.json).length === 0,
    leakedKeys(detailAsViewer.json))

  const driverList = await as(driver)('GET', '/api/contacts?limit=50')
  check('V2: a driver — who holds contacts:read and not contacts:update — gets none of it',
    driverList.status === 200 && leakedKeys(driverList.json).length === 0, leakedKeys(driverList.json))

  // …AND THE COUNTER STILL WORKS. A redaction that blinds the budtender is not a fix.
  const budList = await as(budtender)('GET', '/api/contacts?limit=50')
  const budKeys = leakedKeys(budList.json)
  check('V2: a BUDTENDER does get the date of birth — they check ID at the counter',
    budKeys.includes('dateOfBirth'), budKeys)
  check('V2: …and the medical card, because they serve medical patients',
    budKeys.includes('medicalCardNumber'), budKeys)

  const ownerDetail = await as(owner)('GET', `/api/contacts/${patient.id}`)
  check('V2: the owner sees it', leakedKeys(ownerDetail.json).includes('dateOfBirth'), leakedKeys(ownerDetail.json))
  const mgrDetail = await as(manager)('GET', `/api/contacts/${patient.id}`)
  check('V2: and the manager', leakedKeys(mgrDetail.json).includes('dateOfBirth'), leakedKeys(mgrDetail.json))
}

// ═════════════════ V2b · the order carries its own copy ═════════════════════════════════════════
console.log('\n── the same two facts, stored on the order ──')
{
  // Written straight to the table: this is the shape a settled till sale leaves behind.
  const [ord] = await db.insert(order).values({
    id: 't41-id-ord', orderNumber: 991741, companyId: co.id, contactId: patient.id,
    status: 'completed', subtotal: '40', taxAmount: '0', total: '40',
    customerDob: '1986-04-11', medicalCardNumber: 'MMJ-77421', isMedical: true,
  } as any).returning()
  void ord

  const listAsViewer = await as(viewer)('GET', '/api/orders?limit=50')
  check('V2b: the viewer can read the order list', listAsViewer.status === 200, { status: listAsViewer.status })
  check('V2b: …with no customerDob and no medical card on it', leakedKeys(listAsViewer.json).length === 0,
    leakedKeys(listAsViewer.json))
  check('V2b: …and the order is still there', /991741/.test(listAsViewer.text || ''), (listAsViewer.json?.data || []).length)

  const detailAsViewer = await as(viewer)('GET', '/api/orders/t41-id-ord')
  check('V2b: the viewer can open the order', detailAsViewer.status === 200, { status: detailAsViewer.status })
  // The detail carries the identity TWICE — on the order and on the nested customer. Both must go.
  check('V2b: …and NEITHER the order nor its nested customer carries the identity',
    leakedKeys(detailAsViewer.json).length === 0, leakedKeys(detailAsViewer.json))
  check('V2b: …while the nested customer is still returned', !!detailAsViewer.json?.customer?.name,
    detailAsViewer.json?.customer?.name)

  const budDetail = await as(budtender)('GET', '/api/orders/t41-id-ord')
  check('V2b: the budtender still sees it on the order they rang up',
    leakedKeys(budDetail.json).length > 0, leakedKeys(budDetail.json))
}

// ═════════════════ V3 · what people are paid ════════════════════════════════════════════════════
//
// "Viewer can read staff pay rates, shifts and time entries through the API (/api/team,
// /api/scheduling/*) while the Team and Scheduling pages are blocked."
//
// Manager and up, matching the Team nav entry (minRole 'manager') and the Rate column the page
// already renders — so BOTH directions are pinned: the viewer is refused, and the manager is not,
// because taking the Rate column off a working screen would be its own bug.
console.log('\n── who can read a pay rate ──')
{
  const { teamMember } = await import('./db/schema.ts')
  await db.insert(teamMember).values({
    companyId: co.id, name: 'Ada Budtender', email: 'ada-t41id@test.local',
    role: 'budtender', department: 'Floor', hourlyRate: '21.50', active: true,
  } as any)

  const rateKeys = (payload: unknown): string[] => {
    const found = new Set<string>()
    const walk = (v: any) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) { v.forEach(walk); return }
      for (const [k, val] of Object.entries(v)) {
        if ((k === 'hourlyRate' || k === 'hourly_rate') && val !== null && val !== undefined) found.add(k)
        walk(val)
      }
    }
    walk(payload)
    return [...found]
  }

  const asViewer = await as(viewer)('GET', '/api/team?limit=50')
  check('V3: the viewer can still read the roster', asViewer.status === 200, { status: asViewer.status })
  check('V3: …with NO pay rate on it', rateKeys(asViewer.json).length === 0, rateKeys(asViewer.json))
  check('V3: …and the roster is still usable', /Ada Budtender/.test(asViewer.text || ''),
    (asViewer.json?.data || []).length)

  const asBudtender = await as(budtender)('GET', '/api/team?limit=50')
  check('V3: a budtender does not see colleagues\' pay either', rateKeys(asBudtender.json).length === 0,
    rateKeys(asBudtender.json))

  // …and the manager's own screen still works.
  const asManager = await as(manager)('GET', '/api/team?limit=50')
  check('V3: the MANAGER still gets pay rates — the Team page renders a Rate column',
    rateKeys(asManager.json).includes('hourlyRate'), rateKeys(asManager.json))
  check('V3: and the owner', rateKeys((await as(owner)('GET', '/api/team?limit=50')).json).includes('hourlyRate'))

  // The detail route has historically been the one that misses a roster change, so check it too.
  const row = (asManager.json?.data || []).find((r: any) => r.name === 'Ada Budtender')
  if (row) {
    const detailViewer = await as(viewer)('GET', `/api/team/${row.id}`)
    check('V3: the DETAIL route hides it from the viewer as well', rateKeys(detailViewer.json).length === 0,
      rateKeys(detailViewer.json))
    const detailManager = await as(manager)('GET', `/api/team/${row.id}`)
    check('V3: …and still shows it to the manager', rateKeys(detailManager.json).includes('hourlyRate'),
      rateKeys(detailManager.json))
  } else {
    check('V3: the seeded roster row came back so the detail route could be checked', false, (asManager.json?.data || []).map((r: any) => r.name))
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
