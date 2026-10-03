// crm-roof — the claim, the scope document, and who may touch either. (T41)
//
// SEVEN FINDINGS, one subject. The claim is where roofing money is argued, and every one of these is
// a way the record stopped meaning what it says:
//
//   H  "Staff can write nothing, but the UI offers everything … Canvassers can't log a canvassing
//       session at all."  ← the last clause is a REFUSAL that is wrong, and it is tested as such
//   M  "No on-screen way to change an approved supplement … re-approve and deny work only through
//       the API."
//   M  "Xactimate export carries the wrong supplements: it includes three never-submitted drafts
//       ($450) … It also emits 7 measurement lines at quantity 0 instead of warning that there's no
//       measurement."
//   L  "The API approves a supplement that was never submitted, and approves above the requested
//       amount."
//   L  "A denied supplement keeps its old approvedAmount (the total correctly excludes it)."
//   L  "Export PDF and CSV links under /media/insurance/ open without signing in (random IDs)."
//
// WHY THE FIGURES MATTER HERE. A claim total is the number a carrier is argued with; "the endpoint
// answered 200" proves nothing about it. So every assertion below is an amount, a status or a
// refusal, and the amounts are the ones the report quotes where it quotes any.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, job, supplement } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Summit Ridge Roofing', slug: 'summit-t41-claims', email: 'claims-t41@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['insurance', 'canvassing_tool'],
} as any).returning()
const [other] = await db.insert(company).values({
  name: 'Rival Roofing', slug: 'rival-t41-claims', email: 'rival-t41@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['insurance'],
} as any).returning()

const mk = async (cid: string, role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t41c@summit.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: cid, isActive: true,
} as any).returning())[0]
const owner = await mk(co.id, 'owner', 'owner')
const manager = await mk(co.id, 'manager', 'manager')
const canvasser = await mk(co.id, 'field', 'canvasser')
const rival = await mk(other.id, 'owner', 'rival')

const [homeowner] = await db.insert(contact).values({
  companyId: co.id, firstName: 'Dana', lastName: 'Okafor', email: 'dana-t41c@test.local',
} as any).returning()

// TWO insurance jobs: one with a measurement, one without. The second is what the zero-quantity
// scope was built from.
const [measuredJob] = await db.insert(job).values({
  companyId: co.id, contactId: homeowner.id, jobNumber: 'ROOF-C1', jobType: 'insurance',
  status: 'lead', propertyAddress: '144 Shingle Ln', city: 'Columbus', state: 'OH', zip: '43215',
  source: 'canvassing', totalSquares: '32.5',
} as any).returning()
const [unmeasuredJob] = await db.insert(job).values({
  companyId: co.id, contactId: homeowner.id, jobNumber: 'ROOF-C2', jobType: 'insurance',
  status: 'lead', propertyAddress: '12 Nothing Measured Rd', city: 'Columbus', state: 'OH', zip: '43215',
  source: 'referral',
} as any).returning()

const app = new Hono()
app.route('/api/insurance', (await import('./src/routes/insurance.ts')).default)
app.route('/api/canvassing', (await import('./src/routes/canvassing.ts')).default)
app.route('/media', (await import('./src/routes/media.ts')).default)
// roof has no exported errorHandler; this mirrors src/index.ts (see t39-insurance-claims.test.ts).
app.onError((err: any, c: any) => {
  if (err?.name === 'ZodError') {
    const first = (err.issues || [])[0] || {}
    const where = Array.isArray(first.path) && first.path.length ? first.path.join('.') + ': ' : ''
    return c.json({ error: where + (first.message || 'Validation error') }, 400)
  }
  const status = Number(err?.status || err?.statusCode || 0)
  if (status >= 400 && status < 500) return c.json({ error: err.message }, status)
  return c.json({ error: 'Internal server error', unexpected: String(err?.message || err) }, 500)
})
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asCanvasser = as(canvasser), asRival = as(rival)

const supRow = async (id: string) => {
  const r: any = await db.execute(sql`SELECT status, approved_amount, denial_reason, total_amount FROM supplement WHERE id = ${id}`)
  return ((r as any).rows || r)[0]
}
const claimRow = async (id: string) => {
  const r: any = await db.execute(sql`SELECT supplement_amount FROM insurance_claim WHERE id = ${id}`)
  return ((r as any).rows || r)[0]
}

