// The signing record and the activity feed, which went to the wrong seat. (T42 contractor)
//
//   "Project endpoint gives viewer the CO signature image, signer IP and user agent (field gets a
//    stripped version)."
//   "Project activity feed shows CO amounts to field."
//
// BOTH WERE MEASURED ON THE LIVE TENANT BEFORE ANYTHING WAS CHANGED, and the second one decided the
// shape of the fix: the activity rows carry no amount COLUMN at all. The money is inside the prose —
//
//   approved :: signed and approved change order CO-001 "T42 Portal CO" ($120.90)
//
// — and the metadata carries `documentHash` and `signedBy`. A deny-list over columns would have
// missed every word of that.
//
// WHY THE VIEWER WAS THE SEAT THAT LEAKED, and this is the point of the whole round: the existing
// strip was keyed on `invoices:read`, which is right for money and wrong for a signature. `viewer` is
// the read-only office seat and HOLDS invoices:read, so it fell past the strip to the raw row;
// `field` does not hold it and got the stripped version. The report says exactly that. So there are
// three tiers now, not two, and the signing evidence answers to `change-orders:update` — the same
// permission that approves or denies one.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, changeOrder, activity } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Ashford & Sons', slug: 'ashford-t43', email: 't43@test.local',
  settings: {}, enabledFeatures: ['projects', 'change_orders', 'contacts', 'invoices'],
} as any).returning()

const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@ashford-t43.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
const crew = await mk('field', 'crew')
const books = await mk('viewer', 'books')

const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Imogen Hartley', email: 'imogen-t43@test.local',
} as any).returning()

const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Garden room', number: 'PRJ-0043',
  status: 'in_progress', estimatedValue: '41200.00', budget: '38000.00',
} as any).returning()

// A SIGNED change order — the shape that leaked. Every signing column is filled, with values nothing
// else in the payload could produce.
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg-T43-SIGNATURE'
const SIGNER_IP = '203.0.113.77'
const AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) T43Probe/1.0'
const HASH = 'sha256-t43-document-hash-0ab1cd'
await db.insert(changeOrder).values({
  companyId: co.id, projectId: proj.id, number: 'CO-0043', title: 'Rooflight upgrade',
  description: 'Swap the two fixed lights for openers', reason: 'client request',
  status: 'approved', amount: '1875.40', daysAdded: 3,
  signature: SIG, signedBy: 'Imogen Hartley', signedIp: SIGNER_IP,
  signedUserAgent: AGENT, signatureHash: HASH, signedAt: new Date(), consentAt: new Date(),
} as any)

// …and an activity row shaped exactly like the live one, figure in the prose and all.
await db.insert(activity).values({
  companyId: co.id, userId: null, entityType: 'change_order', entityId: 'co-0043',
  action: 'approved',
  description: 'signed and approved change order CO-0043 "Rooflight upgrade" ($1,875.40)',
  metadata: { projectId: proj.id, actorName: 'Imogen Hartley', actorRole: 'client', signedBy: 'Imogen Hartley', documentHash: HASH, notes: 'agreed on site at $1,875.40' },
} as any)

const app = new Hono()
app.route('/api/projects', (await import('./src/routes/projects.ts')).default)
app.onError(errorHandler)

const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asCrew = as(crew), asBooks = as(books)
const coOf = (p: any) => (p?.changeOrders || [])[0] || {}

