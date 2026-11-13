// The vendor / subcontractor portal: the vendor's half of purchase orders. Moved from
// templates/crm/backend/src/routes/vendorPortal.ts. It reuses the contact portal token but shows ONLY procurement
// addressed to that vendor: their POs (acknowledge / decline), their bills, invoice submission (landing as a vendor
// bill with source 'vendor_portal'), and documents shared with them. Every query is scoped to the token's contact, so
// a client who opens a vendor URL sees an empty portal, never someone else's.
//
// Mounted PUBLIC: the vendor's paths (/v/:token/...) are reached with the link, no session. The one owner path, the
// invite, signs the person in itself, as the template had it.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { z } from 'zod'
import { eq, and, desc, inArray, ne } from 'drizzle-orm'
import { contact, company, jobPurchaseOrder as purchaseOrder, jobPurchaseOrderLine as purchaseOrderLine, vendorBill, job, document } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { escapeHtml } from '../../core/sanitize.ts'
import { BID_PACKAGES, vendorBids } from '../projects/bidPackages.ts'

interface VendorRow {
  id: string
  name: string | null
  company: string | null
  email: string | null
  portalTokenExp: Date | null
  companyId: string
  coName: string | null
  coLogo: string | null
  coPrimaryColor: string | null
  coEmail: string | null
  coPhone: string | null
}
type VendorEnv = { Variables: AppEnv['Variables'] & { vendor: VendorRow } }

/**
 * The vendor's private link, minting (or renewing) the contact's portal token when it has none or it ran out — the one rule the invite
 * and a purchase order sent to the vendor share.
 */
export async function ensureVendorLink(db: any, vendor: { id: string; portalToken?: string | null; portalTokenExp?: Date | null; portalEnabled?: boolean | null }): Promise<{ link: string; token: string }> {
  let token = vendor.portalToken || ''
  const expired = vendor.portalTokenExp && new Date() > new Date(vendor.portalTokenExp)
  if (!vendor.portalEnabled || !token || expired) {
    token = crypto.randomBytes(32).toString('hex')
    await db.update(contact).set({
      portalEnabled: true,
      portalToken: token,
      portalTokenExp: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(contact.id, vendor.id))
  }
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '')
  return { link: `${base}/vendor/${token}`, token }
}

/**
 * A purchase order sent to its vendor: an email with the order's number and total and the vendor portal link, where they acknowledge it
 * and send their invoice (contractor live test 11/07: "No email goes to the vendor on send"). Only where the vendor portal is on and the
 * vendor has an email; answers whether it went.
 */