// ══════════ a claim, and a supplement on it ═════════════════════════════════════════════════════
console.log('\n══════════ setting up a real claim ══════════')
let claimId = '', supId = ''
{
  const made = await asOwner('POST', '/api/insurance/claims', {
    jobId: measuredJob.id, claimNumber: 'CLM-T41', insuranceCompany: 'Buckeye Mutual',
    causeOfLoss: 'hail', deductible: '1000.00',
  })
  check('the claim opens', made.status === 201, { status: made.status, body: made.text?.slice(0, 180) })
  claimId = made.json?.id

  // $1,100 asked for, which is the figure the report quotes against SUP-001.
  const sup = await asOwner('POST', `/api/insurance/claims/${claimId}/supplements`, {
    reason: 'Hidden decking rot found on tear-off',
    lineItems: [{ code: 'RFG 300', description: 'Sheathing - OSB 7/16', qty: 11, unit: 'SQ', unitPrice: 100 }],
  })
  check('a supplement is raised for $1,100', sup.status === 201 && Number(sup.json?.totalAmount) === 1100,
    { status: sup.status, total: sup.json?.totalAmount })
  supId = sup.json?.id
  check('…as a draft', (await supRow(supId))?.status === 'draft', await supRow(supId))
}

// ══════════ a draft is not a decision ═══════════════════════════════════════════════════════════
console.log('\n══════════ the API approved things nobody had sent ══════════')
{
  const early = await asOwner('POST', `/api/insurance/supplements/${supId}/approve`, { approvedAmount: '1100.00' })
  check('T41: approving a DRAFT is refused — it was never sent to the carrier', early.status === 400,
    { status: early.status, body: early.text?.slice(0, 200) })
  check('T41: …and the refusal says to submit it first',
    /draft/i.test(String(early.json?.error)) && /submit/i.test(String(early.json?.error)), early.json)
  check('T41: …the supplement is untouched', (await supRow(supId))?.status === 'draft', await supRow(supId))

  const earlyDeny = await asOwner('POST', `/api/insurance/supplements/${supId}/deny`, { denialReason: 'nope' })
  check('T41: denying a draft is refused too', earlyDeny.status === 400, { status: earlyDeny.status })

  const sent = await asOwner('POST', `/api/insurance/supplements/${supId}/submit`)
  check('submitting it works', sent.status === 200 && (await supRow(supId))?.status === 'submitted',
    { status: sent.status, row: await supRow(supId) })
  const twice = await asOwner('POST', `/api/insurance/supplements/${supId}/submit`)
  check('…and submitting the same one twice is refused', twice.status === 400, { status: twice.status })
}

// ══════════ not for more than was asked ═════════════════════════════════════════════════════════
console.log('\n══════════ approving above the ask ══════════')
{
  /**
   * ALLOWED, AND RECORDED AS SUCH. I implemented this as a refusal first and reverted it.
   *
   * The report pairs it with the never-submitted fault: "The API approves a supplement that was
   * never submitted, and approves above the requested amount." The first half is a clear fault and
   * is refused above. The second is not: an adjuster adds scope at the inspection and the letter
   * comes back higher, and the report's own evidence is a live claim where SUP-001 asked $200 and
   * was approved at $1,100. A refusal would force the office to rewrite line items to match a letter
   * they already hold — and this campaign keeps finding that a refused real need is the worse
   * failure. The document harm it causes is fixed where it happens, by the approved-basis scope's
   * reconciling ADJ line.
   *
   * What was wrong was the silence: the claim total moved and nothing said the carrier had allowed
   * more than was asked, so an over-approval and a mistyped one read identically. The activity line
   * now says which, with both figures.
   */
  const over = await asManager('POST', `/api/insurance/supplements/${supId}/approve`, { approvedAmount: '5000.00' })
  check('T41: approving $5,000 against an $1,100 ask is ACCEPTED — carriers do allow more',
    over.status === 200, { status: over.status, body: over.text?.slice(0, 220) })
  check('T41: …and recorded at the figure the carrier gave', Number((await supRow(supId))?.approved_amount) === 5000,
    await supRow(supId))
  {
    const trail = await asOwner('GET', `/api/insurance/claims/${claimId}/activity`)
    const line = (trail.json || []).find((a: any) => /approved/.test(String(a.body)))
    check('T41: …and the claim history says it was ABOVE the ask, with both figures',
      /ABOVE/.test(String(line?.body)) && /5,000/.test(String(line?.body)) && /1,100/.test(String(line?.body)),
      line?.body)
  }

  const partial = await asManager('POST', `/api/insurance/supplements/${supId}/approve`, { approvedAmount: '900.00' })
  check('approving LESS than the ask is fine — carriers do that', partial.status === 200,
    { status: partial.status, body: partial.text?.slice(0, 200) })
  check('…and the claim carries 900.00', Number((await claimRow(claimId))?.supplement_amount) === 900,
    await claimRow(claimId))
  const exact = await asManager('POST', `/api/insurance/supplements/${supId}/approve`, { approvedAmount: '1100.00' })
  check('T41: and an approved supplement can be CHANGED — the carrier came back', exact.status === 200
    && Number((await supRow(supId))?.approved_amount) === 1100, { status: exact.status, row: await supRow(supId) })
  check('…and the claim total follows it to 1,100', Number((await claimRow(claimId))?.supplement_amount) === 1100,
    await claimRow(claimId))
}

