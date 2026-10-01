// T32 M11 — merging duplicate contacts.
//
// The report: "No way to merge duplicate contacts. Looked for merge on screen and API. None (merge
// routes 404). Duplicate detection itself is good: same email in different case and same phone in
// different format both 409 with the existing id. Expected a merge."
//
// So the system was good at telling you a duplicate exists and offered nothing for the ones that
// already did. This suite exists because a merge is the most dangerous safe-looking button in a CRM:
// it ends in `DELETE FROM contact`, and 33 columns in the base schema reference contact.id under
// four different names. Miss one and the merge still returns 200 — the row it should have moved is
// silently blanked by ON DELETE SET NULL, or destroyed by ON DELETE CASCADE. An invoice that quietly
// loses its customer is not noticed until somebody is chasing the money.
//
// THE CENTRAL ASSERTION is therefore not "the invoice moved". It is a census: count every row in the
// database that points at either contact BEFORE the merge, and prove the survivor holds all of them
// afterwards. That arithmetic fails if any referencing column was missed, whichever one it is, in
// whichever vertical — which is the only way to test a list that is read from pg_constraint rather
// than written down.
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
const { company, user, contact, project, quote, invoice, job, document, documentShare, jobPurchaseOrder, vendorBill, lead } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Merge Co', slug: 'merge-co', email: 'm@test.local', state: 'OH',
  settings: { timezone: 'UTC' },
  enabledFeatures: ['projects', 'quotes', 'invoices', 'jobs', 'documents'],
} as any).returning()
const [other] = await db.insert(company).values({
  name: 'Not Your Co', slug: 'not-yours', email: 'n@test.local', state: 'OH', settings: { timezone: 'UTC' },
} as any).returning()

const mkUser = async (role: string, tag: string, companyId = co.id) => (await db.insert(user).values({
  email: `${tag}@merge.local`, passwordHash: 'x', firstName: tag, lastName: 'Tester',
  role, companyId, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const field = await mkUser('field', 'field')
const outsider = await mkUser('owner', 'outsider', other.id)

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown, who = owner) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

/**
 * The census. Every single-column foreign key pointing at contact.id, straight from the catalogue —
 * the same source the product reads, deliberately: the question this answers is not "is the list
 * right" but "did every row on the list actually arrive", and for that the two have to agree on the
 * list or the arithmetic means nothing.
 */
/** The PGlite driver answers with `{ rows }`, node-postgres with a result object. Both, then. */
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows || []))

const fkColumns: { tbl: string; col: string }[] = rowsOf(await db.execute(sql`
  SELECT c.conrelid::regclass::text AS tbl, quote_ident(a.attname) AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.confrelid = 'contact'::regclass AND array_length(c.conkey, 1) = 1
   ORDER BY 1, 2
`)).map((r: any) => ({ tbl: r.tbl, col: r.col }))

