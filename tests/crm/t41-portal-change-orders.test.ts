// A change order the office SENT could never be signed. (T41 contractor, HIGH)
//
//   "Change orders submitted from the CRM can't be signed by the client: CRM Submit sets status
//    'submitted', the portal lists and approves only 'pending' (400 'can no longer be approved'),
//    and the CO doesn't appear in the client's portal list. Only API-created 'pending' COs can be
//    signed."
//
// The whole feature, broken by one word. The office raises a change order, clicks Submit, tells the
// homeowner to go and sign — and the portal does not list it, and refuses it if they find the URL.
// The only change orders that ever worked were ones created straight through the API, which default
// to 'pending'.
//
// THE TEST DRIVES IT THE WAY THE OFFICE DOES: POST /api/change-orders to raise it, POST
// /:id/submit to send it, then the client portal. Not a row with status typed in — a hand-written
// 'submitted' row would have passed before the fix on the approve path and told me nothing about
// whether Submit is what produces it. The two routers are mounted side by side here precisely so the
// CRM's word and the portal's word have to be the same word.
//
// It also pins the three things a careless version of this fix loses:
//   · a DRAFT must stay invisible — including by id, which is how it leaked before T41
//   · an approved change order must still refuse a second signature
//   · the signature evidence (who, what they saw, that they consented) must still be recorded
import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, changeOrder } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Cedar Ridge Builders', slug: 'cedar-t41-co', email: 'cedar-t41@test.local',
  settings: {}, enabledFeatures: ['projects', 'change_orders', 'client_portal', 'contacts', 'invoices'],
} as any).returning()

const [owner] = await db.insert(user).values({
  email: 'owner-t41co@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

const TOKEN = 't41co' + Math.random().toString(36).slice(2, 12)
const [homeowner] = await db.insert(contact).values({
  type: 'client', name: 'Marek Toloza', email: 'marek-t41@test.local', companyId: co.id,
  portalEnabled: true, portalToken: TOKEN, portalTokenExp: new Date(Date.now() + 30 * 86400000),
} as any).returning()

const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: homeowner.id, name: 'Kitchen remodel', number: 'PRJ-0001', status: 'in_progress',
} as any).returning()

const app = new Hono()
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
// Mounted for the T42 case at the end: it checks the project SCREEN's own figures, which is where
// 'original + agreed changes' stopped adding up to 'revised' on the live tenant.
app.route('/api/projects', (await import('./src/routes/projects.ts')).default)
app.onError(errorHandler)

const asOffice = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
/** The homeowner's half: a token in an email, no login. */
const asClient = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api/portal/p/${TOKEN}${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'T41/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
// A drawn signature is a data: URI; the validator refuses anything else, and refuses a missing name
// or a missing consent tick. 1×1 transparent PNG.
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const SIGN = { signature: SIGNATURE, signedBy: 'Marek Toloza', consent: true }

const statusOf = async (id: string) => {
  const r: any = await db.execute(sql`SELECT status, signed_by, signed_ip, signature_hash, consent_at FROM change_order WHERE id = ${id}`)
  return ((r as any).rows || r)[0]
}

// ══════════ the office raises one and sends it ════════════════════════════════════════════════════
console.log('\n══════════ the office raises a change order and clicks Submit ══════════')
let coId = ''
{
  const made = await asOffice('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Move the range 600mm', reason: 'client_request',
    description: 'Relocate gas line and rework the run of units.',
    lineItems: [{ description: 'Gas line relocation', quantity: 1, unitPrice: 1450 }],
  })
  check('it is created', made.status === 201, { status: made.status, body: made.text?.slice(0, 200) })
  coId = made.json?.id
  check('…as a draft', (await statusOf(coId))?.status === 'draft', await statusOf(coId))

  // A draft is the office still writing it. Before T41 the portal's LIST hid drafts and the single
  // read did not, so this row was one URL away from the homeowner the whole time.
  const draftList = await asClient('GET', '/change-orders')
  check('a DRAFT is not in the client\'s list', Array.isArray(draftList.json) && draftList.json.length === 0,
    { status: draftList.status, n: (draftList.json || []).length })
  const draftById = await asClient('GET', `/change-orders/${coId}`)
  check('…and is not readable by id either', draftById.status === 404,
    { status: draftById.status, body: draftById.text?.slice(0, 160) })

  const sent = await asOffice('POST', `/api/change-orders/${coId}/submit`)
  check('Submit is accepted', sent.status === 200, { status: sent.status, body: sent.text?.slice(0, 200) })
  check('…and the row now reads `submitted` — the word the whole finding turns on',
    (await statusOf(coId))?.status === 'submitted', await statusOf(coId))
}