// ══════════ the project detail: three tiers, not two ════════════════════════════════════════════
console.log('\n══════════ the change order on the project detail ══════════')
{
  const crewView = await asCrew(`/api/projects/${proj.id}`)
  check('the crew seat opens the project', crewView.status === 200, { status: crewView.status, body: crewView.text?.slice(0, 160) })
  check('…and sees the change itself — which change, what it says, where it stands, days added',
    coOf(crewView.json).number === 'CO-0043' && coOf(crewView.json).status === 'approved' && coOf(crewView.json).daysAdded === 3,
    coOf(crewView.json))
  check('…with no amount', !('amount' in coOf(crewView.json)), coOf(crewView.json).amount)
  check('…and none of the signing record', !crewView.text.includes(SIG) && !crewView.text.includes(SIGNER_IP) && !crewView.text.includes(AGENT) && !crewView.text.includes(HASH),
    crewView.text.slice(0, 200))

  const booksView = await asBooks(`/api/projects/${proj.id}`)
  check('the read-only office seat opens it too', booksView.status === 200, { status: booksView.status })
  check('…and DOES see the amount — it holds invoices:read, and that is the point of the seat',
    Number(coOf(booksView.json).amount) === 1875.4, coOf(booksView.json).amount)
  check('T42: …but NOT the signature image', !booksView.text.includes(SIG), 'signature present')
  check('T42: …nor the address the customer signed from', !booksView.text.includes(SIGNER_IP), 'signer IP present')
  check('T42: …nor their browser string', !booksView.text.includes(AGENT), 'user agent present')
  check('T42: …nor the document hash', !booksView.text.includes(HASH), 'hash present')
  check('…and the project money it is entitled to is still there',
    booksView.json?.financials?.approvedChangeOrders === 1875.4, booksView.json?.financials)

  for (const [label, call] of [['the manager', asManager], ['the owner', asOwner]] as const) {
    const full = await call(`/api/projects/${proj.id}`)
    check(`${label} — who approves and denies these — still gets the whole signing record`,
      full.text.includes(SIG) && full.text.includes(SIGNER_IP) && full.text.includes(AGENT) && full.text.includes(HASH),
      { sig: full.text.includes(SIG), ip: full.text.includes(SIGNER_IP) })
  }
}

// ══════════ the activity feed: the figure is in the prose ═══════════════════════════════════════
console.log('\n══════════ the project activity feed ══════════')
{
  const crewFeed = await asCrew(`/api/projects/${proj.id}/activity`)
  const crewRow = (Array.isArray(crewFeed.json) ? crewFeed.json : [])[0] || {}
  check('the crew seat reads the timeline — who did what, and when', crewFeed.status === 200 && crewRow.action === 'approved',
    { status: crewFeed.status, row: crewRow })
  check('…and it still says what happened', /signed and approved change order CO-0043/.test(String(crewRow.description || '')), crewRow.description)
  check('T42: …with the FIGURE redacted out of the prose', !/1,875\.40/.test(String(crewRow.description || '')), crewRow.description)
  check('T42: …and out of the metadata note beside it', !/1,875\.40/.test(JSON.stringify(crewRow.metadata || {})), crewRow.metadata)
  check('T42: …and no signing evidence in the metadata',
    !('documentHash' in (crewRow.metadata || {})) && !('signedBy' in (crewRow.metadata || {})), crewRow.metadata)
  check('…while who did it and which project survive',
    crewRow.metadata?.actorName === 'Imogen Hartley' && crewRow.metadata?.projectId === proj.id, crewRow.metadata)
  check('…and the tenant id is not sent to anybody — no screen reads it', !('companyId' in crewRow), crewRow.companyId)
  check('T42: …no figure anywhere in the crew seat\'s feed', !crewFeed.text.includes('1,875.40'), crewFeed.text.slice(0, 240))

  const booksFeed = await asBooks(`/api/projects/${proj.id}/activity`)
  const booksRow = (Array.isArray(booksFeed.json) ? booksFeed.json : [])[0] || {}
  check('the office seat DOES see the figure in the timeline', /1,875\.40/.test(String(booksRow.description || '')), booksRow.description)
  check('T42: …and still not the signing evidence',
    !('documentHash' in (booksRow.metadata || {})) && !('signedBy' in (booksRow.metadata || {})), booksRow.metadata)

  const ownerFeed = await asOwner(`/api/projects/${proj.id}/activity`)
  const ownerRow = (Array.isArray(ownerFeed.json) ? ownerFeed.json : [])[0] || {}
  check('the owner gets the figure and the signing evidence both',
    /1,875\.40/.test(String(ownerRow.description || '')) && ownerRow.metadata?.documentHash === HASH && ownerRow.metadata?.signedBy === 'Imogen Hartley',
    ownerRow.metadata)
}

// ══════════ nothing was redacted at rest ════════════════════════════════════════════════════════
console.log('\n══════════ the record itself is untouched ══════════')
{
  const { sql } = await import('drizzle-orm')
  const r: any = await db.execute(sql`SELECT signature, signed_ip, amount FROM change_order WHERE number = 'CO-0043'`)
  const row = ((r as any).rows || r)[0]
  check('the signature, the address and the amount are all still on the change order',
    String(row?.signature) === SIG && String(row?.signed_ip) === SIGNER_IP && Number(row?.amount) === 1875.4, row)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
