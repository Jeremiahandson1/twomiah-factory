/**
 * Vendor / subcontractor portal — the vendor-facing half of purchase orders.
 * Reuses the contact portal-token machinery (portal.ts) but exposes ONLY
 * procurement addressed to that vendor: their POs (acknowledge / decline),
 * their bills, invoice submission (lands as a vendor_bill flagged
 * source='vendor_portal'), and documents shared with them.
 *
 * Every query is scoped vendorId = token's contact id, so a client who
 * somehow opens the vendor URL sees an empty portal, never someone else's.
 */
import { Hono } from 'hono'
import crypto from 'crypto'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, company, jobPurchaseOrder as purchaseOrder, jobPurchaseOrderLine as purchaseOrderLine, vendorBill, job, document } from '../../db/schema.ts'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'

const app = new Hono()

// ── Owner side: invite a vendor ─────────────────────────────────────────────
// Reuses the contact portal token (creating one if needed) but sends the
// VENDOR portal link — the client portal link would show them quotes UI.
app.post('/contacts/:contactId/invite', authenticate, requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')
  const [vendor] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId))).limit(1)
  if (!vendor) return c.json({ error: 'Contact not found' }, 404)
  if (!vendor.email) return c.json({ error: 'Contact must have an email to invite them to the portal' }, 400)

  let token = vendor.portalToken
  const expired = vendor.portalTokenExp && new Date() > new Date(vendor.portalTokenExp)
  if (!vendor.portalEnabled || !token || expired) {
    token = crypto.randomBytes(32).toString('hex')
    await db.update(contact).set({
      portalEnabled: true,
      portalToken: token,
      portalTokenExp: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    }).where(eq(contact.id, contactId))
  }

  const [co] = await db.select().from(company).where(eq(company.id, user.companyId)).limit(1)
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '')
  const link = `${base}/vendor/${token}`
  try {
    await emailService.sendEmail({
      to: vendor.email,
      subject: `${co?.name || 'Your customer'} invited you to their vendor portal`,
      html: `<p>${co?.name || 'A customer'} uses this portal to send you purchase orders and receive your invoices.</p>
             <p><a href="${link}">Open your vendor portal</a></p>
             <p>The link is private to you and valid for 90 days.</p>`,
    })
  } catch (err: any) {
    console.warn('[vendorPortal] invite email failed:', err?.message)
  }
  return c.json({ ok: true, link })
})

// ── Vendor side (token-authenticated) ───────────────────────────────────────
async function vendorAuth(c: any, next: any) {
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
  if (!row) return c.json({ error: 'Invalid or expired portal link' }, 401)
  if (row.portalTokenExp && new Date() > new Date(row.portalTokenExp)) {
    return c.json({ error: 'This portal link has expired — ask for a new invite.' }, 401)
  }
  c.set('vendor', row)
  await next()
}

app.get('/v/:token', vendorAuth, async (c) => {
  const vendor = c.get('vendor') as any
  const pos = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id), inArray(purchaseOrder.status, ['sent', 'acknowledged', 'declined', 'received', 'billed'])))
    .orderBy(desc(purchaseOrder.createdAt)).limit(100)
  const bills = await db.select().from(vendorBill)
    .where(and(eq(vendorBill.companyId, vendor.companyId), eq(vendorBill.vendorId, vendor.id)))
    .orderBy(desc(vendorBill.createdAt)).limit(100)
  return c.json({
    vendor: { name: vendor.name || vendor.company, companyName: vendor.company },
    company: { name: vendor.coName, logo: vendor.coLogo, primaryColor: vendor.coPrimaryColor, email: vendor.coEmail, phone: vendor.coPhone },
    purchaseOrders: pos,
    bills,
  })
})

app.get('/v/:token/pos/:id', vendorAuth, async (c) => {
  const vendor = c.get('vendor') as any
  const [po] = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
  if (!po) return c.json({ error: 'Purchase order not found' }, 404)
  const lines = await db.select().from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.purchaseOrderId, po.id)).orderBy(purchaseOrderLine.sortOrder)
  let jobTitle: string | null = null
  if (po.jobId) {
    const [j] = await db.select({ title: job.title }).from(job).where(eq(job.id, po.jobId)).limit(1)
    jobTitle = j?.title || null
  }
  return c.json({ ...po, lines, jobTitle })
})

app.post('/v/:token/pos/:id/acknowledge', vendorAuth, async (c) => {
  const vendor = c.get('vendor') as any
  const [po] = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
  if (!po) return c.json({ error: 'Purchase order not found' }, 404)
  if (po.status !== 'sent') return c.json({ error: `A ${po.status} purchase order cannot be acknowledged` }, 400)
  const [updated] = await db.update(purchaseOrder)
    .set({ status: 'acknowledged', vendorAcknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(purchaseOrder.id, po.id)).returning()
  return c.json(updated)
})

app.post('/v/:token/pos/:id/decline', vendorAuth, async (c) => {
  const vendor = c.get('vendor') as any
  const body = z.object({ reason: z.string().min(1).max(500) }).safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: 'A reason is required to decline' }, 400)
  const [po] = await db.select().from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, c.req.param('id')), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
  if (!po) return c.json({ error: 'Purchase order not found' }, 404)
  if (!['sent', 'acknowledged'].includes(po.status)) return c.json({ error: `A ${po.status} purchase order cannot be declined` }, 400)
  const [updated] = await db.update(purchaseOrder)
    .set({ status: 'declined', vendorDeclinedReason: body.data.reason, updatedAt: new Date() })
    .where(eq(purchaseOrder.id, po.id)).returning()
  return c.json(updated)
})

// Vendor submits their invoice — it lands as an OPEN bill for the owner to
// review, tied to the PO (and through it the job) when one is named.
app.post('/v/:token/invoices', vendorAuth, async (c) => {
  const vendor = c.get('vendor') as any
  const body = z.object({
    number: z.string().min(1).max(60),
    amount: z.number().positive(),
    dueDate: z.string().optional(),
    purchaseOrderId: z.string().optional(),
    notes: z.string().max(1000).optional(),
  }).safeParse(((await c.req.json().catch(() => null)) ?? {}))
  if (!body.success) return c.json({ error: body.error.issues[0]?.message || 'Invalid invoice' }, 400)
  const data = body.data

  let poJobId: string | null = null
  if (data.purchaseOrderId) {
    const [po] = await db.select().from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, data.purchaseOrderId), eq(purchaseOrder.companyId, vendor.companyId), eq(purchaseOrder.vendorId, vendor.id))).limit(1)
    if (!po) return c.json({ error: 'Purchase order not found' }, 400)
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
  return c.json(bill, 201)
})

// Documents the company attached to this vendor (contracts, W-9s, specs).
app.get('/v/:token/documents', vendorAuth, async (c) => {
  const vendor = c.get('vendor') as any
  const docs = await db.select({
    id: document.id, name: document.name, originalName: document.originalName,
    mimeType: document.mimeType, size: document.size, url: document.url, createdAt: document.createdAt,
  }).from(document)
    .where(and(eq(document.companyId, vendor.companyId), eq(document.contactId, vendor.id)))
    .orderBy(desc(document.createdAt)).limit(100)
  return c.json({ data: docs })
})

export default app