// ══════════ the homeowner opens the link in their email ══════════════════════════════════════════
console.log('\n══════════ the homeowner opens their portal ══════════')
{
  const list = await asClient('GET', '/change-orders')
  check('the change order the office SENT is in the list', Array.isArray(list.json) && list.json.length === 1,
    { status: list.status, body: list.text?.slice(0, 220) })
  check('…carrying its status, its money and the project it belongs to',
    list.json?.[0]?.status === 'submitted' && Number(list.json?.[0]?.amount) === 1450
    && list.json?.[0]?.projectNumber === 'PRJ-0001', list.json?.[0])

  const one = await asClient('GET', `/change-orders/${coId}`)
  check('…and opens', one.status === 200 && one.json?.number, { status: one.status, body: one.text?.slice(0, 160) })
}

// ══════════ and signs it ═════════════════════════════════════════════════════════════════════════
console.log('\n══════════ signing it ══════════')
{
  const noName = await asClient('POST', `/change-orders/${coId}/approve`, { signature: SIGNATURE, consent: true })
  check('a signature with no typed name is refused', noName.status === 400 && /full name/i.test(String(noName.json?.error)),
    { status: noName.status, body: noName.text?.slice(0, 160) })
  const noConsent = await asClient('POST', `/change-orders/${coId}/approve`, { signature: SIGNATURE, signedBy: 'Marek Toloza' })
  check('…and so is one with no electronic-signature consent', noConsent.status === 400 && /electronically/i.test(String(noConsent.json?.error)),
    { status: noConsent.status, body: noConsent.text?.slice(0, 160) })

  const signed = await asClient('POST', `/change-orders/${coId}/approve`, SIGN)
  check('THE SUBMITTED CHANGE ORDER IS SIGNED — the finding, closed', signed.status === 200,
    { status: signed.status, body: signed.text?.slice(0, 240) })
  const row = await statusOf(coId)
  check('…the row is approved', row?.status === 'approved', row)
  // Evidence, not just a status: ESIGN/UETA wants who signed, from where, and what document they saw.
  check('…and the evidence is kept: who signed, their IP, the document hash and the consent stamp',
    row?.signed_by === 'Marek Toloza' && row?.signed_ip === '203.0.113.9'
    && typeof row?.signature_hash === 'string' && row.signature_hash.length === 64 && !!row?.consent_at, row)

  const again = await asClient('POST', `/change-orders/${coId}/approve`, SIGN)
  check('signing it a second time is refused', again.status === 400 && /already approved/i.test(String(again.json?.error)),
    { status: again.status, body: again.text?.slice(0, 160) })
  const declineAfter = await asClient('POST', `/change-orders/${coId}/reject`, { reason: 'changed my mind' })
  check('…and so is declining one that is already signed', declineAfter.status === 400,
    { status: declineAfter.status, body: declineAfter.text?.slice(0, 160) })
}

// ══════════ declining works from `submitted` too ═════════════════════════════════════════════════
console.log('\n══════════ the other answer ══════════')
{
  const made = await asOffice('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Upgrade to quartz worktops', reason: 'client_request',
    lineItems: [{ description: 'Quartz, 3.4m²', quantity: 1, unitPrice: 2890 }],
  })
  const id = made.json?.id
  await asOffice('POST', `/api/change-orders/${id}/submit`)
  check('a second change order is submitted', (await statusOf(id))?.status === 'submitted', await statusOf(id))

  const declined = await asClient('POST', `/change-orders/${id}/reject`, { reason: 'over budget this month' })
  check('the homeowner can DECLINE a submitted change order', declined.status === 200,
    { status: declined.status, body: declined.text?.slice(0, 200) })
  check('…and it reads rejected', (await statusOf(id))?.status === 'rejected', await statusOf(id))
  // A rejected one is still visible — the homeowner should see what they turned down — but it is no
  // longer awaiting them, so it cannot be answered again.
  const list = await asClient('GET', '/change-orders')
  check('…still listed, so they can see what they turned down',
    (list.json || []).some((r: any) => r.id === id && r.status === 'rejected'),
    (list.json || []).map((r: any) => [r.number, r.status]))
  const flip = await asClient('POST', `/change-orders/${id}/approve`, SIGN)
  check('…but cannot then be approved', flip.status === 400, { status: flip.status, body: flip.text?.slice(0, 160) })
}

