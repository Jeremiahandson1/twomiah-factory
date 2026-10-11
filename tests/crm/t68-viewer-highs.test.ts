// T68 — the viewer round's two highs, and the customer-facing leak found beside the first.
//
//   "Field service: the viewer can read cost. /api/quotes returns each line's unitCost (e.g. $45.00, $8.75)."
//   "Contractor: the viewer gets customers' signing evidence. The change order detail and quote detail endpoints
//    return the signature image, the signer's IP, their browser string and the signature hash; the change order
//    list includes the hash. The brief limits that to seats that can update change orders."
//
// Driven the way the business does it, through the REAL routes: the office raises and sends a quote and a change
// order, the CUSTOMER signs both in the portal, then every seat reads them back. Asserted on the payloads, field
// by field, because the screens never showed the leak — it was in the API only.
//
// Also pinned:
//   · the portal itself: a customer was sent each line's cost, the quote's internal notes and the project budget
//   · a seat granted quotes:update without margin:read saving a quote does NOT wipe the costs it cannot see
//   · the company-wide socket broadcast carries neither cost nor evidence
import { Hono } from 'hono'
import { eq, asc } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema = await import('./db/schema.ts')
const { company, user, contact, project, quote, quoteLineItem, changeOrder } = schema as any
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Linden Build', slug: 'linden-t68', email: 'linden-t68@test.local', settings: {},
  enabledFeatures: ['projects', 'change_orders', 'client_portal', 'contacts', 'invoices', 'quotes'],
} as any).returning()
const mkUser = async (role: string, tag: string, extra: string[] = []) => (await db.insert(user).values({
  email: `${tag}@linden.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
  extraPermissions: extra,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const viewer = await mkUser('viewer', 'viewer')
// Quotes handed to one person by name, without the cost — the only seat the carry-forward rule exists for.
const granted = await mkUser('field', 'granted', ['quotes:read', 'quotes:update'])

const TOKEN = 't68' + Math.random().toString(36).slice(2, 12)
const [homeowner] = await db.insert(contact).values({
  type: 'client', name: 'Ines Okoro', email: 'ines-t68@test.local', companyId: co.id,
  portalEnabled: true, portalToken: TOKEN, portalTokenExp: new Date(Date.now() + 30 * 86400000),
} as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: homeowner.id, name: 'Loft conversion', number: 'PRJ-0068', status: 'in_progress',
  budget: '48000', estimatedValue: '52000', notes: 'INTERNAL: client slow to pay last time',
} as any).returning()

const app = new Hono()
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
app.onError(errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asClient = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api/portal/p/${TOKEN}${path}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.68', 'user-agent': 'T68-Browser/1.0' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), M = as(manager), V = as(viewer), G = as(granted)
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', signedBy: 'Ines Okoro', consent: true }
const EVIDENCE = ['signature', 'signedIp', 'signedUserAgent', 'signatureHash', 'consentAt']
const has = (o: any, k: string) => o && o[k] !== undefined && o[k] !== null
const noneOf = (o: any, keys: string[]) => keys.filter((k) => has(o, k))
const costsOf = (lines: any[] = []) => lines.map((l) => l.unitCost)

// ── a quote with costs, sent, and signed by the customer ─────────────────────────────────────────
const made = await O('POST', '/api/quotes', {
  name: 'Loft — structure', contactId: homeowner.id, projectId: proj.id, notes: 'INTERNAL: margin is thin on the steel',
  lineItems: [
    { description: 'Steel beam', quantity: 1, unitPrice: 1200, type: 'material', unitCost: 845, pricebookItemId: 'pb-steel' },
    { description: 'Install labour', quantity: 8, unitPrice: 90, type: 'labor', unitCost: 45 },
  ],
})
check('the office raises a quote with line costs', made.status === 201 && costsOf(made.json?.lineItems).map(Number).join() === '845,45', made)
const qid = made.json?.id
check('…and sends it', (await O('PUT', `/api/quotes/${qid}`, { status: 'sent' })).status === 200)
const signed = await asClient('POST', `/quotes/${qid}/approve`, SIGN)
check('the customer signs it in the portal', signed.status === 200, signed)

// ── H1: cost ───────────────────────────────────────────────────────────────────────────────────────
{
  const vList = (await V('GET', '/api/quotes')).json?.data?.find((q: any) => q.id === qid)
  const vOne = (await V('GET', `/api/quotes/${qid}`)).json
  check('H1 viewer, list: no line carries a cost', !!vList && vList.lineItems.length === 2 && vList.lineItems.every((l: any) => !('unitCost' in l)), vList?.lineItems)
  check('H1 viewer, detail: no line carries a cost', vOne?.lineItems?.length === 2 && vOne.lineItems.every((l: any) => !('unitCost' in l)), vOne?.lineItems)
  check('H1 viewer: …while the price is still there', vOne?.lineItems?.map((l: any) => Number(l.unitPrice)).join() === '1200,90', vOne?.lineItems)
  const mOne = (await M('GET', `/api/quotes/${qid}`)).json
  const mList = (await M('GET', '/api/quotes')).json?.data?.find((q: any) => q.id === qid)
  check('H1 manager (margin:read): detail carries the costs', costsOf(mOne?.lineItems).map(Number).join() === '845,45', mOne?.lineItems)
  check('H1 manager: …and so does the list', costsOf(mList?.lineItems).map(Number).join() === '845,45', mList?.lineItems)
}

// ── H2: the quote's signing evidence ──────────────────────────────────────────────────────────────
{
  const vOne = (await V('GET', `/api/quotes/${qid}`)).json
  const vList = (await V('GET', '/api/quotes')).json?.data?.find((q: any) => q.id === qid)
  check('H2 viewer, quote detail: no image, IP, browser, hash or consent', noneOf(vOne, EVIDENCE).length === 0, noneOf(vOne, EVIDENCE))
  check('H2 viewer, quote detail: …but it says who signed and when', vOne?.signedBy === 'Ines Okoro' && has(vOne, 'signedAt'), { signedBy: vOne?.signedBy, signedAt: vOne?.signedAt })
  check('H2 viewer, quote list: no evidence either', noneOf(vList, EVIDENCE).length === 0, noneOf(vList, EVIDENCE))
  const mOne = (await M('GET', `/api/quotes/${qid}`)).json
  check('H2 manager (quotes:update), detail: the whole record', noneOf(mOne, EVIDENCE).length === EVIDENCE.length && mOne.signedIp === '203.0.113.68' && mOne.signedUserAgent === 'T68-Browser/1.0', noneOf(mOne, EVIDENCE))
  const mList = (await M('GET', '/api/quotes')).json?.data?.find((q: any) => q.id === qid)
  check('H2 manager, list: the tamper hash, never the image, IP or browser', has(mList, 'signatureHash') && !has(mList, 'signature') && !has(mList, 'signedIp') && !has(mList, 'signedUserAgent'), noneOf(mList, EVIDENCE))
}

// ── the customer's own portal: what the business pays, and its private notes, stay home ───────────
{
  const p = await asClient('GET', `/quotes/${qid}`)
  check('portal quote: it reads', p.status === 200 && p.json?.lineItems?.length === 2, { status: p.status })
  check('portal quote: no line carries the business\'s cost, type or catalogue id', p.json?.lineItems?.every((l: any) => !('unitCost' in l) && !('type' in l) && !('pricebookItemId' in l)), p.json?.lineItems)
  check('portal quote: …the lines the customer reads are all there', p.json?.lineItems?.every((l: any) => l.description && l.quantity !== undefined && l.unitPrice !== undefined && l.total !== undefined), p.json?.lineItems)
  check('portal quote: the internal notes are not sent', !('notes' in (p.json || {})), p.json?.notes)
  check('portal quote: …and the totals and their signature are', Number(p.json?.total) > 0 && p.json?.signedBy === 'Ines Okoro' && !!p.json?.signature, { total: p.json?.total, signedBy: p.json?.signedBy })
  const pp = await asClient('GET', `/projects/${proj.id}`)
  if (pp.status === 404 && /not enabled|feature/i.test(JSON.stringify(pp.json))) check('portal project: readable', false, pp)
  check('portal project: it reads', pp.status === 200 && pp.json?.name === 'Loft conversion', { status: pp.status, body: pp.json })
  check('portal project: no budget, estimated or actual value, or internal notes', !['budget', 'estimatedValue', 'actualValue', 'notes', 'companyId'].some((k) => k in (pp.json || {})), Object.keys(pp.json || {}))
}

// ── a seat that cannot see cost saves a quote: the costs it was not shown survive ─────────────────
{
  const d = await O('POST', '/api/quotes', {
    name: 'Loft — finishes', contactId: homeowner.id,
    lineItems: [
      { description: 'Plasterboard', quantity: 20, unitPrice: 14, type: 'material', unitCost: 8.75, pricebookItemId: 'pb-board' },
      { description: 'Skim coat', quantity: 1, unitPrice: 600, type: 'labor', unitCost: 310 },
    ],
  })
  const did = d.json?.id
  const seen = (await G('GET', `/api/quotes/${did}`)).json
  check('granted seat: reads the quote without its costs', seen?.lineItems?.length === 2 && seen.lineItems.every((l: any) => !('unitCost' in l)), seen?.lineItems)
  // The editor sends the lines back as it was given them, with one price changed.
  const lines = seen.lineItems.map((l: any) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: l.description === 'Skim coat' ? 650 : Number(l.unitPrice), type: l.type ?? undefined, pricebookItemId: l.pricebookItemId ?? undefined }))
  const saved = await G('PUT', `/api/quotes/${did}`, { lineItems: lines })
  check('granted seat: the save is accepted', saved.status === 200, saved)
  check('granted seat: …and the answer still withholds the cost', saved.json?.lineItems?.every((l: any) => !('unitCost' in l)), saved.json?.lineItems)
  const rows = await db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, did)).orderBy(asc(quoteLineItem.sortOrder))
  check('granted seat: the stored costs were NOT wiped by the save', rows.map((r: any) => Number(r.unitCost)).join() === '8.75,310', rows.map((r: any) => r.unitCost))
  check('granted seat: …while the price change took', Number(rows[1]?.unitPrice) === 650, rows.map((r: any) => r.unitPrice))
}

// ── H2: the change order ──────────────────────────────────────────────────────────────────────────
{
  const c1 = await O('POST', '/api/change-orders', { projectId: proj.id, title: 'Add a dormer window', reason: 'client_request', description: 'Second dormer on the rear slope.', lineItems: [{ description: 'Dormer', quantity: 1, unitPrice: 3400 }] })
  const cid = c1.json?.id
  check('a change order is raised and sent', c1.status === 201 && (await O('POST', `/api/change-orders/${cid}/submit`)).status === 200, c1)
  const cs = await asClient('POST', `/change-orders/${cid}/approve`, SIGN)
  check('the customer signs it in the portal', cs.status === 200, cs)

  const vOne = await V('GET', `/api/change-orders/${cid}`)
  check('H2 viewer, change order detail: it reads (change-orders:read)', vOne.status === 200, vOne)
  check('H2 viewer, change order detail: no image, IP, browser, hash or consent', noneOf(vOne.json, EVIDENCE).length === 0, noneOf(vOne.json, EVIDENCE))
  check('H2 viewer, change order detail: …but who signed and when', vOne.json?.signedBy === 'Ines Okoro' && has(vOne.json, 'signedAt'), { signedBy: vOne.json?.signedBy })
  const vList = (await V('GET', '/api/change-orders')).json?.data?.find((x: any) => x.id === cid)
  check('H2 viewer, change order list: no hash (the reported one) and no other evidence', noneOf(vList, EVIDENCE).length === 0, noneOf(vList, EVIDENCE))
  check('H2 viewer, change order list: …and still says it is signed', vList?.signed === true && vList?.signedBy === 'Ines Okoro', { signed: vList?.signed })
  const mOne = (await M('GET', `/api/change-orders/${cid}`)).json
  check('H2 manager (change-orders:update), detail: the whole record', noneOf(mOne, EVIDENCE).length === EVIDENCE.length && mOne.signedIp === '203.0.113.68', noneOf(mOne, EVIDENCE))
  const mList = (await M('GET', '/api/change-orders')).json?.data?.find((x: any) => x.id === cid)
  check('H2 manager, list: the hash, never the image, IP or browser (T41)', has(mList, 'signatureHash') && !has(mList, 'signature') && !has(mList, 'signedIp') && !has(mList, 'signedUserAgent'), noneOf(mList, EVIDENCE))
}

// ── what the company-wide broadcast carries ───────────────────────────────────────────────────────
{
  const { createQuoteRoutes } = await import('./src/shared/index.ts')
  const { authenticate } = await import('./src/middleware/auth.ts')
  const { requirePermission, hasPermission, getExtraPermissions } = await import('./src/middleware/permissions.ts')
  const sent: any[] = []
  const b = new Hono()
  b.route('/q', createQuoteRoutes({
    db, tables: { quote, quoteLineItem, contact, project, invoice: (schema as any).invoice, invoiceLineItem: (schema as any).invoiceLineItem, company, job: (schema as any).job },
    authenticate, requirePermission, emitToCompany: (_c: string, ev: string, data: any) => { sent.push({ ev, data }) }, EVENTS: { QUOTE_CREATED: 'created', QUOTE_UPDATED: 'updated' },
    loadPdf: async () => async () => Buffer.from(''),
    canSee: async (role: string, p: string, userId?: string) => hasPermission(role, p, await getExtraPermissions(userId)),
    options: { hasLineCost: true },
  } as any))
  const r = await b.request('/q', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': owner.id }, body: JSON.stringify({ name: 'Broadcast probe', contactId: homeowner.id, lineItems: [{ description: 'Probe', quantity: 1, unitPrice: 10, unitCost: 4 }] }) })
  const j: any = await r.json()
  check('broadcast: the owner\'s own answer still carries the cost', r.status === 201 && Number(j?.lineItems?.[0]?.unitCost) === 4, j)
  const ev = sent.find((s) => s.ev === 'created')
  check('broadcast: the created event reaches the company with no line cost', !!ev && ev.data.lineItems.every((l: any) => !('unitCost' in l)), ev?.data?.lineItems)
  await b.request(`/q/${j.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-user': owner.id }, body: JSON.stringify({ lineItems: [{ description: 'Probe', quantity: 2, unitPrice: 10, unitCost: 4 }] }) })
  const up = sent.find((s) => s.ev === 'updated')
  check('broadcast: …nor does the updated event', !!up && up.data.lineItems.every((l: any) => !('unitCost' in l)), up?.data?.lineItems)
  // Everything a working module needs EXCEPT canSee, so the only thing that can refuse is the canSee check.
  const full: any = {
    db, tables: { quote, quoteLineItem, contact, project, invoice: (schema as any).invoice, invoiceLineItem: (schema as any).invoiceLineItem, company, job: (schema as any).job },
    authenticate, requirePermission, emitToCompany: () => {}, EVENTS: {}, loadPdf: async () => async () => Buffer.from(''),
    canSee: async () => true, options: { hasLineCost: true },
  }
  let builtWith = false
  try { createQuoteRoutes(full); builtWith = true } catch {}
  check('a fully wired quote module starts', builtWith)
  const { canSee: _drop, ...noCanSee } = full
  let refusal = ''
  try { createQuoteRoutes(noCanSee) } catch (e: any) { refusal = String(e?.message || e) }
  check('…and the same module without canSee refuses to start, naming it', /canSee/.test(refusal), refusal)
}

console.log(`\nt68 viewer highs: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