const referenceCount = async (id: string) => {
  let total = 0
  const per: Record<string, number> = {}
  for (const { tbl, col } of fkColumns) {
    const r: any = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(tbl)} WHERE ${sql.raw(col)} = ${id}`)
    const n = Number(rowsOf(r)[0].n)
    if (n) per[`${tbl}.${col}`] = n
    total += n
  }
  return { total, per }
}

check(`the schema really does reference contact from many columns (${fkColumns.length})`, fkColumns.length >= 30, { found: fkColumns.length })

// ══════════ the pair ═══════════════════════════════════════════════════════════════════════════════
//
// Shaped like a real duplicate, not two identical rows: the office created one from a phone call
// (phone, address, no email) and the website created the other from a form (email, no phone). Each
// holds something the other is missing, which is the whole reason to merge rather than delete.
const [keeper] = await db.insert(contact).values({
  companyId: co.id, name: 'Harriet Vale', type: 'client',
  email: 'harriet@vale.example', city: 'Beloit', state: 'WI',
  tags: ['vip'], notes: 'Call before 9am.',
} as any).returning()
//
// Note the two fields they BOTH hold — email and city, with DIFFERENT values. Without a genuine
// conflict every "was not overwritten" assertion below is vacuous: mutation testing proved exactly
// that, by making the patch overwrite unconditionally and still passing 70/70, because the first
// version of this pair had nothing in common to argue over.
const [dup] = await db.insert(contact).values({
  companyId: co.id, name: 'H. Vale', type: 'lead',
  email: 'hvale1987@oldmail.example', city: 'Janesville',
  phone: '608-555-0101', mobile: '608-555-0199', address: '14 Mill Road', zip: '53511',
  tags: ['referral', 'vip'], notes: 'Found us through Dana.',
} as any).returning()

// Work on the duplicate, across four different FK columns.
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: dup.id, name: 'Mill Road Kitchen', number: 'PRJ-M1', status: 'active',
} as any).returning()
const [qt] = await db.insert(quote).values({
  companyId: co.id, contactId: dup.id, projectId: proj.id, number: 'QT-M1', name: 'Kitchen',
  status: 'approved', subtotal: '18000.00', total: '18000.00',
} as any).returning()
const [inv] = await db.insert(invoice).values({
  companyId: co.id, contactId: dup.id, projectId: proj.id, number: 'INV-M1', status: 'sent',
  subtotal: '9000.00', taxAmount: '495.00', taxRate: '5.50', total: '9495.00', amountPaid: '0',
} as any).returning()
const [jb] = await db.insert(job).values({
  companyId: co.id, contactId: dup.id, projectId: proj.id, number: 'JOB-M1', title: 'Demolition', status: 'scheduled',
} as any).returning()
// The columns that are NOT called contact_id. These are the whole reason the list is read from
// pg_constraint: anybody writing it out by hand reaches for `contact_id`, moves on, and leaves a
// subcontracted job, a vendor's purchase order, a vendor bill and a converted lead pointing at a row
// that is about to be deleted. Three of those four are ON DELETE SET NULL, so the merge would have
// returned 200 while quietly blanking the vendor on a bill.
const [po] = await db.insert(jobPurchaseOrder).values({
  companyId: co.id, vendorId: dup.id, projectId: proj.id, number: 'PO-00042', status: 'draft',
  subtotal: '1200.00', total: '1200.00',
} as any).returning()
const [bill] = await db.insert(vendorBill).values({
  companyId: co.id, vendorId: dup.id, projectId: proj.id, number: 'BILL-M1', status: 'open',
  amount: '1200.00', amountPaid: '0',
} as any).returning()
const [subJob] = await db.insert(job).values({
  companyId: co.id, contactId: keeper.id, subcontractorId: dup.id, projectId: proj.id,
  number: 'JOB-M2', title: 'Framing (sublet)', status: 'scheduled',
} as any).returning()
const [ld] = await db.insert(lead).values({
  companyId: co.id, sourcePlatform: 'website', homeownerName: 'H. Vale',
  convertedContactId: dup.id, status: 'converted',
} as any).returning()

// …and one record on the SURVIVOR, so the test can tell "moved" from "replaced".
const [ownInv] = await db.insert(invoice).values({
  companyId: co.id, contactId: keeper.id, number: 'INV-M0', status: 'paid',
  subtotal: '400.00', taxAmount: '22.00', taxRate: '5.50', total: '422.00', amountPaid: '422.00',
} as any).returning()

// The collision. document_share is UNIQUE on (document_id, contact_id), so a document shared with
// both contacts cannot simply be repointed — the duplicate's row would violate that index and take
// the whole merge down with it.
const mkDoc = async (name: string) => (await db.insert(document).values({
  companyId: co.id, name, filename: `${name}.pdf`, originalName: `${name}.pdf`,
  path: `/x/${name}.pdf`, url: `/files/${name}.pdf`, size: 10, mimeType: 'application/pdf',
} as any).returning())[0]
const sharedWithBoth = await mkDoc('Both Plans')
const sharedWithDupOnly = await mkDoc('Dup Only Permit')
await db.insert(documentShare).values([
  { documentId: sharedWithBoth.id, contactId: keeper.id },
  { documentId: sharedWithBoth.id, contactId: dup.id },
  { documentId: sharedWithDupOnly.id, contactId: dup.id },
] as any)

const before = { keeper: await referenceCount(keeper.id), dup: await referenceCount(dup.id) }
check('the duplicate starts with records attached', before.dup.total >= 5, before.dup.per)
check('the survivor starts with records of its own', before.keeper.total >= 2, before.keeper.per)

// ══════════ refusals, before anything is allowed to happen ════════════════════════════════════════
{
  const noBody = await api('POST', `/api/contacts/${keeper.id}/merge`, {})
  check('a merge with no duplicate named is refused, and says what is missing', noBody.status === 400 && /duplicateId/.test(noBody.text), { status: noBody.status, body: noBody.text?.slice(0, 160) })

  const itself = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: keeper.id })
  check('a contact cannot be merged into itself', itself.status === 400, { status: itself.status, body: itself.text?.slice(0, 160) })

  const ghost = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: 'does-not-exist' })
  check('an unknown duplicate is 404, and the message says which one is missing', ghost.status === 404 && /duplicate/i.test(ghost.text), { status: ghost.status, body: ghost.text?.slice(0, 160) })

  const ghostKeeper = await api('POST', `/api/contacts/nope/merge`, { duplicateId: dup.id })
  check('an unknown survivor is 404', ghostKeeper.status === 404, { status: ghostKeeper.status })

  // Cross-tenant: another company's owner must not be able to reach into this one, and this
  // company's owner must not be able to absorb a contact that is not theirs.
  const [theirs] = await db.insert(contact).values({ companyId: other.id, name: 'Their Client', type: 'client' } as any).returning()
  const reachIn = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: dup.id }, outsider)
  check('another company cannot merge contacts it cannot see', reachIn.status === 404, { status: reachIn.status })
  const reachOut = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: theirs.id })
  check("a contact from another company cannot be absorbed", reachOut.status === 404, { status: reachOut.status })
  const [stillTheirs] = await db.select().from(contact).where(eq(contact.id, theirs.id))
  check('…and it is still there afterwards', !!stillTheirs, { found: !!stillTheirs })

  // A merge deletes a contact, so it is gated on contacts:delete — not contacts:update.
  const byField = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: dup.id }, field)
  check('a field user, who has contacts:read only, is refused (403)', byField.status === 403, { status: byField.status, body: byField.text?.slice(0, 160) })
  const [dupStill] = await db.select().from(contact).where(eq(contact.id, dup.id))
  check('…and the refused merge changed nothing', !!dupStill, { found: !!dupStill })
}

// ══════════ the merge ══════════════════════════════════════════════════════════════════════════════
const merged = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: dup.id }, manager)
check('a manager, who holds contacts:*, can merge', merged.status === 200, { status: merged.status, body: merged.text?.slice(0, 300) })

const after = { keeper: await referenceCount(keeper.id), dup: await referenceCount(dup.id) }
const m = merged.json?.merge

// ── the census ────────────────────────────────────────────────────────────────────────────────────
//
// One duplicate share could not move (the survivor already had that document), so it was dropped.
// Everything else must have arrived.
check('EVERY record that pointed at the duplicate now points at the survivor',
  after.keeper.total === before.keeper.total + before.dup.total - 1,
  { keeperBefore: before.keeper.total, dupBefore: before.dup.total, keeperAfter: after.keeper.total, after: after.keeper.per })
check('nothing still points at the duplicate', after.dup.total === 0, after.dup.per)
check('the duplicate is gone', (await api('GET', `/api/contacts/${dup.id}`)).status === 404)
check('the survivor is still there', (await api('GET', `/api/contacts/${keeper.id}`)).status === 200)

// ── named, so a regression says which table ───────────────────────────────────────────────────────
for (const [label, table, column, id] of [
  ['the project', project, project.contactId, proj.id],
  ['the quote', quote, quote.contactId, qt.id],
  ['the invoice', invoice, invoice.contactId, inv.id],
  ['the job', job, job.contactId, jb.id],
] as const) {
  const [row] = await db.select().from(table as any).where(eq((table as any).id, id))
  check(`${label} moved to the survivor`, row?.contactId === keeper.id, { got: row?.contactId, want: keeper.id })
}
{
  const [row] = await db.select().from(invoice).where(eq(invoice.id, ownInv.id))
  check("the survivor's own invoice was left alone", row?.contactId === keeper.id, { got: row?.contactId })
}

// The columns a hand-written list forgets. Each of these would have come back null (or vanished) on
// a merge that only knew about `contact_id`, and the response would still have said 200.
{
  const [row] = await db.select().from(jobPurchaseOrder).where(eq(jobPurchaseOrder.id, po.id))
  check("the purchase order's VENDOR moved — a different column name entirely", row?.vendorId === keeper.id, { got: row?.vendorId, want: keeper.id })
  const [b] = await db.select().from(vendorBill).where(eq(vendorBill.id, bill.id))
  check("the vendor bill's vendor moved, so the money still has someone to pay", b?.vendorId === keeper.id, { got: b?.vendorId })
  const [j] = await db.select().from(job).where(eq(job.id, subJob.id))
  check('the SUBCONTRACTOR on a sublet job moved', j?.subcontractorId === keeper.id, { got: j?.subcontractorId })
  check('…and that job kept its own separate customer', j?.contactId === keeper.id, { got: j?.contactId })
  const [l] = await db.select().from(lead).where(eq(lead.id, ld.id))
  check("the converted lead still points at the contact it became", l?.convertedContactId === keeper.id, { got: l?.convertedContactId })
}

// ── the collision ─────────────────────────────────────────────────────────────────────────────────
{
  const shares = await db.select().from(documentShare).where(eq(documentShare.contactId, keeper.id))
  const docs = shares.map((s: any) => s.documentId).sort()
  check('the document only the duplicate could see is now shared with the survivor', docs.includes(sharedWithDupOnly.id), { docs })
  check('the document BOTH could see is shared exactly once, not twice', docs.filter((d: string) => d === sharedWithBoth.id).length === 1, { docs })
  check('the survivor has two shares, not three', shares.length === 2, { count: shares.length })
  check('the merge reports the row it had to discard rather than hiding it', m?.discardedRecords === 1, { discarded: m?.discardedRecords })
}

// ── the contact's own fields ───────────────────────────────────────────────────────────────────────
{
  const [row] = await db.select().from(contact).where(eq(contact.id, keeper.id))
  check("the duplicate's phone arrived (the survivor had none)", row?.phone === '608-555-0101', { got: row?.phone })
  check("…and its mobile", row?.mobile === '608-555-0199', { got: row?.mobile })
  check("…and its street address", row?.address === '14 Mill Road', { got: row?.address })
  check("…and its zip", row?.zip === '53511', { got: row?.zip })
  check("the survivor's email was NOT overwritten", row?.email === 'harriet@vale.example', { got: row?.email })
  check("the survivor's city was NOT overwritten", row?.city === 'Beloit', { got: row?.city })
  check("the survivor's name was NOT overwritten", row?.name === 'Harriet Vale', { got: row?.name })
  check("the survivor's type was NOT downgraded from client to lead", row?.type === 'client', { got: row?.type })

  const tags = (row?.tags || []).slice().sort()
  check('tags are a union, not a replacement, and vip is not duplicated', tags.join(',') === 'referral,vip', { tags })

  check("the survivor's own note is still there", /Call before 9am\./.test(row?.notes || ''), { notes: row?.notes })
  check("the duplicate's note was carried over, not dropped", /Found us through Dana\./.test(row?.notes || ''), { notes: row?.notes })
  check('the record says it was merged, and names what was absorbed', /Merged duplicate contact "H\. Vale"/.test(row?.notes || ''), { notes: row?.notes })
  check('…including the detail that identified the duplicate', /608-555-0101/.test(row?.notes || ''), { notes: row?.notes })
}

// ── what the response tells the caller ────────────────────────────────────────────────────────────
{
  check('the response carries the merged contact, so the page can render it', merged.json?.id === keeper.id, { id: merged.json?.id })
  check('…with no portal token on it', merged.json?.portalToken === undefined, { keys: Object.keys(merged.json || {}).filter((k) => /portal/i.test(k)) })
  check('the summary names both sides', m?.kept?.id === keeper.id && m?.absorbed?.id === dup.id, { kept: m?.kept, absorbed: m?.absorbed })
  check('the summary names the duplicate, so the toast can say what was absorbed', m?.absorbed?.name === 'H. Vale', { absorbed: m?.absorbed })
  check('the moved count matches the census', m?.movedRecords === before.dup.total - 1, { reported: m?.movedRecords, census: before.dup.total - 1 })
  const tables = (m?.moved || []).map((x: any) => x.table).sort()
  check('the summary lists which tables moved', ['document_share', 'invoice', 'job', 'job_purchase_order', 'lead', 'project', 'quote', 'vendor_bill'].every((t) => tables.includes(t)), { tables })
  check('…and lists ONLY tables that actually had rows', (m?.moved || []).every((x: any) => x.moved > 0 || x.discarded > 0), { moved: m?.moved })
  const filled = (m?.fieldsFilled || []).slice().sort()
  check('the summary says which fields were filled in', ['address', 'mobile', 'phone', 'tags', 'zip'].every((f) => filled.includes(f)), { filled })
  check('…and does not claim to have filled the email it left alone', !filled.includes('email'), { filled })
}

// ══════════ a refusal survives the merge ══════════════════════════════════════════════════════════
//
// FOUND BY READING THE COLUMN LIST, not by the report. emailOptOut is NOT NULL DEFAULT false, so it
// is never blank — which means "fill the survivor's blanks" would always keep the survivor's `false`
// and a merge would quietly re-subscribe somebody who had unsubscribed. They told the business to
// stop; which of two duplicate rows they were looking at when they said it is not their problem.
{
  const [subscribed] = await db.insert(contact).values({
    companyId: co.id, name: 'Quiet Pete', type: 'client', email: 'pete@quiet.example', emailOptOut: false,
  } as any).returning()
  const [unsubscribed] = await db.insert(contact).values({
    companyId: co.id, name: 'Pete Q', type: 'lead', emailOptOut: true, emailOptOutAt: new Date('2026-04-02T10:00:00Z'),
    portalToken: 'tok-pete-' + Date.now(), portalEnabled: true,
  } as any).returning()

  const res = await api('POST', `/api/contacts/${subscribed.id}/merge`, { duplicateId: unsubscribed.id })
  check('a contact who had opted out can be merged into one who had not', res.status === 200, { status: res.status, body: res.text?.slice(0, 200) })
  const [row] = await db.select().from(contact).where(eq(contact.id, subscribed.id))
  check('THE OPT-OUT SURVIVES — the merged contact is still unsubscribed', row?.emailOptOut === true, { emailOptOut: row?.emailOptOut })
  check('…and keeps the date they asked, so there is a record of when', !!row?.emailOptOutAt, { at: row?.emailOptOutAt })
  check('the summary names the opt-out as something it changed', (res.json?.merge?.fieldsFilled || []).includes('emailOptOut'), { filled: res.json?.merge?.fieldsFilled })

  // …and it does not work the other way round: merging a subscribed duplicate into an opted-out
  // survivor must not re-subscribe them either.
  const [stillOut] = await db.insert(contact).values({
    companyId: co.id, name: 'Dora Hush', type: 'client', emailOptOut: true,
  } as any).returning()
  const [happy] = await db.insert(contact).values({
    companyId: co.id, name: 'D Hush', type: 'lead', email: 'dora@hush.example', emailOptOut: false,
  } as any).returning()
  const res2 = await api('POST', `/api/contacts/${stillOut.id}/merge`, { duplicateId: happy.id })
  check('merging a subscribed duplicate in does not re-subscribe an opted-out survivor', res2.status === 200, { status: res2.status })
  const [row2] = await db.select().from(contact).where(eq(contact.id, stillOut.id))
  check('…the survivor is still unsubscribed', row2?.emailOptOut === true, { emailOptOut: row2?.emailOptOut })
  check("…and still took the duplicate's email address, which is not a consent", row2?.email === 'dora@hush.example', { email: row2?.email })

  // The portal link the duplicate held is gone with its row. Say so rather than let a client
  // discover it by clicking a dead bookmark.
  check("the merge warns that the duplicate's portal link will stop working", res.json?.merge?.portalLinkLost === true, { portalLinkLost: res.json?.merge?.portalLinkLost })
  check('…and does not warn when the duplicate never had one', res2.json?.merge?.portalLinkLost === false, { portalLinkLost: res2.json?.merge?.portalLinkLost })
  check('the survivor never leaks a portal token in the response', res.json?.portalToken === undefined, { keys: Object.keys(res.json || {}).filter((k) => /portal/i.test(k)) })
}

// ══════════ merging a third copy into the already-merged record ═══════════════════════════════════
//
// Duplicates arrive in threes. The second merge must behave like the first — in particular the notes
// must accumulate rather than the provenance line replacing the one before it.
{
  const [third] = await db.insert(contact).values({
    companyId: co.id, name: 'Harriet V', type: 'lead', source: 'Trade show', notes: 'Met at the expo.',
  } as any).returning()
  const again = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: third.id })
  check('a third duplicate merges into the already-merged contact', again.status === 200, { status: again.status, body: again.text?.slice(0, 200) })
  const [row] = await db.select().from(contact).where(eq(contact.id, keeper.id))
  check('the empty source field was filled from the third copy', row?.source === 'Trade show', { got: row?.source })
  check('both provenance lines are on the record', (row?.notes || '').match(/Merged duplicate contact/g)?.length === 2, { notes: row?.notes })
  check('…and the first note of all is still at the top', /^Call before 9am\./.test((row?.notes || '').trim()), { notes: row?.notes })
  check('a contact with nothing attached merges cleanly (0 records moved)', again.json?.merge?.movedRecords === 0, { moved: again.json?.merge?.movedRecords })
}

// ══════════ the duplicate guard now has an answer ═════════════════════════════════════════════════
//
// The 409 that the report praised is the entry point to this feature: it hands back `existingId`,
// which is exactly the id a merge needs. Proving the two fit together is the point — a merge nobody
// can get to from the place the duplicate is detected is not a fix for M11.
{
  const refused = await api('POST', '/api/contacts', { name: 'Harriet Vale Again', email: 'HARRIET@VALE.EXAMPLE' })
  check('a duplicate create is still refused with the id of the existing contact', refused.status === 409 && refused.json?.existingId === keeper.id,
    { status: refused.status, existingId: refused.json?.existingId })

  const forced = await api('POST', '/api/contacts', { name: 'Harriet Vale Again', email: 'harriet2@vale.example', phone: '(608) 555-0101', allowDuplicate: true })
  check('…and creating anyway still works, which is how a duplicate gets made in the first place', forced.status === 201, { status: forced.status })
  const fold = await api('POST', `/api/contacts/${keeper.id}/merge`, { duplicateId: forced.json?.id })
  check('the contact just created can be folded straight back in', fold.status === 200, { status: fold.status, body: fold.text?.slice(0, 200) })
  const [gone] = await db.select().from(contact).where(eq(contact.id, forced.json?.id))
  check('…and is gone', !gone, { found: !!gone })
}

// ══════════ the audit log actually records any of this ════════════════════════════════════════════
//
// FOUND WHILE WRITING THE ABOVE, not in the T32 report. The merge's two audit entries printed
//   Audit log error: null value in column "company_id" of relation "audit_log"
// to the console — and so did the plain contact create's. The audit service read `req.user.companyId`
// off what it was handed, every shared caller handed it `c.req`, and a Hono request has no `.user`
// (nor does a Hono context — the user is at `c.get('user')`). So companyId came out null, the
// NOT NULL insert threw, and a try/catch swallowed it.
//
// Nothing a contact route did was ever recorded on any tenant: not a create, not an edit, not a
// DELETE. "Who deleted this client?" had no answer at all. The same went for Stripe refunds,
// QuickBooks syncs and review sends, which are the other shared modules that log.
{
  const { auditLog } = await import('./db/schema.ts')
  const entries = await db.select().from(auditLog).where(eq(auditLog.companyId, co.id))
  check('the audit log is not empty — contact routes record what they did', entries.length > 0, { rows: entries.length })

  const forContacts = entries.filter((e: any) => e.entity === 'contact')
  check('every contact entry carries the company (the column that was null)', forContacts.length > 0 && forContacts.every((e: any) => e.companyId === co.id), { count: forContacts.length })
  check('…and the user who did it', forContacts.every((e: any) => !!e.userId), { missing: forContacts.filter((e: any) => !e.userId).length })
  check('…and their email, so the screen has a name to show', forContacts.every((e: any) => !!e.userEmail), { missing: forContacts.filter((e: any) => !e.userEmail).length })

  const deletes = forContacts.filter((e: any) => e.action === 'delete' || e.action === 'DELETE')
  check('the merge recorded the absorbed contact as deleted', deletes.some((e: any) => /merged into/i.test(e.entityName || '')), { names: deletes.map((e: any) => e.entityName) })
  check('…attributed to the manager who ran it, not to nobody', deletes.some((e: any) => e.userId === manager.id), { users: deletes.map((e: any) => e.userId) })
  check('a plain contact create is recorded too', forContacts.some((e: any) => (e.action || '').toLowerCase() === 'create'), { actions: [...new Set(forContacts.map((e: any) => e.action))] })

  // The other half of the fix: the callers that look their own user up and pass userId/companyId
  // directly (bulk, export, import, migration) must keep working. The dispensary's version of this
  // service dropped those parameters, and copying it verbatim would have silently broken 15 call
  // sites that do work today.
  const { log: auditWrite } = await import('./src/services/audit.ts')
  await auditWrite({ action: 'export', entity: 'contact', entityId: keeper.id, userId: owner.id, companyId: co.id } as any)
  const direct = (await db.select().from(auditLog).where(eq(auditLog.action, 'export')))[0]
  check('an explicit userId/companyId still records, with no request at all', direct?.companyId === co.id && direct?.userId === owner.id,
    { companyId: direct?.companyId, userId: direct?.userId })
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