// ══════════ a change order created the OLD way still works ═══════════════════════════════════════
console.log('\n══════════ `pending`, the synonym, still answers ══════════')
{
  // routes/changeOrders.ts documents `pending` as what the selections flow used to stamp, accepted as
  // a synonym for `submitted`. Rows carrying it exist on live tenants, so it has to keep working.
  const [row] = await db.insert(changeOrder).values({
    companyId: co.id, projectId: proj.id, number: 'CO-OLD', title: 'Extra socket run',
    status: 'pending', amount: '240.00', daysAdded: 0,
  } as any).returning()
  const list = await asClient('GET', '/change-orders')
  check('a legacy `pending` row is listed', (list.json || []).some((r: any) => r.id === row.id),
    (list.json || []).map((r: any) => [r.number, r.status]))
  const signed = await asClient('POST', `/change-orders/${row.id}/approve`, SIGN)
  check('…and can still be signed', signed.status === 200 && (await statusOf(row.id))?.status === 'approved',
    { status: signed.status, row: await statusOf(row.id) })
}

// ══════════ someone else's change order is still nobody else's business ══════════════════════════
console.log('\n══════════ tenancy ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Rival Builders', slug: 'rival-t41-co', email: 'rival-t41@test.local',
    settings: {}, enabledFeatures: ['projects', 'change_orders', 'client_portal'],
  } as any).returning()
  const [otherContact] = await db.insert(contact).values({ type: 'client', name: 'Someone Else', email: 'else-t41@test.local', companyId: other.id } as any).returning()
  const [otherProj] = await db.insert(project).values({ companyId: other.id, contactId: otherContact.id, name: 'Loft', number: 'PRJ-X', status: 'in_progress' } as any).returning()
  const [otherCo] = await db.insert(changeOrder).values({
    companyId: other.id, projectId: otherProj.id, number: 'CO-RIVAL', title: 'Not yours',
    status: 'submitted', amount: '9999.00', daysAdded: 0,
  } as any).returning()

  const list = await asClient('GET', '/change-orders')
  check('another company\'s submitted change order is not in this client\'s list',
    !(list.json || []).some((r: any) => r.id === otherCo.id), (list.json || []).map((r: any) => r.number))
  const byId = await asClient('GET', `/change-orders/${otherCo.id}`)
  check('…nor readable by id', byId.status === 404, { status: byId.status })
  const sign = await asClient('POST', `/change-orders/${otherCo.id}/approve`, SIGN)
  check('…nor signable', sign.status === 404, { status: sign.status })
  check('…and it is untouched', (await statusOf(otherCo.id))?.status === 'submitted', await statusOf(otherCo.id))
}

// ══════════ T41 · a change order is not BORN approved ═════════════════════════════════════════
//
// `status` flows through the create handler (it was added so PUT {status} would stop silently
// no-opping), which made it a way to raise a change order that is already approved — skipping the
// submit, the client's signature and the revised contract value in one POST.
{
  const born = await asOffice('POST', '/api/change-orders', {
    title: 'T41 born approved', projectId: proj.id, status: 'approved',
    lineItems: [{ description: 'Scope', quantity: 1, unitPrice: 500 }],
  })
  check('T41: a change order cannot be created already approved', born.status === 400,
    { status: born.status, body: born.text?.slice(0, 200) })
  check('T41: …and the refusal says what a new one may start as', /draft/i.test(String(born.json?.error)) || Array.isArray(born.json?.allowed),
    born.json)
  const draft = await asOffice('POST', '/api/change-orders', {
    title: 'T41 raised properly', projectId: proj.id,
    lineItems: [{ description: 'Scope', quantity: 1, unitPrice: 500 }],
  })
  check('T41: a draft is of course accepted', draft.status === 201, { status: draft.status })
  const submitted = await asOffice('POST', '/api/change-orders', {
    title: 'T41 raised and submitted', projectId: proj.id, status: 'submitted',
    lineItems: [{ description: 'Scope', quantity: 1, unitPrice: 500 }],
  })
  check('T41: …and so is one raised straight to the client', submitted.status === 201, { status: submitted.status })
}

// ══════════ T41 · the LIST does not carry signature evidence ══════════════════════════════════
//
// The signature image, the signer's IP and their user-agent were on every row of the list, which
// every seat on the page can read. A list needs to show that a change order IS signed, by whom and
// when; the image and the device fingerprint belong to the detail read.
{
  const list = await asOffice('GET', '/api/change-orders?limit=100')
  const rows = list.json?.data || []
  const signed = rows.find((r: any) => r.signedBy)
  check('T41: the list has a signed change order to check', !!signed, rows.map((r: any) => r.number))
  check('T41: …and it says it is signed, by whom and when',
    signed?.signed === true && !!signed?.signedBy && !!signed?.signedAt,
    { signed: signed?.signed, by: signed?.signedBy, at: signed?.signedAt })
  check('T41: …but carries no signature image, IP or user-agent',
    !('signature' in (signed || {})) && !('signedIp' in (signed || {})) && !('signedUserAgent' in (signed || {})),
    Object.keys(signed || {}).filter((k) => /sign/i.test(k)))
  check('T41: …and no row does', !rows.some((r: any) => 'signature' in r || 'signedIp' in r || 'signedUserAgent' in r),
    rows.length)

  // The DETAIL still has everything — this is a list concern, not a redaction.
  const detail = await asOffice('GET', `/api/change-orders/${signed?.id}`)
  check('T41: the detail read still carries the signature itself', !!detail.json?.signature,
    { keys: Object.keys(detail.json || {}).filter((k) => /sign/i.test(k)) })
}

