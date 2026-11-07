// Consumer financing's doors (service.ts does the work). Two mounts, both on consumer_financing (office/index.ts):
//   /api/financing          the office: the lender connection (Settings › Integrations), the estimate and the
//                           application on a quote or invoice, texting or emailing its link, the Financing page.
//   /api/financing-public   no sign-in: the customer's quote or invoice page (/d/<token>) — its estimate and Apply —
//                           and the lender's webhook, which proves itself by its signature.
// Who may: connecting the lender account is integrations:update (configuration, admin); reading applications is
// financing:read; opening one and sending its link is financing:create; the office's own status for a link-only
// application is financing:update — the financing:* set the permission matrix already carries (owner, admin; a
// manager reads and files, never settles).
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { isDocumentToken } from '@twomiah/tenant-backend'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { invoice, quote } from '../../db/schema/index.ts'
import { createFinancingService, type FinancingService } from './service.ts'

/** Financing beside each proposal option (roofing parity row 30; not ready). On top of consumer_financing. */
export const PROPOSAL_FINANCING = 'proposal_financing'
export const CHOOSE_BEFORE_FINANCING = 'Choose an option first. Financing is for the price of the option you choose.'
import { wisetack as lender } from './lender.ts'

/** A refusal from the service as a reply: its status, sentence, code and the boxes it names. */
async function answer(c: any, work: () => Promise<Response>) {
  try { return await work() } catch (e: any) {
    if (!e?.status || (e.status >= 500 && e.status !== 502)) throw e
    return fail(c, e.status, e.message, e.code, e.fields)
  }
}

export function createFinancingRoutes(d: CrmDeps, financing: FinancingService = createFinancingService(d)) {
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const who = (c: any) => c.get('user') as { userId: string; companyId: string }

  app.get('/status', async (c) => one(c, await financing.status(who(c).companyId)))

  app.put('/connection', requirePermission('integrations:update'), (c) => answer(c, async () => {
    const u = who(c)
    const conn = await financing.connect(u.companyId, await c.req.json().catch(() => ({})))
    d.audit.log({ req: c, action: 'FINANCING_CONNECTED', entity: 'company', entityId: u.companyId, metadata: { lender: 'wisetack', merchantId: conn.merchantId }, userId: u.userId, companyId: u.companyId })
    return one(c, await financing.status(u.companyId))
  }))

  app.delete('/connection', requirePermission('integrations:update'), async (c) => {
    const u = who(c)
    await financing.disconnect(u.companyId)
    d.audit.log({ req: c, action: 'FINANCING_DISCONNECTED', entity: 'company', entityId: u.companyId, userId: u.userId, companyId: u.companyId })
    return one(c, await financing.status(u.companyId))
  })

  const perOption = async (companyId: string) => (await d.features.isFeatureEnabled(companyId, PROPOSAL_FINANCING).catch(() => false)) && (await d.features.isFeatureEnabled(companyId, 'quote_proposals').catch(() => false))

  // Row 30: the estimate on each option of a quote's proposal (the options panel shows it beside each price).
  app.get('/quotes/:id/options', requirePermission('financing:read'), (c) => answer(c, async () => {
    const u = who(c)
    if (!(await perOption(u.companyId))) return fail(c, 404, 'Not found')
    const r = await financing.optionOffers(u.companyId, c.req.param('id'))
    return r ? one(c, r) : fail(c, 404, 'This quote has no options.')
  }))

  // The estimate and the applications on one quote or invoice (its page's Financing panel).
  app.get('/:kind{quotes|invoices}/:id', requirePermission('financing:read'), (c) => answer(c, async () => {
    const u = who(c)
    const kind = c.req.param('kind') === 'quotes' ? 'quote' : 'invoice'
    const id = c.req.param('id')
    let { offer, reason, connected } = await financing.offerOn(u.companyId, kind, id)
    // Row 30: a proposal still waiting for the customer's choice is not one price yet — no application on part of it.
    // (Only where the estimate is about the price: not for a lender not connected, a declined quote or one with no customer.)
    if (kind === 'quote' && connected && (offer !== null || !!reason?.includes(' lends on jobs of ')) && (await perOption(u.companyId)) && (await financing.optionOffers(u.companyId, id))?.needsChoice) { offer = null; reason = CHOOSE_BEFORE_FINANCING }
    const applications = await financing.list(u.companyId, kind === 'quote' ? { quoteId: id } : { invoiceId: id })
    return one(c, { offer, reason, connected, applications })
  }))

  app.post('/:kind{quotes|invoices}/:id/applications', requirePermission('financing:create'), (c) => answer(c, async () => {
    const u = who(c)
    const kind = c.req.param('kind') === 'quotes' ? 'quote' : 'invoice'
    if (kind === 'quote' && (await perOption(u.companyId)) && (await financing.optionOffers(u.companyId, c.req.param('id')))?.needsChoice) return fail(c, 409, CHOOSE_BEFORE_FINANCING, 'option_required')
    const { application, reused } = await financing.open(u.companyId, kind, c.req.param('id'), u.userId)
    if (!reused) d.audit.log({ req: c, action: 'FINANCING_APPLICATION_CREATED', entity: 'financing', entityId: application.id, metadata: { kind, id: c.req.param('id'), amount: application.amount }, userId: u.userId, companyId: u.companyId })
    return one(c, { ...application, reused }, reused ? 200 : 201)
  }))

  // The Financing page.
  app.get('/applications', requirePermission('financing:read'), async (c) => {
    const q = c.req.query()
    return listAll(c, await financing.list(who(c).companyId, { quoteId: q.quoteId, invoiceId: q.invoiceId, jobId: q.jobId, status: q.status }))
  })

  app.post('/applications/:id/send', requirePermission('financing:create'), (c) => answer(c, async () => {
    const u = who(c)
    const { channel } = await c.req.json().catch(() => ({} as any))
    const row = await financing.send(u.companyId, c.req.param('id'), channel, u.userId)
    d.audit.log({ req: c, action: 'FINANCING_LINK_SENT', entity: 'financing', entityId: row.id, metadata: { channel }, userId: u.userId, companyId: u.companyId })
    return one(c, row)
  }))

  app.post('/applications/:id/status', requirePermission('financing:update'), (c) => answer(c, async () => {
    const { status } = await c.req.json().catch(() => ({} as any))
    return one(c, await financing.setStatus(who(c).companyId, c.req.param('id'), status))
  }))

  app.post('/applications/:id/record-payment', requirePermission('financing:update'), (c) => answer(c, async () =>
    one(c, await financing.recordPayment(who(c).companyId, c.req.param('id')))))

  return app
}