// ══════════ a denial takes the money back off ═══════════════════════════════════════════════════
console.log('\n══════════ reversing a decision ══════════')
{
  const denied = await asManager('POST', `/api/insurance/supplements/${supId}/deny`, { denialReason: 'Carrier says it is pre-existing' })
  check('T41: an APPROVED supplement can be denied afterwards', denied.status === 200, { status: denied.status })
  const row = await supRow(supId)
  check('T41: …and it no longer claims to be approved for anything', row?.approved_amount == null, row)
  check('T41: …while the reason is recorded', /pre-existing/.test(String(row?.denial_reason)), row)
  check('…and the claim total is back to 0', Number((await claimRow(claimId))?.supplement_amount) === 0,
    await claimRow(claimId))

  // …and back again, because that happens too.
  const again = await asManager('POST', `/api/insurance/supplements/${supId}/approve`, { approvedAmount: '1100.00' })
  check('T41: a denied supplement can be approved after all', again.status === 200, { status: again.status })
  const back = await supRow(supId)
  check('T41: …and the stale denial reason is cleared, not left beside the approval',
    back?.denial_reason == null && Number(back?.approved_amount) === 1100, back)
}

// ══════════ the scope document ══════════════════════════════════════════════════════════════════
console.log('\n══════════ what goes in the Xactimate scope ══════════')
{
  const { buildSupplementItems } = await import('./src/services/xactimate.ts')
  // The exact shape the report describes: three drafts worth $450 and one approved at 1,100 that
  // was only ASKED for 200.
  const sups = [
    { supplementNumber: 'SUP-002', status: 'draft', totalAmount: '150.00', approvedAmount: null, lineItems: [{ code: 'A', description: 'draft one', qty: 1, unit: 'EA', unitPrice: 150, total: 150 }] },
    { supplementNumber: 'SUP-003', status: 'draft', totalAmount: '150.00', approvedAmount: null, lineItems: [{ code: 'B', description: 'draft two', qty: 1, unit: 'EA', unitPrice: 150, total: 150 }] },
    { supplementNumber: 'SUP-004', status: 'draft', totalAmount: '150.00', approvedAmount: null, lineItems: [{ code: 'C', description: 'draft three', qty: 1, unit: 'EA', unitPrice: 150, total: 150 }] },
    { supplementNumber: 'SUP-001', status: 'approved', totalAmount: '200.00', approvedAmount: '1100.00', lineItems: [{ code: 'D', description: 'the real one', qty: 1, unit: 'EA', unitPrice: 200, total: 200 }] },
  ]

  const ask = buildSupplementItems(sups, 'ask')
  check('T41: the ASK carries no never-submitted draft', !ask.some((li: any) => /draft/.test(li.description)),
    ask.map((li: any) => li.description))
  // The report's own figure: three drafts worth $450 that had no business in the document.
  check('T41: …so the $450 of drafts is not in it', ask.reduce((s: number, li: any) => s + li.total, 0) === 200,
    ask.map((li: any) => [li.description, li.total]))
  check('…and the one that WAS sent is, at what was asked', ask.some((li: any) => li.description === 'the real one' && li.total === 200),
    ask)

  const approved = buildSupplementItems(sups, 'approved')
  check('T41: the APPROVED scope reaches the approved 1,100, not the requested 200',
    approved.reduce((s: number, li: any) => s + li.total, 0) === 1100,
    approved.map((li: any) => [li.code, li.total]))
  check('…through one reconciling line, rather than inventing per-line detail the carrier never sent',
    approved.filter((li: any) => li.code === 'ADJ').length === 1 && approved.find((li: any) => li.code === 'ADJ')?.total === 900,
    approved.filter((li: any) => li.code === 'ADJ'))
  check('T41: …and no drafts there either', !approved.some((li: any) => /draft/.test(li.description)),
    approved.map((li: any) => li.description))
}