// ══════════ T42 · signing in the portal moves the CONTRACT, not just the status ══════════════════
//
//   "Portal-signed change orders never reach the contract value: PRJ-0005 shows Contract value
//    $10,030 instead of $10,200.90; only CRM-approved COs count."
//
// `project.estimatedValue` IS the contract figure — routes/projects.ts returns it as
// `revisedContractValue` and job costing reads it — and routes/changeOrders.ts moves it when the
// office approves. The portal path recorded the signature and the audit trail and left the project
// untouched, so an agreement reached through the customer's door never reached the money.
//
// Read off the live tenant before the fix: estimatedValue 10,030.00, three approved COs summing
// 200.90, of which the two portal-signed (120.90 + 50.00) had never been added — and 10,030.00 +
// 170.90 is exactly the 10,200.90 the report expected.
console.log('\n══════════ T42 · a signed change order reaches the contract value ══════════')
{
  const valueOf = async (id: string) => {
    const r: any = await db.execute(sql`SELECT estimated_value, end_date FROM project WHERE id = ${id}`)
    return ((r as any).rows || r)[0]
  }
  // Its own project, so the earlier cases' money cannot be mistaken for this one's.
  const [p2] = await db.insert(project).values({
    companyId: co.id, contactId: homeowner.id, name: 'Loft conversion', number: 'PRJ-0002',
    status: 'in_progress', estimatedValue: '10000.00', endDate: new Date('2026-06-01T00:00:00Z'),
  } as any).returning()

  const made = await asOffice('POST', '/api/change-orders', {
    projectId: p2.id, title: 'T42 Rooflight upgrade', reason: 'client_request',
    description: 'Swap to a triple-glazed rooflight.',
    daysAdded: 2,
    lineItems: [{ description: 'Rooflight, triple glazed', quantity: 1, unitPrice: 120.9 }],
  })
  check('T42: the office raises a 120.90 change order', made.status === 201 && Number(made.json?.amount) === 120.9,
    { status: made.status, amount: made.json?.amount, body: made.text?.slice(0, 200) })
  const id = made.json?.id
  await asOffice('POST', `/api/change-orders/${id}/submit`)

  const before = await valueOf(p2.id)
  check('T42: the contract starts at 10,000.00', Number(before?.estimated_value) === 10000, before)

  const signed = await asClient('POST', `/change-orders/${id}/approve`, SIGN)
  check('T42: the homeowner signs it', signed.status === 200, { status: signed.status, body: signed.text?.slice(0, 200) })
  check('T42: …the row is approved and the evidence kept', (await statusOf(id))?.status === 'approved' && !!(await statusOf(id))?.signature_hash,
    await statusOf(id))

  const after = await valueOf(p2.id)
  check('T42: THE CONTRACT VALUE MOVED — 10,000.00 + 120.90 = 10,120.90, which is the finding',
    Number(after?.estimated_value) === 10120.9, { before: before?.estimated_value, after: after?.estimated_value })
  check('T42: …and the two days it adds moved the end date too, which nothing had reported',
    new Date(after?.end_date).getTime() === new Date('2026-06-03T00:00:00Z').getTime(),
    { before: before?.end_date, after: after?.end_date })

  // The project screen's own figures have to agree with the stored value, or the block it renders
  // reads "original + agreed changes" ≠ "revised" — which is what the live tenant showed.
  const proj = await asOffice('GET', `/api/projects/${p2.id}`)
  check('T42: …the project screen reports the revised contract value',
    Number(proj.json?.financials?.revisedContractValue) === 10120.9, proj.json?.financials)
  check('T42: …and its own arithmetic adds up: original + agreed = revised',
    Math.round((Number(proj.json?.financials?.originalValue) + Number(proj.json?.financials?.approvedChangeOrders)) * 100) / 100 === 10120.9,
    proj.json?.financials)

  // Signing twice must not add it twice — the CRM path locks for exactly this reason and the portal
  // path did not lock at all.
  const twice = await asClient('POST', `/change-orders/${id}/approve`, SIGN)
  check('T42: signing again is refused', twice.status === 400, { status: twice.status, body: twice.text?.slice(0, 160) })
  check('T42: …and the contract value is unchanged, not double-counted',
    Number((await valueOf(p2.id))?.estimated_value) === 10120.9, await valueOf(p2.id))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