/**
 * The customer's side. A quote's or invoice's own link names the document (packages/tenant-backend portal/
 * documentLinks.ts); an estimate is shown only for a business whose lender account is connected and a document in the
 * lender's range, else the answer is 404 — the page shows nothing about financing at all.
 */
export function createFinancingPublicRoutes(d: CrmDeps, financing: FinancingService = createFinancingService(d)) {
  const app = new Hono<AppEnv>()

  async function docOf(token: string) {
    if (!isDocumentToken(token)) return null
    const [q] = await d.db.select({ id: quote.id, companyId: quote.companyId }).from(quote).where(eq(quote.publicToken, token)).limit(1)
    if (q) return { kind: 'quote' as const, ...q }
    const [i] = await d.db.select({ id: invoice.id, companyId: invoice.companyId }).from(invoice).where(eq(invoice.publicToken, token)).limit(1)
    if (i) return { kind: 'invoice' as const, ...i }
    return null
  }
  const gone = (c: any) => fail(c, 404, 'Not found')
  const perOption = async (companyId: string) => (await d.features.isFeatureEnabled(companyId, PROPOSAL_FINANCING).catch(() => false)) && (await d.features.isFeatureEnabled(companyId, 'quote_proposals').catch(() => false))
  /** Row 30: a quote whose customer has not chosen yet (with per-option financing on) — Apply waits for the choice. */
  const waiting = async (doc: { kind: string; id: string; companyId: string }) =>
    doc.kind === 'quote' && (await perOption(doc.companyId)) && !!(await financing.optionOffers(doc.companyId, doc.id).catch(() => null))?.needsChoice

  // Row 30: the estimate on each option, shown on the option's card. 404 when there is nothing to show.
  app.get('/d/:token/options', async (c) => {
    const doc = await docOf(c.req.param('token'))
    if (!doc || doc.kind !== 'quote' || !(await d.features.isFeatureEnabled(doc.companyId, 'quotes')) || !(await perOption(doc.companyId))) return gone(c)
    const r = await financing.optionOffers(doc.companyId, doc.id).catch(() => null)
    if (!r || !Object.keys(r.options).length) return gone(c)
    return one(c, { lender: r.lender, disclosure: r.disclosure, needsChoice: r.needsChoice, options: r.options })
  })

  app.get('/d/:token', async (c) => {
    const doc = await docOf(c.req.param('token'))
    // The document's own door is closed when its feature is (portal.ts docAuth): so is this one.
    if (!doc || !(await d.features.isFeatureEnabled(doc.companyId, doc.kind === 'quote' ? 'quotes' : 'invoices'))) return gone(c)
    if (await waiting(doc)) return gone(c)
    const { offer } = await financing.offerOn(doc.companyId, doc.kind, doc.id).catch(() => ({ offer: null }))
    return offer ? one(c, offer) : gone(c)
  })

  app.post('/d/:token/apply', async (c) => {
    const doc = await docOf(c.req.param('token'))
    if (!doc || !(await d.features.isFeatureEnabled(doc.companyId, doc.kind === 'quote' ? 'quotes' : 'invoices'))) return gone(c)
    if (await waiting(doc)) return fail(c, 409, CHOOSE_BEFORE_FINANCING, 'option_required')
    return answer(c, async () => {
      const { application } = await financing.open(doc.companyId, doc.kind, doc.id, null)
      return one(c, { url: application.applicationUrl })
    })
  })

  // The lender's webhook: the raw body, so the signature is checked on the bytes that were signed.
  app.post(lender.webhookRoute, async (c) => {
    const raw = await c.req.text()
    const r = await financing.webhook(raw, c.req.header(lender.signatureHeader))
    return r.status >= 400 ? fail(c, r.status as any, String(r.body.error)) : one(c, r.body)
  })

  return app
}

