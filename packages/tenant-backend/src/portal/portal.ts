// Customer portal — one implementation for every CRM.
//
// A contact gets a 64-hex token link (/portal/<token>); no password. Owner-side routes turn access on/off and
// email the link; every customer-side route lives under /p/:token and is scoped to that contact.
//
// Sections mount by the tables the template passes in: quotes + invoices + messages always; projects,
// change orders and selections when the project family is present; the collaborator set (my-jobs, lien
// waivers, submittals, RFIs, shared documents, project file room) when its tables/services are present; the
// service-customer set (equipment, service plans, service requests) when equipment/serviceAgreement are present.
// Which of those a customer actually sees is the frontend's portal config; an unlinked endpoint only ever
// answers with that contact's own (usually empty) rows.
import { Hono } from 'hono'
import crypto from 'crypto'
import path from 'path'
import { eq, and, inArray, count, sql, desc, asc, notInArray } from 'drizzle-orm'
import { nextNumber } from '../invoicing/money'

export interface PortalTables {
  contact: any; company: any; user: any
  quote: any; quoteLineItem: any; invoice: any; invoiceLineItem: any; payment: any
  message: any; auditLog: any
  activity?: any
  project?: any; job?: any; changeOrder?: any; changeOrderLineItem?: any
  lienWaiver?: any; rfi?: any; submittal?: any; document?: any; documentShare?: any
  equipment?: any; serviceAgreement?: any; agreementVisit?: any; formSubmission?: any
}
export interface PortalSelectionsService {
  getClientSelections: (projectId: string, contactId: string) => Promise<any>
  clientMakeSelection: (projectId: string, selectionId: string, contactId: string, data: { optionId: string; notes?: string }) => Promise<any>
}
export interface PortalFileService {
  saveFile: (file: File, companyId: string, folder: string) => Promise<{ path: string; mimetype?: string; originalname: string; size: number }>
  processImage: (p: string, opts: { width: number; height: number }) => Promise<string>
  generateThumbnail: (p: string, size: number) => Promise<string>
  getFileUrl: (p: string, companyId: string) => string
}
export interface PortalOptions {
  /** Base URL the emailed link points at. Default: process.env.FRONTEND_URL. */
  frontendUrl?: () => string
  /** Days a link stays valid. Default 90. */
  tokenDays?: number
  /** Job numbering for portal service requests — must match the jobs module. Default JOB / 5. */
  jobNumbering?: { prefix?: string; pad?: number }
  /** Status a portal service request is created in. Default 'pending' (unscheduled, waiting for the office). */
  serviceRequestStatus?: string
  /** Endpoint groups to leave unmounted even though their tables exist. */
  disable?: Array<'projects' | 'changeOrders' | 'selections' | 'myJobs' | 'collaborators' | 'sharedDocuments' | 'projectFiles' | 'service'>
}
export interface PortalDeps {
  db: any
  tables: PortalTables
  authenticate: any
  requirePermission: (permission: string) => any
  /** emailService.send — templates: portalInvite, collaboratorAction. */
  sendEmail: (to: string, template: string, data: Record<string, unknown>) => Promise<unknown>
  /** Lazy so pdfkit is only loaded when a PDF is actually requested. */
  loadInvoicePdf: () => Promise<(invoice: any, company: any) => Promise<Buffer>>
  loadQuotePdf: () => Promise<(quote: any, company: any) => Promise<Buffer>>
  selections?: PortalSelectionsService
  fileService?: PortalFileService
  emitToCompany?: (companyId: string, event: string, data: any) => void
  EVENTS?: Record<string, string>
  logger?: { warn: (msg: string, meta?: any) => void; error: (msg: string, meta?: any) => void }
  options?: PortalOptions
}

/** Quote statuses a customer may see — drafts are the office's business until they are sent. */
export const PORTAL_QUOTE_HIDDEN = ['draft']
/** Invoice statuses a customer may see — drafts and voided invoices stay out of the portal. */
export const PORTAL_INVOICE_HIDDEN = ['draft', 'void']
const QUOTE_RESPONDABLE = ['sent', 'viewed']
const MAX_SIGNATURE_BYTES = 500_000