// ══════════ a scope with no measurement ═════════════════════════════════════════════════════════
console.log('\n══════════ no measurement, no scope ══════════')
{
  const made = await asOwner('POST', '/api/insurance/claims', {
    jobId: unmeasuredJob.id, claimNumber: 'CLM-T41-NM', insuranceCompany: 'Buckeye Mutual',
  })
  check('a claim opens on the unmeasured job', made.status === 201, { status: made.status })
  const built = await asOwner('POST', `/api/insurance/claims/${made.json?.id}/xactimate-export`)
  check('T41: the export is REFUSED when there is no measurement', built.status === 400,
    { status: built.status, body: built.text?.slice(0, 220) })
  check('T41: …and says what to add', built.json?.code === 'no_measurement'
    && /squares/i.test(String(built.json?.error)), built.json)
}

// ══════════ the generated documents are not public ══════════════════════════════════════════════
console.log('\n══════════ /media/insurance ══════════')
{
  const key = `insurance/${co.id}/${claimId}/xactimate-scope.pdf`
  const anon = await app.request(`/media/${key}`)
  check('T41: /media/insurance/* is refused without signing in', anon.status === 401,
    { status: anon.status, body: (await anon.text()).slice(0, 160) })

  // Signed in, but another tenant: 404, because whether a document exists is its owner's business.
  const theirs = await asRival('GET', `/media/${key}`)
  check('T41: …and another company cannot read it even signed in', theirs.status === 404,
    { status: theirs.status, body: theirs.text?.slice(0, 160) })

  // The owner gets past both gates. There is no R2 in the sandbox, so the honest assertion is that
  // the request reaches the storage layer rather than being refused — 503 is the configured-storage
  // answer, and anything 401/404 would mean a gate wrongly caught the owner.
  const mine = await asOwner('GET', `/media/${key}`)
  check('the company\'s own user is not refused by either gate', mine.status !== 401 && mine.status !== 404,
    { status: mine.status, body: mine.text?.slice(0, 160) })

  // A job photo is still public — that is the whole reason this proxy is open, and the fix must not
  // have closed it. No storage in the sandbox, so 503 is what "got through the router" looks like.
  const photo = await app.request(`/media/jobs/${co.id}/some-photo.jpg`)
  check('a job photo is still served without a token — the portal needs that', photo.status !== 401,
    { status: photo.status })
}

// ══════════ the canvasser can do their job ══════════════════════════════════════════════════════
console.log('\n══════════ the refusal that was the bug ══════════')
{
  const session = await asCanvasser('POST', '/api/canvassing/sessions', {
    neighborhood: 'Clintonville after the hail', startedAt: new Date().toISOString(),
  })
  check('T41: A CANVASSER CAN START A CANVASSING SESSION — the refusal that was the bug',
    session.status === 201 || session.status === 200, { status: session.status, body: session.text?.slice(0, 220) })

  const sid = session.json?.id
  if (sid) {
    const stop = await asCanvasser('POST', `/api/canvassing/sessions/${sid}/stops`, {
      address: '144 Shingle Ln', outcome: 'interested', notes: 'Wants a quote Thursday',
    })
    check('T41: …and log a door knock on it', stop.status === 201 || stop.status === 200,
      { status: stop.status, body: stop.text?.slice(0, 200) })
    const ended = await asCanvasser('POST', `/api/canvassing/sessions/${sid}/end`, {})
    check('T41: …and close the session at the end of the street', ended.status === 200 || ended.status === 201,
      { status: ended.status, body: ended.text?.slice(0, 200) })
  }

  // …but not the shop's pitch.
  const script = await asCanvasser('POST', '/api/canvassing/scripts', { name: 'Mine', body: 'Hello' })
  check('T41: …while the SCRIPT library stays the shop\'s — the grant did not reach it',
    script.status === 403, { status: script.status, body: script.text?.slice(0, 180) })
  const mgrScript = await asManager('POST', '/api/canvassing/scripts', { name: 'House pitch', body: 'Hello' })
  check('…and a manager can still write one', mgrScript.status === 201 || mgrScript.status === 200,
    { status: mgrScript.status, body: mgrScript.text?.slice(0, 200) })

  // The crew still may not do the things that ARE the office's.
  const claimWrite = await asCanvasser('POST', `/api/insurance/claims/${claimId}/activity`, { activityType: 'note', body: 'hi' })
  check('…and still cannot write to the claim trail', claimWrite.status === 403, { status: claimWrite.status })
  const decide = await asCanvasser('POST', `/api/insurance/supplements/${supId}/approve`, { approvedAmount: '1.00' })
  check('…nor record a carrier\'s decision', decide.status === 403, { status: decide.status })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