export async function emailPurchaseOrder(d: CrmDeps, companyId: string, po: { number: string; total: unknown; vendorId: string | null }): Promise<boolean> {
  if (!po.vendorId) return false
  if (!(await d.features.isFeatureEnabled(companyId, 'vendor_portal').catch(() => false))) return false
  const [vendor] = await d.db.select().from(contact).where(and(eq(contact.id, po.vendorId), eq(contact.companyId, companyId))).limit(1)
  if (!vendor?.email) return false
  const { link } = await ensureVendorLink(d.db, vendor)
  const [co] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  const name = escapeHtml(co?.name || 'Your customer')
  const total = Number(po.total || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  try {
    await d.services.emailService.sendRaw({
      to: vendor.email,
      subject: `Purchase order ${po.number} from ${co?.name || 'your customer'}`,
      html: `<p>${name} sent you purchase order <strong>${escapeHtml(po.number)}</strong> for ${escapeHtml(total)}.</p>
             <p><a href="${escapeHtml(link)}">Open it in your vendor portal</a> to acknowledge it and, when the work or delivery is done, send your invoice.</p>
             <p>The link is private to you.</p>`,
    })
    return true
  } catch (err: any) {
    d.logger.warn('[vendorPortal] purchase order email failed', { error: err?.message })
    return false
  }
}

/** The contact types a business buys from. */
const VENDOR_TYPES = ['vendor', 'subcontractor', 'supplier']

export function createVendorPortalRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<VendorEnv>()

  /**
   * IS THIS CONTACT A VENDOR OF THE BUSINESS (security review S2-8, 2026-11-13)? The vendor portal's key is the contact's
   * portal token — the customer portal's own — and both doors here took ANY contact: the invite handed a seat without
   * portal:share a customer's working portal link, and any customer's link could file a bill in the business's payables.
   * A vendor is a contact of a vendor type, or one the business has already sent a purchase order or filed a bill for.
   */
  async function isVendor(v: { id: string; companyId: string; type?: string | null }): Promise<boolean> {
    let type = v.type
    if (type === undefined) type = (await db.select({ type: contact.type }).from(contact).where(and(eq(contact.id, v.id), eq(contact.companyId, v.companyId))).limit(1))[0]?.type
    if (VENDOR_TYPES.includes(String(type || '').toLowerCase())) return true
    const [po] = await db.select({ id: purchaseOrder.id }).from(purchaseOrder).where(and(eq(purchaseOrder.companyId, v.companyId), eq(purchaseOrder.vendorId, v.id))).limit(1)
    if (po) return true
    const [bill] = await db.select({ id: vendorBill.id }).from(vendorBill).where(and(eq(vendorBill.companyId, v.companyId), eq(vendorBill.vendorId, v.id), ne(vendorBill.source, 'vendor_portal'))).limit(1)
    return !!bill
  }
  /** Bills one vendor link may file in an hour. */
  const filed = new Map<string, number[]>()
  const mayFile = (vendorId: string): boolean => {
    const now = Date.now(), recent = (filed.get(vendorId) || []).filter((at) => now - at < 3_600_000)
    if (recent.length >= 20) { filed.set(vendorId, recent); return false }
    recent.push(now); filed.set(vendorId, recent)
    return true
  }

  // ── Owner side: invite a vendor ──
  // Reuses the contact portal token (creating one if needed) but sends the VENDOR portal link.
  // The Vendor Portal is its own feature: the invite is refused while it is off, as the contacts screen no longer offers it
  // then (packages/tenant-ui ContactsPage — the link and the door follow the same switch).
  app.post('/contacts/:contactId/invite', d.authenticate, d.features.requireEnabledFeature('vendor_portal'), requirePermission('portal:share'), async (c) => {
    // portal:share, as the customer portal's own link routes ask (tenant-backend portal.ts): this returns the same key.
    const user = c.get('user') as any
    const contactId = c.req.param('contactId')
    const [vendor] = await db.select().from(contact)
      .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId))).limit(1)
    if (!vendor) return fail(c, 404, 'Contact not found')
    if (!(await isVendor(vendor))) return fail(c, 400, 'The vendor portal is for vendors, subcontractors and suppliers. Change this contact\'s type first, or send them a purchase order.', 'not_a_vendor')
    if (!vendor.email) return fail(c, 400, 'Contact must have an email to invite them to the portal')

    const { link } = await ensureVendorLink(db, vendor)
    const [co] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)
    // The template called emailService.sendEmail, which its email service does not have: the call threw inside this
    // try, was logged as a warning, and no invite email was ever sent. Sent through the app's email service; the
    // company's name is escaped into the HTML.
    try {
      const name = escapeHtml(co?.name || '')
      await d.services.emailService.sendRaw({
        to: vendor.email,
        subject: `${co?.name || 'Your customer'} invited you to their vendor portal`,
        html: `<p>${name || 'A customer'} uses this portal to send you purchase orders and receive your invoices.</p>
               <p><a href="${escapeHtml(link)}">Open your vendor portal</a></p>
               <p>The link is private to you and valid for 90 days.</p>`,
      })
    } catch (err: any) {
      d.logger.warn('[vendorPortal] invite email failed', { error: err?.message })
    }
    return one(c, { ok: true, link })
  })

  const bids = vendorBids(d)
  // ── Vendor side (the token is the sign-in) ──
  const vendorAuth = async (c: any, next: any) => {
    const token = c.req.param('token')
    const [row] = await db.select({
      id: contact.id,
      name: contact.name,
      company: contact.company,
      email: contact.email,
      portalTokenExp: contact.portalTokenExp,
      companyId: contact.companyId,
      coName: company.name,
      coLogo: company.logo,
      coPrimaryColor: company.primaryColor,
      coEmail: company.email,
      coPhone: company.phone,
    }).from(contact)
      .leftJoin(company, eq(contact.companyId, company.id))
      .where(and(eq(contact.portalToken, token), eq(contact.portalEnabled, true)))
      .limit(1)
    if (!row) return fail(c, 401, 'Invalid or expired portal link')
    if (row.portalTokenExp && new Date() > new Date(row.portalTokenExp)) {
      return fail(c, 401, 'This portal link has expired — ask for a new invite.')
    }
    // A customer's portal link is not a vendor's (isVendor): answered as a link that does not exist here.
    if (!(await isVendor({ id: row.id, companyId: row.companyId }))) return fail(c, 401, 'Invalid or expired portal link')
    c.set('vendor', row)
    await next()
  }

  app.get('/v/:token', vendorAuth, async (c) => {
    const vendor = c.get('vendor')
    const pos = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id), inArray(purchaseOrder.status, ['sent', 'acknowledged', 'declined', 'received', 'billed'])))
      .orderBy(desc(purchaseOrder.createdAt)).limit(100)
    const bills = await db.select().from(vendorBill)
      .where(and(eq(vendorBill.companyId, vendor.companyId), eq(vendorBill.vendorId, vendor.id)))
      .orderBy(desc(vendorBill.createdAt)).limit(100)
    // Bid requests (bid_packages, not ready): the packages this sub was asked to price, in the same answer, where the switch is on.
    const bidsOn = await d.features.isFeatureEnabled(vendor.companyId, BID_PACKAGES).catch(() => false)
    return one(c, {
      vendor: { name: vendor.name || vendor.company, companyName: vendor.company },
      company: { name: vendor.coName, logo: vendor.coLogo, primaryColor: vendor.coPrimaryColor, email: vendor.coEmail, phone: vendor.coPhone },
      purchaseOrders: pos,
      bills,
      ...(bidsOn ? { bidRequests: await bids.list(vendor) } : {}),
    })
  })

  // The sub prices a bid request, or declines it (../projects/bidPackages.ts vendorBids). Only where bid_packages is on.
  const bidsGate = async (c: any, next: any) => ((await d.features.isFeatureEnabled(c.get('vendor').companyId, BID_PACKAGES).catch(() => false)) ? next() : fail(c, 404, 'Not found'))
  app.post('/v/:token/bids/:inviteId', vendorAuth, bidsGate, async (c) => {
    const r = await bids.submit(c.get('vendor'), c.req.param('inviteId'), await c.req.json().catch(() => null))
    return r.ok ? one(c, r.bid) : fail(c, r.status as any, r.error)
  })
  app.post('/v/:token/bids/:inviteId/decline', vendorAuth, bidsGate, async (c) => {
    const r = await bids.decline(c.get('vendor'), c.req.param('inviteId'), ((await c.req.json().catch(() => ({}))) as any)?.reason)
    return r.ok ? one(c, { declined: true }) : fail(c, r.status as any, r.error)
  })

  app.get('/v/:token/pos/:id', vendorAuth, async (c) => {
    const vendor = c.get('vendor')
    const [po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
    if (!po) return fail(c, 404, 'Purchase order not found')
    const lines = await db.select().from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, po.id)).orderBy(purchaseOrderLine.sortOrder)
    let jobTitle: string | null = null
    if (po.jobId) {
      const [j] = await db.select({ title: job.title }).from(job).where(eq(job.id, po.jobId)).limit(1)
      jobTitle = j?.title || null
    }
    return one(c, { ...po, lines, jobTitle })
  })

  app.post('/v/:token/pos/:id/acknowledge', vendorAuth, async (c) => {
    const vendor = c.get('vendor')
    const [po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
    if (!po) return fail(c, 404, 'Purchase order not found')
    if (po.status !== 'sent') return fail(c, 400, `A ${po.status} purchase order cannot be acknowledged`)
    const [updated] = await db.update(purchaseOrder)
      .set({ status: 'acknowledged', vendorAcknowledgedAt: new Date(), updatedAt: new Date() })
      .where(eq(purchaseOrder.id, po.id)).returning()
    return one(c, updated)
  })

  app.post('/v/:token/pos/:id/decline', vendorAuth, async (c) => {
    const vendor = c.get('vendor')
    const body = z.object({ reason: z.string().min(1).max(500) }).safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return fail(c, 400, 'A reason is required to decline')
    const [po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
    if (!po) return fail(c, 404, 'Purchase order not found')
    if (!['sent', 'acknowledged'].includes(po.status)) return fail(c, 400, `A ${po.status} purchase order cannot be declined`)
    const [updated] = await db.update(purchaseOrder)
      .set({ status: 'declined', vendorDeclinedReason: body.data.reason, updatedAt: new Date() })
      .where(eq(purchaseOrder.id, po.id)).returning()
    return one(c, updated)
  })

  // The vendor submits their invoice: an OPEN bill for the owner to review, tied to the PO (and through it the job)
  // when one is named.
  app.post('/v/:token/invoices', vendorAuth, async (c) => {
    const vendor = c.get('vendor')
    const body = z.object({
      number: z.string().min(1).max(60),
      amount: z.number().positive().max(9_999_999.99),
      dueDate: z.string().max(40).optional(),
      purchaseOrderId: z.string().optional(),
      notes: z.string().max(1000).optional(),
    }).safeParse(((await c.req.json().catch(() => null)) ?? {}))
    if (!body.success) return fail(c, 400, body.error.issues[0]?.message || 'Invalid invoice')
    const data = body.data
    if (data.dueDate && Number.isNaN(new Date(data.dueDate).getTime())) return fail(c, 400, 'The due date is not a date')
    if (!mayFile(vendor.id)) return fail(c, 429, 'That is a lot of invoices in a short time. Please wait a while, or email them to us.', 'slow_down')
    let poJobId: string | null = null
    if (data.purchaseOrderId) {
      const [po] = await db.select().from(purchaseOrder)
        .where(and(eq(purchaseOrder.id, data.purchaseOrderId), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
      if (!po) return fail(c, 400, 'Purchase order not found')
      poJobId = po.jobId
    }

    const [bill] = await db.insert(vendorBill).values({
      companyId: vendor.companyId,
      vendorId: vendor.id,
      number: data.number,
      amount: data.amount.toFixed(2),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      purchaseOrderId: data.purchaseOrderId || null,
      jobId: poJobId,
      notes: data.notes || null,
      source: 'vendor_portal',
    }).returning()
    return one(c, bill, 201)
  })

  // Documents the company attached to this vendor (contracts, W-9s, specs). At most 100, newest first.
  app.get('/v/:token/documents', vendorAuth, async (c) => {
    const vendor = c.get('vendor')
    const docs = await db.select({
      id: document.id, name: document.name, originalName: document.originalName,
      mimeType: document.mimeType, size: document.size, url: document.url, createdAt: document.createdAt,
    }).from(document)
      .where(and(eq(document.companyId, vendor.companyId), eq(document.contactId, vendor.id)))
      .orderBy(desc(document.createdAt)).limit(100)
    return listAll(c, docs)
  })

  return app
}