export function createPortalRoutes(deps: PortalDeps) {
  const { db, tables: t, authenticate, requirePermission, sendEmail, loadInvoicePdf, loadQuotePdf, selections, fileService, emitToCompany, EVENTS } = deps
  const o = deps.options || {}
  const log = deps.logger || { warn: (m: string, x?: any) => console.warn(m, x ?? ''), error: (m: string, x?: any) => console.error(m, x ?? '') }
  const frontendUrl = () => (o.frontendUrl ? o.frontendUrl() : process.env.FRONTEND_URL || '')
  const TOKEN_MS = (o.tokenDays ?? 90) * 24 * 60 * 60 * 1000
  const off = (s: NonNullable<PortalOptions['disable']>[number]) => (o.disable || []).includes(s)
  const has = {
    projects: !!t.project && !off('projects'),
    changeOrders: !!t.project && !!t.changeOrder && !off('changeOrders'),
    selections: !!t.project && !!selections && !off('selections'),
    // a sub sees the jobs assigned to them (job.subcontractorId); a customer sees their own jobs (job.contactId)
    myJobs: !!t.job && !off('myJobs'),
    lienWaivers: !!t.lienWaiver && !off('collaborators'),
    submittals: !!t.submittal && !off('collaborators'),
    rfis: !!t.rfi && !off('collaborators'),
    sharedDocuments: !!t.document && !!t.documentShare && !off('sharedDocuments'),
    projectFiles: !!t.document && !!t.project && !!fileService && !off('projectFiles'),
    equipment: !!t.equipment && !!t.job && !off('service'),
    agreements: !!t.serviceAgreement && !off('service'),
    serviceRequest: !!t.job && !off('service'),
  }
  const app = new Hono()
  const portalUrlFor = (token: string) => `${frontendUrl()}/portal/${token}`

  // =============================================
  // Collaborator / customer action → activity row + email to the company's admins. Best-effort.
  // =============================================
  async function notifyCompany(params: { companyId: string; projectId?: string | null; entityType: string; entityId: string; action: string; actorName: string; actorRole: string; summary: string; details?: Record<string, unknown> }) {
    const { companyId, projectId, entityType, entityId, action, actorName, actorRole, summary, details } = params
    if (t.activity) {
      try {
        await db.insert(t.activity).values({ companyId, entityType, entityId, action, description: summary, metadata: { projectId: projectId || null, actorName, actorRole, ...(details || {}) } })
      } catch (err) { log.warn('[portal] activity insert failed', { error: (err as Error).message }) }
    }
    try {
      const admins = await db.select({ email: t.user.email, firstName: t.user.firstName, role: t.user.role }).from(t.user)
        .where(and(eq(t.user.companyId, companyId), eq(t.user.isActive, true), inArray(t.user.role, ['owner', 'admin', 'manager'])))
      if (admins.length === 0) return
      const [companyInfo] = await db.select({ name: t.company.name }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
      let projectName: string | null = null
      if (projectId && t.project) {
        const [p] = await db.select({ name: t.project.name, number: t.project.number }).from(t.project).where(eq(t.project.id, projectId)).limit(1)
        projectName = p ? `${p.number ? p.number + ' · ' : ''}${p.name}` : null
      }
      await Promise.all(admins.filter((a: any) => a.email).map((a: any) =>
        sendEmail(a.email, 'collaboratorAction', { companyName: companyInfo?.name || '', adminName: a.firstName || '', actorName, actorRole, summary, projectName }).catch((err: Error) => log.warn('[portal] notify admin failed', { error: err.message })),
      ))
    } catch (err) { log.warn('[portal] notify admins failed', { error: (err as Error).message }) }
  }

  // =============================================
  // OWNER ROUTES — manage a contact's portal access
  // =============================================
  const ownContact = async (contactId: string, companyId: string) => {
    const [row] = await db.select().from(t.contact).where(and(eq(t.contact.id, contactId), eq(t.contact.companyId, companyId))).limit(1)
    return row || null
  }
  const issueToken = async (contactId: string) => {
    const portalToken = crypto.randomBytes(32).toString('hex')
    const portalTokenExp = new Date(Date.now() + TOKEN_MS)
    await db.update(t.contact).set({ portalEnabled: true, portalToken, portalTokenExp, updatedAt: new Date() }).where(eq(t.contact.id, contactId))
    return { success: true, portalUrl: portalUrlFor(portalToken), expiresAt: portalTokenExp }
  }

  app.post('/contacts/:contactId/enable', authenticate, requirePermission('contacts:update'), async (c) => {
    const user = c.get('user') as any
    const found = await ownContact(c.req.param('contactId'), user.companyId)
    if (!found) return c.json({ error: 'Contact not found' }, 404)
    if (!found.email) return c.json({ error: 'Contact must have an email to enable portal access' }, 400)
    return c.json(await issueToken(found.id))
  })

  app.post('/contacts/:contactId/regenerate', authenticate, requirePermission('contacts:update'), async (c) => {
    const user = c.get('user') as any
    const found = await ownContact(c.req.param('contactId'), user.companyId)
    if (!found) return c.json({ error: 'Contact not found' }, 404)
    return c.json(await issueToken(found.id))
  })

  app.post('/contacts/:contactId/disable', authenticate, requirePermission('contacts:update'), async (c) => {
    const user = c.get('user') as any
    const found = await ownContact(c.req.param('contactId'), user.companyId)
    if (!found) return c.json({ error: 'Contact not found' }, 404)
    await db.update(t.contact).set({ portalEnabled: false, portalToken: null, portalTokenExp: null, updatedAt: new Date() }).where(eq(t.contact.id, found.id))
    return c.json({ success: true })
  })

  app.post('/contacts/:contactId/send-link', authenticate, requirePermission('contacts:update'), async (c) => {
    const user = c.get('user') as any
    const found = await ownContact(c.req.param('contactId'), user.companyId)
    if (!found) return c.json({ error: 'Contact not found' }, 404)
    if (!found.email) return c.json({ error: 'Contact has no email address' }, 400)
    if (!found.portalEnabled || !found.portalToken) return c.json({ error: 'Portal access not enabled for this contact' }, 400)
    const [companyInfo] = await db.select().from(t.company).where(eq(t.company.id, user.companyId)).limit(1)
    try {
      await sendEmail(found.email, 'portalInvite', { contactName: found.name, companyName: companyInfo?.name, portalUrl: portalUrlFor(found.portalToken), role: found.type || 'client' })
    } catch (err) {
      // The link is still valid — only the mail failed. Say so instead of a bare 500.
      return c.json({ error: `Could not send the portal invite: ${(err as Error).message}` }, 502)
    }
    return c.json({ success: true, sentTo: found.email })
  })

  app.get('/contacts/:contactId/status', authenticate, requirePermission('contacts:read'), async (c) => {
    const user = c.get('user') as any
    const found = await ownContact(c.req.param('contactId'), user.companyId)
    if (!found) return c.json({ error: 'Contact not found' }, 404)
    return c.json({
      enabled: !!found.portalEnabled,
      hasToken: !!found.portalToken,
      expiresAt: found.portalTokenExp,
      lastVisit: found.lastPortalVisit,
      portalUrl: found.portalToken ? portalUrlFor(found.portalToken) : null,
    })
  })

  // =============================================
  // CUSTOMER ROUTES — token auth
  // =============================================
  async function portalAuth(c: any, next: any) {
    const token = c.req.param('token')
    if (!token) return c.json({ error: 'Portal token required' }, 401)
    const [found] = await db.select({
      id: t.contact.id, type: t.contact.type, name: t.contact.name, email: t.contact.email, phone: t.contact.phone,
      address: t.contact.address, city: t.contact.city, state: t.contact.state, zip: t.contact.zip,
      companyId: t.contact.companyId, portalEnabled: t.contact.portalEnabled, portalTokenExp: t.contact.portalTokenExp,
      companyName: t.company.name, companyLogo: t.company.logo, companyPrimaryColor: t.company.primaryColor,
      companyEmail: t.company.email, companyPhone: t.company.phone, companyAddress: t.company.address,
      companyCity: t.company.city, companyState: t.company.state, companyZip: t.company.zip,
    }).from(t.contact).leftJoin(t.company, eq(t.contact.companyId, t.company.id))
      .where(and(eq(t.contact.portalToken, token), eq(t.contact.portalEnabled, true))).limit(1)
    if (!found) return c.json({ error: 'Invalid or expired portal link' }, 401)
    if (found.portalTokenExp && new Date() > new Date(found.portalTokenExp)) {
      return c.json({ error: 'Portal link has expired. Please contact the company for a new link.' }, 401)
    }
    await db.update(t.contact).set({ lastPortalVisit: new Date() }).where(eq(t.contact.id, found.id))
    c.set('portal', {
      contact: found,
      companyId: found.companyId,
      company: { id: found.companyId, name: found.companyName, logo: found.companyLogo, primaryColor: found.companyPrimaryColor, email: found.companyEmail, phone: found.companyPhone, address: found.companyAddress, city: found.companyCity, state: found.companyState, zip: found.companyZip },
    })
    await next()
  }
  const P = (c: any) => c.get('portal') as { contact: any; companyId: string; company: any }
  const contactProjectIds = async (contactId: string): Promise<string[]> => {
    if (!t.project) return []
    const rows = await db.select({ id: t.project.id }).from(t.project).where(eq(t.project.contactId, contactId))
    return rows.map((p: any) => p.id)
  }
  const fullCompany = async (companyId: string) => { const [row] = await db.select().from(t.company).where(eq(t.company.id, companyId)).limit(1); return row }

  // ---- home
  app.get('/p/:token', portalAuth, async (c) => {
    const { contact, company } = P(c)
    const [projectCount] = has.projects
      ? await db.select({ value: count() }).from(t.project).where(and(eq(t.project.contactId, contact.id), notInArray(t.project.status, ['completed', 'cancelled'])))
      : [{ value: 0 }]
    const [quoteCount] = await db.select({ value: count() }).from(t.quote).where(and(eq(t.quote.contactId, contact.id), inArray(t.quote.status, QUOTE_RESPONDABLE)))
    const [invoiceCount] = await db.select({ value: count() }).from(t.invoice).where(and(eq(t.invoice.contactId, contact.id), notInArray(t.invoice.status, PORTAL_INVOICE_HIDDEN)))
    const [balance] = await db.select({ total: sql<string>`COALESCE(SUM(${t.invoice.total} - ${t.invoice.amountPaid}), 0)` }).from(t.invoice)
      .where(and(eq(t.invoice.contactId, contact.id), inArray(t.invoice.status, ['sent', 'open', 'viewed', 'partial', 'overdue'])))
    return c.json({
      contact: { name: contact.name, email: contact.email, type: contact.type || 'client' },
      company: { name: company.name, logo: company.logo, primaryColor: company.primaryColor, email: company.email, phone: company.phone },
      summary: { activeProjects: Number(projectCount.value), pendingQuotes: Number(quoteCount.value), totalInvoices: Number(invoiceCount.value), outstandingBalance: Number(balance?.total || 0) },
      sections: has,
    })
  })

  // ---- projects
  if (has.projects) {
    app.get('/p/:token/projects', portalAuth, async (c) => {
      const { contact } = P(c)
      const rows = await db.select({ id: t.project.id, number: t.project.number, name: t.project.name, status: t.project.status, progress: t.project.progress, startDate: t.project.startDate, endDate: t.project.endDate, address: t.project.address, city: t.project.city, state: t.project.state })
        .from(t.project).where(eq(t.project.contactId, contact.id)).orderBy(desc(t.project.createdAt))
      return c.json(rows)
    })
    app.get('/p/:token/projects/:projectId', portalAuth, async (c) => {
      const { contact } = P(c)
      const projectId = c.req.param('projectId')
      const [found] = await db.select().from(t.project).where(and(eq(t.project.id, projectId), eq(t.project.contactId, contact.id))).limit(1)
      if (!found) return c.json({ error: 'Project not found' }, 404)
      const jobs = t.job
        ? await db.select({ id: t.job.id, number: t.job.number, title: t.job.title, status: t.job.status, scheduledDate: t.job.scheduledDate }).from(t.job).where(eq(t.job.projectId, projectId)).orderBy(desc(t.job.scheduledDate)).limit(10)
        : []
      return c.json({ ...found, jobs })
    })
  }

  // ---- quotes
  app.get('/p/:token/quotes', portalAuth, async (c) => {
    const { contact } = P(c)
    const rows = await db.select({ id: t.quote.id, number: t.quote.number, name: t.quote.name, status: t.quote.status, total: t.quote.total, expiryDate: t.quote.expiryDate, createdAt: t.quote.createdAt })
      .from(t.quote).where(and(eq(t.quote.contactId, contact.id), notInArray(t.quote.status, PORTAL_QUOTE_HIDDEN))).orderBy(desc(t.quote.createdAt))
    return c.json(rows)
  })
  const visibleQuote = async (quoteId: string, contactId: string) => {
    const [q] = await db.select().from(t.quote).where(and(eq(t.quote.id, quoteId), eq(t.quote.contactId, contactId), notInArray(t.quote.status, PORTAL_QUOTE_HIDDEN))).limit(1)
    return q || null
  }
  app.get('/p/:token/quotes/:quoteId', portalAuth, async (c) => {
    const { contact, company } = P(c)
    const quoteId = c.req.param('quoteId')
    const found = await visibleQuote(quoteId, contact.id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    const lineItems = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId)).orderBy(asc(t.quoteLineItem.sortOrder))
    let projectInfo = null
    if (found.projectId && t.project) {
      const [p] = await db.select({ name: t.project.name, number: t.project.number }).from(t.project).where(eq(t.project.id, found.projectId)).limit(1)
      projectInfo = p || null
    }
    if (found.status === 'sent') {
      await db.update(t.quote).set({ status: 'viewed', updatedAt: new Date() }).where(eq(t.quote.id, quoteId))
      found.status = 'viewed'
    }
    return c.json({ ...found, lineItems, project: projectInfo, company: { name: company.name, email: company.email, phone: company.phone } })
  })

  // E-signature evidence: WHO signed, WHAT they saw, and that they agreed to sign electronically (ESIGN/UETA).
  function validateSignatureInput(body: any): { ok: true; signerName: string } | { ok: false; error: string } {
    const signature = body?.signature
    const signerName = typeof body?.signedBy === 'string' ? body.signedBy.trim() : ''
    if (typeof signature !== 'string' || !signature.startsWith('data:image/')) return { ok: false, error: 'A signature is required.' }
    if (signature.length > MAX_SIGNATURE_BYTES) return { ok: false, error: 'Signature image is too large.' }
    if (!signerName) return { ok: false, error: 'Please type your full name to sign.' }
    if (body?.consent !== true) return { ok: false, error: 'You must agree to sign electronically before approving.' }
    return { ok: true, signerName }
  }
  const signerIp = (c: any): string | null => { const fwd = c.req.header('x-forwarded-for'); if (fwd) return fwd.split(',')[0].trim() || null; return c.req.header('x-real-ip') || null }
  const documentFingerprint = (payload: unknown) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  async function recordSignatureAudit(params: { companyId: string; entity: string; entityId: string; entityName: string; signerName: string; signerEmail?: string | null; ip: string | null; userAgent: string | null; documentHash: string; signedAt: Date; amount?: unknown }) {
    try {
      await db.insert(t.auditLog).values({
        companyId: params.companyId, action: `${params.entity}.signed`, entity: params.entity, entityId: params.entityId, entityName: params.entityName,
        ipAddress: params.ip, userAgent: params.userAgent, userName: params.signerName, userEmail: params.signerEmail || null,
        metadata: { signedAt: params.signedAt.toISOString(), documentHash: params.documentHash, amount: params.amount ?? null, consent: true, consentText: 'I agree that my electronic signature is the legal equivalent of my handwritten signature.', method: 'customer-portal-drawn-signature' },
      })
    } catch (err) { log.error('[esign] audit write failed', { error: (err as Error).message }) }
  }

  app.post('/p/:token/quotes/:quoteId/approve', portalAuth, async (c) => {
    const { contact } = P(c)
    const quoteId = c.req.param('quoteId')
    const body = await c.req.json().catch(() => ({}))
    const check = validateSignatureInput(body)
    if (!check.ok) return c.json({ error: check.error }, 400)
    const found = await visibleQuote(quoteId, contact.id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    if (found.status === 'approved') return c.json({ error: 'Quote already approved' }, 400)
    if (!QUOTE_RESPONDABLE.includes(found.status)) return c.json({ error: `This quote is ${found.status} and can no longer be approved` }, 400)
    const lineItems = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId))
    const signedAt = new Date(), ip = signerIp(c), userAgent = c.req.header('user-agent') || null
    const documentHash = documentFingerprint({ id: found.id, number: found.number, name: found.name, subtotal: found.subtotal, taxRate: found.taxRate, taxAmount: found.taxAmount, discount: found.discount, total: found.total, terms: found.terms || '', lineItems: lineItems.map((li: any) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })) })
    const [updated] = await db.update(t.quote).set({ status: 'approved', approvedAt: signedAt, signature: body.signature, signedAt, signedBy: check.signerName, signedIp: ip, signedUserAgent: userAgent, signatureHash: documentHash, consentAt: signedAt, updatedAt: signedAt }).where(eq(t.quote.id, quoteId)).returning()
    await recordSignatureAudit({ companyId: contact.companyId, entity: 'quote', entityId: quoteId, entityName: `${found.number} — ${found.name}`, signerName: check.signerName, signerEmail: contact.email, ip, userAgent, documentHash, signedAt, amount: found.total })
    notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'quote', entityId: quoteId, action: 'approved', actorName: check.signerName, actorRole: contact.type || 'client', summary: `signed and approved quote ${found.number} "${found.name}"`, details: { notes: body.notes || null, signedBy: check.signerName, documentHash } })
    return c.json({ success: true, quote: updated })
  })

  app.post('/p/:token/quotes/:quoteId/reject', portalAuth, async (c) => {
    const { contact } = P(c)
    const quoteId = c.req.param('quoteId')
    const { reason } = await c.req.json().catch(() => ({}))
    const found = await visibleQuote(quoteId, contact.id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    // A signed approval is a contract — it cannot be flipped to rejected from the portal afterwards.
    if (!QUOTE_RESPONDABLE.includes(found.status)) return c.json({ error: `This quote is ${found.status} and can no longer be declined` }, 400)
    const [updated] = await db.update(t.quote).set({ status: 'rejected', updatedAt: new Date() }).where(eq(t.quote.id, quoteId)).returning()
    notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'quote', entityId: quoteId, action: 'rejected', actorName: contact.name, actorRole: contact.type || 'client', summary: `rejected quote ${found.number} "${found.name}"`, details: { reason: reason || null } })
    return c.json({ success: true, quote: updated })
  })

  app.get('/p/:token/quotes/:quoteId/pdf', portalAuth, async (c) => {
    const { contact } = P(c)
    const quoteId = c.req.param('quoteId')
    const found = await visibleQuote(quoteId, contact.id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    const lineItems = await db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, quoteId)).orderBy(asc(t.quoteLineItem.sortOrder))
    const generate = await loadQuotePdf()
    const pdf = await generate({ ...found, lineItems, contact }, await fullCompany(contact.companyId))
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="quote-${found.number}.pdf"` } })
  })

  // ---- invoices
  const visibleInvoice = async (invoiceId: string, contactId: string) => {
    const [inv] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, invoiceId), eq(t.invoice.contactId, contactId), notInArray(t.invoice.status, PORTAL_INVOICE_HIDDEN))).limit(1)
    return inv || null
  }
  app.get('/p/:token/invoices', portalAuth, async (c) => {
    const { contact } = P(c)
    const rows = await db.select({ id: t.invoice.id, number: t.invoice.number, status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, amountRefunded: t.invoice.amountRefunded, balance: sql<string>`(${t.invoice.total} - ${t.invoice.amountPaid})`, dueDate: t.invoice.dueDate, createdAt: t.invoice.createdAt })
      .from(t.invoice).where(and(eq(t.invoice.contactId, contact.id), notInArray(t.invoice.status, PORTAL_INVOICE_HIDDEN))).orderBy(desc(t.invoice.createdAt))
    return c.json(rows)
  })
  app.get('/p/:token/invoices/:invoiceId', portalAuth, async (c) => {
    const { contact, company } = P(c)
    const invoiceId = c.req.param('invoiceId')
    const found = await visibleInvoice(invoiceId, contact.id)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    const lineItems = await db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, invoiceId)).orderBy(asc(t.invoiceLineItem.sortOrder))
    const payments = await db.select().from(t.payment).where(eq(t.payment.invoiceId, invoiceId)).orderBy(desc(t.payment.paidAt))
    let projectInfo = null
    if (found.projectId && t.project) {
      const [p] = await db.select({ name: t.project.name, number: t.project.number }).from(t.project).where(eq(t.project.id, found.projectId)).limit(1)
      projectInfo = p || null
    }
    return c.json({ ...found, balance: Number(found.total) - Number(found.amountPaid), lineItems, payments, project: projectInfo, company: { name: company.name, email: company.email, phone: company.phone, address: company.address } })
  })
  app.get('/p/:token/invoices/:invoiceId/pdf', portalAuth, async (c) => {
    const { contact } = P(c)
    const invoiceId = c.req.param('invoiceId')
    const found = await visibleInvoice(invoiceId, contact.id)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    const lineItems = await db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, invoiceId)).orderBy(asc(t.invoiceLineItem.sortOrder))
    const payments = await db.select().from(t.payment).where(eq(t.payment.invoiceId, invoiceId)).orderBy(desc(t.payment.paidAt))
    const generate = await loadInvoicePdf()
    const pdf = await generate({ ...found, lineItems, payments, contact }, await fullCompany(contact.companyId))
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice-${found.number}.pdf"` } })
  })

  // ---- change orders
  if (has.changeOrders) {
    const coSelect = () => ({ id: t.changeOrder.id, number: t.changeOrder.number, title: t.changeOrder.title, description: t.changeOrder.description, status: t.changeOrder.status, reason: t.changeOrder.reason, amount: t.changeOrder.amount, daysAdded: t.changeOrder.daysAdded, submittedDate: t.changeOrder.submittedDate, approvedDate: t.changeOrder.approvedDate, approvedBy: t.changeOrder.approvedBy, createdAt: t.changeOrder.createdAt, projectId: t.changeOrder.projectId, projectName: t.project.name, projectNumber: t.project.number })
    app.get('/p/:token/change-orders', portalAuth, async (c) => {
      const { contact } = P(c)
      const projectIds = await contactProjectIds(contact.id)
      if (projectIds.length === 0) return c.json([])
      const rows = await db.select(coSelect()).from(t.changeOrder).leftJoin(t.project, eq(t.changeOrder.projectId, t.project.id))
        .where(and(inArray(t.changeOrder.projectId, projectIds), inArray(t.changeOrder.status, ['pending', 'approved', 'rejected']))).orderBy(desc(t.changeOrder.createdAt))
      return c.json(rows)
    })
    const ownCo = async (changeOrderId: string, contactId: string) => {
      const projectIds = await contactProjectIds(contactId)
      if (projectIds.length === 0) return null
      const [row] = await db.select().from(t.changeOrder).where(and(eq(t.changeOrder.id, changeOrderId), inArray(t.changeOrder.projectId, projectIds))).limit(1)
      return row || null
    }
    app.get('/p/:token/change-orders/:changeOrderId', portalAuth, async (c) => {
      const { contact, company } = P(c)
      const changeOrderId = c.req.param('changeOrderId')
      const projectIds = await contactProjectIds(contact.id)
      if (projectIds.length === 0) return c.json({ error: 'Change order not found' }, 404)
      const [found] = await db.select(coSelect()).from(t.changeOrder).leftJoin(t.project, eq(t.changeOrder.projectId, t.project.id))
        .where(and(eq(t.changeOrder.id, changeOrderId), inArray(t.changeOrder.projectId, projectIds))).limit(1)
      if (!found) return c.json({ error: 'Change order not found' }, 404)
      return c.json({ ...found, project: { name: found.projectName, number: found.projectNumber }, company: { name: company.name, email: company.email, phone: company.phone } })
    })
    app.post('/p/:token/change-orders/:changeOrderId/approve', portalAuth, async (c) => {
      const { contact } = P(c)
      const changeOrderId = c.req.param('changeOrderId')
      const body = await c.req.json().catch(() => ({}))
      const check = validateSignatureInput(body)
      if (!check.ok) return c.json({ error: check.error }, 400)
      const found = await ownCo(changeOrderId, contact.id)
      if (!found) return c.json({ error: 'Change order not found' }, 404)
      if (found.status === 'approved') return c.json({ error: 'Change order already approved' }, 400)
      if (found.status !== 'pending') return c.json({ error: `This change order is ${found.status} and can no longer be approved` }, 400)
      const lineItems = t.changeOrderLineItem ? await db.select().from(t.changeOrderLineItem).where(eq(t.changeOrderLineItem.changeOrderId, changeOrderId)) : []
      const signedAt = new Date(), ip = signerIp(c), userAgent = c.req.header('user-agent') || null
      const documentHash = documentFingerprint({ id: found.id, number: found.number, title: found.title, description: found.description || '', reason: found.reason || '', amount: found.amount, daysAdded: found.daysAdded, lineItems: lineItems.map((li: any) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })) })
      const [updated] = await db.update(t.changeOrder).set({ status: 'approved', approvedDate: signedAt, approvedBy: check.signerName, signature: body.signature, signedAt, signedBy: check.signerName, signedIp: ip, signedUserAgent: userAgent, signatureHash: documentHash, consentAt: signedAt, updatedAt: signedAt }).where(eq(t.changeOrder.id, changeOrderId)).returning()
      await recordSignatureAudit({ companyId: contact.companyId, entity: 'change_order', entityId: changeOrderId, entityName: `${found.number} — ${found.title}`, signerName: check.signerName, signerEmail: contact.email, ip, userAgent, documentHash, signedAt, amount: found.amount })
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'change_order', entityId: changeOrderId, action: 'approved', actorName: check.signerName, actorRole: contact.type || 'client', summary: `signed and approved change order ${found.number} "${found.title}" ($${Number(found.amount || 0).toLocaleString()})`, details: { notes: body.notes || null, signedBy: check.signerName, documentHash } })
      return c.json({ success: true, changeOrder: updated })
    })
    app.post('/p/:token/change-orders/:changeOrderId/reject', portalAuth, async (c) => {
      const { contact } = P(c)
      const changeOrderId = c.req.param('changeOrderId')
      const { reason } = await c.req.json().catch(() => ({}))
      const found = await ownCo(changeOrderId, contact.id)
      if (!found) return c.json({ error: 'Change order not found' }, 404)
      if (found.status !== 'pending') return c.json({ error: `This change order is ${found.status} and can no longer be declined` }, 400)
      const [updated] = await db.update(t.changeOrder).set({ status: 'rejected', updatedAt: new Date() }).where(eq(t.changeOrder.id, changeOrderId)).returning()
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'change_order', entityId: changeOrderId, action: 'rejected', actorName: contact.name, actorRole: contact.type || 'client', summary: `rejected change order ${found.number} "${found.title}"`, details: { reason: reason || null } })
      return c.json({ success: true, changeOrder: updated })
    })
  }

  // ---- selections
  if (has.selections && selections) {
    app.get('/p/:token/selections/project/:projectId/selections', portalAuth, async (c) => {
      const { contact } = P(c)
      try { return c.json(await selections.getClientSelections(c.req.param('projectId'), contact.id)) }
      catch (error: any) { return c.json({ error: error.message || 'Failed to load selections' }, 400) }
    })
    app.post('/p/:token/selections/project/:projectId/selections/:selectionId', portalAuth, async (c) => {
      const { contact } = P(c)
      const { optionId, notes } = await c.req.json().catch(() => ({}))
      if (!optionId) return c.json({ error: 'Option ID is required' }, 400)
      try { return c.json(await selections.clientMakeSelection(c.req.param('projectId'), c.req.param('selectionId'), contact.id, { optionId, notes })) }
      catch (error: any) { return c.json({ error: error.message || 'Failed to make selection' }, 400) }
    })
  }

  // ---- messages
  const ownMessage = async (messageId: string, contactId: string, companyId: string) => {
    const [row] = await db.select().from(t.message).where(and(eq(t.message.id, messageId), eq(t.message.companyId, companyId), eq(t.message.contactId, contactId))).limit(1)
    return row || null
  }
  app.get('/p/:token/messages', portalAuth, async (c) => {
    const { contact, companyId } = P(c)
    const rows = await db.select().from(t.message).where(and(eq(t.message.companyId, companyId), eq(t.message.contactId, contact.id))).orderBy(desc(t.message.createdAt))
    return c.json(rows)
  })
  app.post('/p/:token/messages', portalAuth, async (c) => {
    const { contact, companyId } = P(c)
    const body = await c.req.json().catch(() => ({}))
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text) return c.json({ error: 'Message body is required' }, 400)
    if (text.length > 10_000) return c.json({ error: 'Message is too long' }, 400)
    const [row] = await db.insert(t.message).values({ companyId, contactId: contact.id, type: 'portal', direction: 'inbound', subject: typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 200) : null, body: text, status: 'sent', sentAt: new Date() }).returning()
    return c.json(row)
  })
  app.get('/p/:token/messages/:messageId', portalAuth, async (c) => {
    const { contact, companyId } = P(c)
    const found = await ownMessage(c.req.param('messageId'), contact.id, companyId)
    if (!found) return c.json({ error: 'Message not found' }, 404)
    return c.json(found)
  })
  app.post('/p/:token/messages/:messageId/read', portalAuth, async (c) => {
    const { contact, companyId } = P(c)
    const found = await ownMessage(c.req.param('messageId'), contact.id, companyId)
    if (!found) return c.json({ error: 'Message not found' }, 404)
    await db.update(t.message).set({ status: 'read', updatedAt: new Date() }).where(eq(t.message.id, found.id))
    return c.json({ success: true })
  })

  // =============================================
  // COLLABORATORS — subcontractors / vendors / architects / consultants
  // =============================================
  const COLLABORATOR_TYPES = ['subcontractor', 'vendor', 'supplier']
  const isCollaborator = (contact: any) => COLLABORATOR_TYPES.includes(String(contact.type || '').toLowerCase())
  if (has.myJobs) {
    // Subs: jobs assigned to them. Customers: their own jobs (a "Service" / "Service Calls" tab).
    const myJobsWhere = (contact: any) => isCollaborator(contact) && t.job.subcontractorId ? eq(t.job.subcontractorId, contact.id) : eq(t.job.contactId, contact.id)
    app.get('/p/:token/my-jobs', portalAuth, async (c) => {
      const { contact } = P(c)
      const cols: Record<string, any> = { id: t.job.id, number: t.job.number, title: t.job.title, description: t.job.description, status: t.job.status, priority: t.job.priority, scheduledDate: t.job.scheduledDate, scheduledTime: t.job.scheduledTime, address: t.job.address, city: t.job.city, state: t.job.state, zip: t.job.zip, completedAt: t.job.completedAt }
      if (t.job.scheduledEndDate) cols.scheduledEndDate = t.job.scheduledEndDate
      // notes / estimates are the office's; a customer only sees them when they are a collaborator on the job
      if (isCollaborator(contact)) { cols.notes = t.job.notes; if (t.job.estimatedHours) cols.estimatedHours = t.job.estimatedHours; if (t.job.estimatedValue) cols.estimatedValue = t.job.estimatedValue }
      if (t.project) { cols.projectId = t.job.projectId; cols.projectName = t.project.name; cols.projectNumber = t.project.number }
      const base = t.project ? db.select(cols).from(t.job).leftJoin(t.project, eq(t.job.projectId, t.project.id)) : db.select(cols).from(t.job)
      const rows = await base.where(and(eq(t.job.companyId, contact.companyId), myJobsWhere(contact))).orderBy(desc(t.job.scheduledDate))
      return c.json(rows)
    })
    app.post('/p/:token/my-jobs/:jobId/complete', portalAuth, async (c) => {
      const { contact } = P(c)
      const jobId = c.req.param('jobId')
      if (!isCollaborator(contact) || !t.job.subcontractorId) return c.json({ error: 'Only an assigned subcontractor can mark a job complete' }, 403)
      const [found] = await db.select().from(t.job).where(and(eq(t.job.id, jobId), eq(t.job.subcontractorId, contact.id), eq(t.job.companyId, contact.companyId))).limit(1)
      if (!found) return c.json({ error: 'Job not found' }, 404)
      if (found.status === 'completed') return c.json({ error: 'Job already completed' }, 400)
      const [updated] = await db.update(t.job).set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }).where(eq(t.job.id, jobId)).returning()
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'job', entityId: jobId, action: 'completed', actorName: contact.name, actorRole: contact.type || 'subcontractor', summary: `marked job ${found.number} "${found.title}" complete` })
      return c.json({ success: true, job: updated })
    })
  }

  if (has.lienWaivers) {
    app.get('/p/:token/lien-waivers', portalAuth, async (c) => {
      const { contact } = P(c)
      const base = { id: t.lienWaiver.id, projectId: t.lienWaiver.projectId, vendorName: t.lienWaiver.vendorName, vendorType: t.lienWaiver.vendorType, waiverType: t.lienWaiver.waiverType, throughDate: t.lienWaiver.throughDate, amountPrevious: t.lienWaiver.amountPrevious, amountCurrent: t.lienWaiver.amountCurrent, amountTotal: t.lienWaiver.amountTotal, status: t.lienWaiver.status, requestedAt: t.lienWaiver.requestedAt, dueDate: t.lienWaiver.dueDate, signedDate: t.lienWaiver.signedDate, documentUrl: t.lienWaiver.documentUrl, notes: t.lienWaiver.notes, createdAt: t.lienWaiver.createdAt }
      const q = t.project
        ? db.select({ ...base, projectName: t.project.name, projectNumber: t.project.number }).from(t.lienWaiver).leftJoin(t.project, eq(t.lienWaiver.projectId, t.project.id))
        : db.select(base).from(t.lienWaiver)
      const rows = await q.where(and(eq(t.lienWaiver.companyId, contact.companyId), eq(t.lienWaiver.vendorId, contact.id))).orderBy(desc(t.lienWaiver.createdAt))
      return c.json(rows)
    })
    app.post('/p/:token/lien-waivers/:waiverId/sign', portalAuth, async (c) => {
      const { contact } = P(c)
      const waiverId = c.req.param('waiverId')
      const body = await c.req.json().catch(() => ({}))
      const [found] = await db.select().from(t.lienWaiver).where(and(eq(t.lienWaiver.id, waiverId), eq(t.lienWaiver.vendorId, contact.id), eq(t.lienWaiver.companyId, contact.companyId))).limit(1)
      if (!found) return c.json({ error: 'Lien waiver not found' }, 404)
      if (found.status === 'approved' || found.status === 'received') return c.json({ error: 'Lien waiver already signed' }, 400)
      const [updated] = await db.update(t.lienWaiver).set({ status: 'received', receivedAt: new Date(), signedDate: new Date(), documentUrl: body.documentUrl || found.documentUrl, notes: body.notes || found.notes, updatedAt: new Date() }).where(eq(t.lienWaiver.id, waiverId)).returning()
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'lien_waiver', entityId: waiverId, action: 'signed', actorName: contact.name, actorRole: contact.type || 'subcontractor', summary: `signed a ${String(found.waiverType || '').replace(/_/g, ' ')} lien waiver for $${Number(found.amountTotal || 0).toLocaleString()}` })
      return c.json({ success: true, lienWaiver: updated })
    })
  }

  if (has.submittals) {
    app.get('/p/:token/submittals', portalAuth, async (c) => {
      const { contact } = P(c)
      const base = { id: t.submittal.id, number: t.submittal.number, title: t.submittal.title, description: t.submittal.description, status: t.submittal.status, specSection: t.submittal.specSection, dueDate: t.submittal.dueDate, submittedDate: t.submittal.submittedDate, approvedDate: t.submittal.approvedDate, approvedBy: t.submittal.approvedBy, notes: t.submittal.notes, createdAt: t.submittal.createdAt, projectId: t.submittal.projectId }
      const q = t.project
        ? db.select({ ...base, projectName: t.project.name, projectNumber: t.project.number }).from(t.submittal).leftJoin(t.project, eq(t.submittal.projectId, t.project.id))
        : db.select(base).from(t.submittal)
      // Architects see the company's submittals (scoped by company); per-project assignment is a later refinement.
      const rows = await q.where(eq(t.submittal.companyId, contact.companyId)).orderBy(desc(t.submittal.createdAt))
      return c.json(rows)
    })
    const ownSubmittal = async (id: string, companyId: string) => { const [row] = await db.select().from(t.submittal).where(and(eq(t.submittal.id, id), eq(t.submittal.companyId, companyId))).limit(1); return row || null }
    app.post('/p/:token/submittals/:submittalId/approve', portalAuth, async (c) => {
      const { contact } = P(c)
      const submittalId = c.req.param('submittalId')
      const body = await c.req.json().catch(() => ({}))
      const found = await ownSubmittal(submittalId, contact.companyId)
      if (!found) return c.json({ error: 'Submittal not found' }, 404)
      const [updated] = await db.update(t.submittal).set({ status: 'approved', approvedDate: new Date(), approvedBy: body.signedBy || contact.name, notes: body.notes || found.notes, updatedAt: new Date() }).where(eq(t.submittal.id, submittalId)).returning()
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'submittal', entityId: submittalId, action: 'approved', actorName: contact.name, actorRole: contact.type || 'architect', summary: `approved submittal ${found.number} "${found.title}"` })
      return c.json({ success: true, submittal: updated })
    })
    app.post('/p/:token/submittals/:submittalId/revise', portalAuth, async (c) => {
      const { contact } = P(c)
      const submittalId = c.req.param('submittalId')
      const { reason } = await c.req.json().catch(() => ({}))
      const found = await ownSubmittal(submittalId, contact.companyId)
      if (!found) return c.json({ error: 'Submittal not found' }, 404)
      const revisionNote = `[Revision requested by ${contact.name} on ${new Date().toLocaleDateString()}] ${reason || ''}`
      const [updated] = await db.update(t.submittal).set({ status: 'revise', notes: (found.notes ? `${found.notes}\n\n` : '') + revisionNote, updatedAt: new Date() }).where(eq(t.submittal.id, submittalId)).returning()
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'submittal', entityId: submittalId, action: 'revision_requested', actorName: contact.name, actorRole: contact.type || 'architect', summary: `requested revision on submittal ${found.number} "${found.title}"`, details: { reason: reason || null } })
      return c.json({ success: true, submittal: updated })
    })
  }

  if (has.rfis) {
    app.get('/p/:token/rfis-assigned', portalAuth, async (c) => {
      const { contact } = P(c)
      const base = { id: t.rfi.id, number: t.rfi.number, subject: t.rfi.subject, question: t.rfi.question, status: t.rfi.status, priority: t.rfi.priority, assignedTo: t.rfi.assignedTo, dueDate: t.rfi.dueDate, response: t.rfi.response, respondedAt: t.rfi.respondedAt, createdAt: t.rfi.createdAt, projectId: t.rfi.projectId }
      const q = t.project
        ? db.select({ ...base, projectName: t.project.name, projectNumber: t.project.number }).from(t.rfi).leftJoin(t.project, eq(t.rfi.projectId, t.project.id))
        : db.select(base).from(t.rfi)
      const rows = await q.where(and(eq(t.rfi.companyId, contact.companyId), eq(t.rfi.assignedTo, contact.name))).orderBy(desc(t.rfi.createdAt))
      return c.json(rows)
    })
    app.post('/p/:token/rfis-assigned/:rfiId/respond', portalAuth, async (c) => {
      const { contact } = P(c)
      const rfiId = c.req.param('rfiId')
      const { response } = await c.req.json().catch(() => ({}))
      if (!response || !String(response).trim()) return c.json({ error: 'Response is required' }, 400)
      const [found] = await db.select().from(t.rfi).where(and(eq(t.rfi.id, rfiId), eq(t.rfi.companyId, contact.companyId), eq(t.rfi.assignedTo, contact.name))).limit(1)
      if (!found) return c.json({ error: 'RFI not found' }, 404)
      const [updated] = await db.update(t.rfi).set({ status: 'answered', response: String(response).trim(), respondedAt: new Date(), respondedBy: contact.name, updatedAt: new Date() }).where(eq(t.rfi.id, rfiId)).returning()
      notifyCompany({ companyId: contact.companyId, projectId: found.projectId, entityType: 'rfi', entityId: rfiId, action: 'responded', actorName: contact.name, actorRole: contact.type || 'architect', summary: `responded to RFI ${found.number} "${found.subject}"` })
      return c.json({ success: true, rfi: updated })
    })
  }

  if (has.sharedDocuments) {
    app.get('/p/:token/shared-documents', portalAuth, async (c) => {
      const { contact } = P(c)
      const base = { id: t.document.id, name: t.document.name, type: t.document.type, originalName: t.document.originalName, mimeType: t.document.mimeType, size: t.document.size, url: t.document.url, thumbnailUrl: t.document.thumbnailUrl, description: t.document.description, createdAt: t.document.createdAt, projectId: t.document.projectId, sharedAt: t.documentShare.sharedAt }
      const q = t.project
        ? db.select({ ...base, projectName: t.project.name }).from(t.documentShare).innerJoin(t.document, eq(t.documentShare.documentId, t.document.id)).leftJoin(t.project, eq(t.document.projectId, t.project.id))
        : db.select(base).from(t.documentShare).innerJoin(t.document, eq(t.documentShare.documentId, t.document.id))
      const rows = await q.where(and(eq(t.documentShare.contactId, contact.id), eq(t.document.companyId, contact.companyId))).orderBy(desc(t.documentShare.sharedAt))
      return c.json(rows)
    })
  }

  // ---- project file room: owner sees every project doc; a collaborator sees what was shared with them; both may upload
  if (has.projectFiles && fileService) {
    const projectAccess = async (contactId: string, companyId: string, projectId: string): Promise<'owner' | 'collaborator' | null> => {
      const [owned] = await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, projectId), eq(t.project.contactId, contactId), eq(t.project.companyId, companyId))).limit(1)
      if (owned) return 'owner'
      if (t.job && t.job.subcontractorId) {
        const [assigned] = await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.projectId, projectId), eq(t.job.subcontractorId, contactId), eq(t.job.companyId, companyId))).limit(1)
        if (assigned) return 'collaborator'
      }
      if (t.documentShare) {
        const [shared] = await db.select({ id: t.documentShare.id }).from(t.documentShare).innerJoin(t.document, eq(t.documentShare.documentId, t.document.id))
          .where(and(eq(t.documentShare.contactId, contactId), eq(t.document.projectId, projectId), eq(t.document.companyId, companyId))).limit(1)
        if (shared) return 'collaborator'
      }
      return null
    }
    const docCols = () => ({ id: t.document.id, name: t.document.name, type: t.document.type, originalName: t.document.originalName, mimeType: t.document.mimeType, size: t.document.size, url: t.document.url, thumbnailUrl: t.document.thumbnailUrl, description: t.document.description, createdAt: t.document.createdAt, uploadedById: t.document.uploadedById })
    app.get('/p/:token/projects/:projectId/files', portalAuth, async (c) => {
      const { contact } = P(c)
      const projectId = c.req.param('projectId')
      const access = await projectAccess(contact.id, contact.companyId, projectId)
      if (!access) return c.json({ error: 'Project not found' }, 404)
      if (access === 'owner') {
        return c.json(await db.select(docCols()).from(t.document).where(and(eq(t.document.companyId, contact.companyId), eq(t.document.projectId, projectId))).orderBy(desc(t.document.createdAt)))
      }
      if (!t.documentShare) return c.json([])
      return c.json(await db.select({ ...docCols(), sharedAt: t.documentShare.sharedAt }).from(t.documentShare).innerJoin(t.document, eq(t.documentShare.documentId, t.document.id))
        .where(and(eq(t.documentShare.contactId, contact.id), eq(t.document.projectId, projectId), eq(t.document.companyId, contact.companyId))).orderBy(desc(t.documentShare.sharedAt)))
    })
    app.post('/p/:token/projects/:projectId/files', portalAuth, async (c) => {
      const { contact } = P(c)
      const projectId = c.req.param('projectId')
      const access = await projectAccess(contact.id, contact.companyId, projectId)
      if (!access) return c.json({ error: 'Project not found' }, 404)
      const body = await c.req.parseBody()
      const file = body['file'] as File | undefined
      if (!file || !(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400)
      let uploaded
      try { uploaded = await fileService.saveFile(file, contact.companyId, 'documents') } catch (err: any) { return c.json({ error: err.message }, 400) }
      let filePath = uploaded.path, thumbnailPath: string | null = null
      if (uploaded.mimetype?.startsWith('image/')) {
        try { filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 }); thumbnailPath = await fileService.generateThumbnail(filePath, 200) } catch { /* non-fatal */ }
      }
      const name = (body['name'] as string) || uploaded.originalname
      const [doc] = await db.insert(t.document).values({
        companyId: contact.companyId, name, description: (body['description'] as string) || null, type: (body['type'] as string) || 'general',
        filename: path.basename(filePath), originalName: uploaded.originalname, mimeType: uploaded.mimetype, size: uploaded.size, path: filePath,
        url: fileService.getFileUrl(filePath, contact.companyId), thumbnailUrl: thumbnailPath ? fileService.getFileUrl(thumbnailPath, contact.companyId) : null,
        projectId, contactId: contact.id, uploadedById: null,
      }).returning()
      if (access === 'collaborator' && t.documentShare) {
        try { await db.insert(t.documentShare).values({ documentId: doc.id, contactId: contact.id }) } catch { /* already shared */ }
      }
      notifyCompany({ companyId: contact.companyId, projectId, entityType: 'document', entityId: doc.id, action: 'uploaded', actorName: contact.name, actorRole: contact.type || 'collaborator', summary: `uploaded "${name}" to the project file room` })
      return c.json(doc, 201)
    })
  }

  // =============================================
  // SERVICE CUSTOMERS — equipment, service plans, service requests (HVAC / plumbing / landscaping)
  // =============================================
  if (has.equipment) {
    app.get('/p/:token/equipment', portalAuth, async (c) => {
      const { contact } = P(c)
      const list = await db.select({ id: t.equipment.id, name: t.equipment.name, model: t.equipment.model, manufacturer: t.equipment.manufacturer, serialNumber: t.equipment.serialNumber, status: t.equipment.status, location: t.equipment.location, purchaseDate: t.equipment.purchaseDate, warrantyExpiry: t.equipment.warrantyExpiry })
        .from(t.equipment).where(and(eq(t.equipment.contactId, contact.id), eq(t.equipment.companyId, contact.companyId))).orderBy(asc(t.equipment.name))
      if (list.length === 0 || !t.job.equipmentId) return c.json(list.map((e: any) => ({ ...e, lastServiceDate: null })))
      const last = await db.select({ equipmentId: t.job.equipmentId, completedAt: sql<string>`MAX(${t.job.completedAt})` }).from(t.job)
        .where(and(inArray(t.job.equipmentId, list.map((e: any) => e.id)), eq(t.job.status, 'completed'))).groupBy(t.job.equipmentId)
      const lastMap = Object.fromEntries(last.map((r: any) => [r.equipmentId, r.completedAt]))
      return c.json(list.map((e: any) => ({ ...e, lastServiceDate: lastMap[e.id] || null })))
    })
    app.get('/p/:token/equipment/:equipmentId/history', portalAuth, async (c) => {
      const { contact } = P(c)
      const equipmentId = c.req.param('equipmentId')
      const [unit] = await db.select().from(t.equipment).where(and(eq(t.equipment.id, equipmentId), eq(t.equipment.contactId, contact.id), eq(t.equipment.companyId, contact.companyId))).limit(1)
      if (!unit) return c.json({ error: 'Equipment not found' }, 404)
      if (!t.job.equipmentId) return c.json({ equipment: unit, history: [] })
      const jobs = await db.select({ id: t.job.id, title: t.job.title, status: t.job.status, jobType: t.job.jobType, scheduledDate: t.job.scheduledDate, completedAt: t.job.completedAt, notes: t.job.notes, assignedToId: t.job.assignedToId })
        .from(t.job).where(and(eq(t.job.equipmentId, equipmentId), eq(t.job.companyId, contact.companyId))).orderBy(desc(t.job.scheduledDate))
      const techIds = [...new Set(jobs.filter((j: any) => j.assignedToId).map((j: any) => j.assignedToId))] as string[]
      const techs = techIds.length ? await db.select({ id: t.user.id, firstName: t.user.firstName }).from(t.user).where(inArray(t.user.id, techIds)) : []
      const techMap = Object.fromEntries(techs.map((u: any) => [u.id, u.firstName]))
      const checklistMap: Record<string, any[]> = {}
      if (t.formSubmission && jobs.length) {
        const subs = await db.select({ jobId: t.formSubmission.jobId, values: t.formSubmission.values }).from(t.formSubmission).where(inArray(t.formSubmission.jobId, jobs.map((j: any) => j.id)))
        for (const s of subs) {
          const v = s.values as any
          // any checklist-shaped submission (an items[] list), not just the HVAC one
          if (v && Array.isArray(v.items)) (checklistMap[s.jobId] ||= []).push(v)
        }
      }
      return c.json({ equipment: unit, history: jobs.map((j: any) => ({ id: j.id, title: j.title, status: j.status, jobType: j.jobType, scheduledDate: j.scheduledDate, completedAt: j.completedAt, notes: j.notes, techName: j.assignedToId ? techMap[j.assignedToId] || null : null, checklist: checklistMap[j.id] || null })) })
    })
  }

  if (has.agreements) {
    app.get('/p/:token/agreements', portalAuth, async (c) => {
      const { contact } = P(c)
      const rows = await db.select({ id: t.serviceAgreement.id, name: t.serviceAgreement.name, status: t.serviceAgreement.status, startDate: t.serviceAgreement.startDate, endDate: t.serviceAgreement.endDate, renewalType: t.serviceAgreement.renewalType, billingFrequency: t.serviceAgreement.billingFrequency, amount: t.serviceAgreement.amount, terms: t.serviceAgreement.terms, notes: t.serviceAgreement.notes, nextServiceDate: t.serviceAgreement.nextServiceDate })
        .from(t.serviceAgreement).where(and(eq(t.serviceAgreement.contactId, contact.id), eq(t.serviceAgreement.companyId, contact.companyId))).orderBy(desc(t.serviceAgreement.startDate))
      if (!t.agreementVisit || rows.length === 0) return c.json(rows.map((a: any) => ({ ...a, nextVisitDate: a.nextServiceDate || null })))
      const visits = await db.select({ agreementId: t.agreementVisit.agreementId, scheduledDate: sql<string>`MIN(${t.agreementVisit.scheduledDate})` }).from(t.agreementVisit)
        .where(and(inArray(t.agreementVisit.agreementId, rows.map((a: any) => a.id)), eq(t.agreementVisit.status, 'scheduled'))).groupBy(t.agreementVisit.agreementId)
      const visitMap = Object.fromEntries(visits.map((v: any) => [v.agreementId, v.scheduledDate]))
      return c.json(rows.map((a: any) => ({ ...a, nextVisitDate: visitMap[a.id] || a.nextServiceDate || null })))
    })
  }

  if (has.serviceRequest) {
    app.post('/p/:token/service-request', portalAuth, async (c) => {
      const { contact } = P(c)
      const body = await c.req.json().catch(() => ({}))
      const description = typeof body.description === 'string' ? body.description.trim() : ''
      if (!description) return c.json({ error: 'Issue description is required' }, 400)
      const urgency = body.urgency === 'urgent' ? 'urgent' : 'routine'
      const preferredContact = ['call', 'text', 'email'].includes(body.preferredContact) ? body.preferredContact : 'any'
      let equipmentName = '', equipmentId: string | null = null
      if (body.equipmentId && t.equipment) {
        const [unit] = await db.select({ id: t.equipment.id, name: t.equipment.name }).from(t.equipment).where(and(eq(t.equipment.id, body.equipmentId), eq(t.equipment.contactId, contact.id))).limit(1)
        if (unit) { equipmentName = unit.name; equipmentId = unit.id }
      }
      const prefix = o.jobNumbering?.prefix || 'JOB', pad = o.jobNumbering?.pad ?? 5
      const created = await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, t.job, t.job.number, t.job.companyId, contact.companyId, { prefix, pad })
        const values: Record<string, unknown> = {
          number, title: equipmentName ? `Service Request: ${equipmentName}` : 'Service Request from Customer Portal', description,
          status: o.serviceRequestStatus || 'pending', priority: urgency === 'urgent' ? 'high' : 'normal',
          address: contact.address, city: contact.city, state: contact.state, zip: contact.zip,
          internalNotes: `[${new Date().toISOString()}] Customer portal request\nPreferred contact: ${preferredContact}\nUrgency: ${urgency}`,
          companyId: contact.companyId, contactId: contact.id,
        }
        if (t.job.jobType) values.jobType = 'repair'
        if (t.job.source) values.source = 'customer_portal'
        if (t.job.equipmentId) values.equipmentId = equipmentId
        const [row] = await tx.insert(t.job).values(values).returning()
        return row
      })
      try { if (emitToCompany && EVENTS?.JOB_CREATED) emitToCompany(contact.companyId, EVENTS.JOB_CREATED, { id: created.id, number: created.number, source: 'customer_portal' }) } catch { /* socket optional */ }
      notifyCompany({ companyId: contact.companyId, entityType: 'job', entityId: created.id, action: 'requested', actorName: contact.name, actorRole: contact.type || 'client', summary: `requested service${equipmentName ? ` on ${equipmentName}` : ''} (${urgency}) — ${created.number}`, details: { preferredContact, urgency, description } })
      return c.json({ success: true, jobId: created.id, jobNumber: created.number, responseHours: urgency === 'urgent' ? 4 : 24 }, 201)
    })
  }

  return app
}
