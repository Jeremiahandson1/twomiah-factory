/**
 * Customer Portal Routes
 *
 * Allows contacts to view their quotes, invoices, and project status
 * via a secure token link (no password required)
 */

import { Hono } from 'hono'
import crypto from 'crypto'
import path from 'path'
import { eq, and, inArray, count, sum, sql, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, company, project, quote, quoteLineItem, invoice, invoiceLineItem, payment, changeOrder, job, message, lienWaiver, rfi, submittal, document, documentShare, user, activity } from '../../db/schema.ts'
import selections from '../services/selections.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'
import fileService from '../services/fileUpload.ts'

// =============================================
// COLLABORATOR ACTION NOTIFY HELPER
// Emails company admins/managers and records an activity row. Non-blocking.
// =============================================
async function notifyCollaboratorAction(params: {
  companyId: string
  projectId?: string | null
  entityType: string
  entityId: string
  action: string
  actorName: string
  actorRole: string
  summary: string
  details?: Record<string, unknown>
}) {
  const { companyId, projectId, entityType, entityId, action, actorName, actorRole, summary, details } = params

  // Activity row (best-effort; never fail the caller)
  try {
    await db.insert(activity).values({
      companyId,
      entityType,
      entityId,
      action,
      description: summary,
      metadata: { projectId: projectId || null, actorName, actorRole, ...(details || {}) },
    } as any)
  } catch (err) {
    console.warn('[portal] activity insert failed:', (err as Error).message)
  }

  // Email admins (best-effort)
  try {
    const admins = await db
      .select({ email: user.email, name: user.name, role: user.role })
      .from(user)
      .where(
        and(
          eq(user.companyId, companyId),
          eq(user.isActive, true),
          inArray(user.role, ['owner', 'admin', 'manager'])
        )
      )

    if (admins.length === 0) return

    const [companyInfo] = await db
      .select({ name: company.name })
      .from(company)
      .where(eq(company.id, companyId))
      .limit(1)

    let projectName: string | null = null
    if (projectId) {
      const [p] = await db
        .select({ name: project.name, number: project.number })
        .from(project)
        .where(eq(project.id, projectId))
        .limit(1)
      projectName = p ? `${p.number ? p.number + ' · ' : ''}${p.name}` : null
    }

    for (const admin of admins) {
      if (!admin.email) continue
      emailService
        .send(admin.email, 'collaboratorAction', {
          companyName: companyInfo?.name || 'Your Company',
          adminName: admin.name,
          actorName,
          actorRole,
          summary,
          projectName,
        })
        .catch(() => {})
    }
  } catch (err) {
    console.warn('[portal] notify admins failed:', (err as Error).message)
  }
}

const app = new Hono()

// =============================================
// ADMIN ROUTES (for managing portal access)
// =============================================

// Enable portal for a contact
app.post('/contacts/:contactId/enable', authenticate, requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [foundContact] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  if (!foundContact.email) {
    return c.json({ error: 'Contact must have an email to enable portal access' }, 400)
  }

  // Generate token (valid for 90 days)
  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(contact)
    .set({
      portalEnabled: true,
      portalToken,
      portalTokenExp,
      updatedAt: new Date(),
    })
    .where(eq(contact.id, contactId))

  const portalUrl = `${process.env.FRONTEND_URL}/portal/${portalToken}`

  return c.json({
    success: true,
    portalUrl,
    expiresAt: portalTokenExp,
  })
})

// Disable portal for a contact
app.post('/contacts/:contactId/disable', authenticate, requirePermission('contacts:update'), async (c) => {
  const contactId = c.req.param('contactId')

  await db
    .update(contact)
    .set({
      portalEnabled: false,
      portalToken: null,
      portalTokenExp: null,
      updatedAt: new Date(),
    })
    .where(eq(contact.id, contactId))

  return c.json({ success: true })
})

// Regenerate portal token
app.post('/contacts/:contactId/regenerate', authenticate, requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [foundContact] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const portalToken = crypto.randomBytes(32).toString('hex')
  const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

  await db
    .update(contact)
    .set({
      portalToken,
      portalTokenExp,
      updatedAt: new Date(),
    })
    .where(eq(contact.id, contactId))

  const portalUrl = `${process.env.FRONTEND_URL}/portal/${portalToken}`

  return c.json({
    success: true,
    portalUrl,
    expiresAt: portalTokenExp,
  })
})

// Send portal link via email
app.post('/contacts/:contactId/send-link', authenticate, requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [foundContact] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  if (!foundContact.email) {
    return c.json({ error: 'Contact has no email address' }, 400)
  }

  const contactData = foundContact as any
  if (!contactData.portalEnabled || !contactData.portalToken) {
    return c.json({ error: 'Portal access not enabled for this contact' }, 400)
  }

  // Get company info
  const [companyInfo] = await db
    .select()
    .from(company)
    .where(eq(company.id, user.companyId))
    .limit(1)

  const portalUrl = `${process.env.FRONTEND_URL}/portal/${contactData.portalToken}`

  await emailService.send(foundContact.email, 'portalInvite', {
    contactName: foundContact.name,
    companyName: companyInfo?.name,
    portalUrl,
    role: (foundContact as any).type || 'client',
  })

  return c.json({ success: true, sentTo: foundContact.email })
})

// Get portal status for a contact
app.get('/contacts/:contactId/status', authenticate, requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [foundContact] = await db
    .select()
    .from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  const contactData = foundContact as any

  return c.json({
    enabled: contactData.portalEnabled,
    hasToken: !!contactData.portalToken,
    expiresAt: contactData.portalTokenExp,
    lastVisit: contactData.lastPortalVisit,
    portalUrl: contactData.portalToken ? `${process.env.FRONTEND_URL}/portal/${contactData.portalToken}` : null,
  })
})

// =============================================
// PUBLIC PORTAL ROUTES (token-based auth)
// =============================================

// Middleware to authenticate portal token
async function portalAuth(c: any, next: any) {
  const token = c.req.param('token')

  if (!token) {
    return c.json({ error: 'Portal token required' }, 401)
  }

  const [foundContact] = await db
    .select({
      id: contact.id,
      type: contact.type,
      name: contact.name,
      email: contact.email,
      companyId: contact.companyId,
      portalEnabled: contact.portalEnabled,
      portalToken: contact.portalToken,
      portalTokenExp: contact.portalTokenExp,
      companyName: company.name,
      companyLogo: company.logo,
      companyPrimaryColor: company.primaryColor,
      companyEmail: company.email,
      companyPhone: company.phone,
    })
    .from(contact)
    .leftJoin(company, eq(contact.companyId, company.id))
    .where(
      and(
        eq(contact.portalToken, token),
        eq(contact.portalEnabled, true)
      )
    )
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Invalid or expired portal link' }, 401)
  }

  const contactData = foundContact as any
  if (contactData.portalTokenExp && new Date() > new Date(contactData.portalTokenExp)) {
    return c.json({ error: 'Portal link has expired. Please contact the company for a new link.' }, 401)
  }

  // Update last visit
  await db
    .update(contact)
    .set({ lastPortalVisit: new Date(), updatedAt: new Date() })
    .where(eq(contact.id, foundContact.id))

  c.set('portal', {
    contact: foundContact,
    company: {
      id: foundContact.companyId,
      name: foundContact.companyName,
      logo: foundContact.companyLogo,
      primaryColor: foundContact.companyPrimaryColor,
      email: foundContact.companyEmail,
      phone: foundContact.companyPhone,
    },
    companyId: foundContact.companyId,
  })

  await next()
}

// Get portal home (contact info + summary)
app.get('/p/:token', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const portalCompany = portal.company

  // Get counts
  const [projectCountResult] = await db
    .select({ value: count() })
    .from(project)
    .where(eq(project.contactId, portalContact.id))

  const [quoteCountResult] = await db
    .select({ value: count() })
    .from(quote)
    .where(
      and(
        eq(quote.contactId, portalContact.id),
        inArray(quote.status, ['sent', 'viewed'])
      )
    )

  const [invoiceCountResult] = await db
    .select({ value: count() })
    .from(invoice)
    .where(eq(invoice.contactId, portalContact.id))

  const [balanceResult] = await db
    .select({ total: sql<string>`COALESCE(SUM(${invoice.total} - ${invoice.amountPaid}), 0)` })
    .from(invoice)
    .where(
      and(
        eq(invoice.contactId, portalContact.id),
        inArray(invoice.status, ['sent', 'partial', 'overdue'])
      )
    )

  return c.json({
    contact: {
      name: portalContact.name,
      email: portalContact.email,
      type: portalContact.type || 'client',
    },
    company: {
      name: portalCompany.name,
      logo: portalCompany.logo,
      primaryColor: portalCompany.primaryColor,
      email: portalCompany.email,
      phone: portalCompany.phone,
    },
    summary: {
      activeProjects: projectCountResult.value,
      pendingQuotes: quoteCountResult.value,
      totalInvoices: invoiceCountResult.value,
      outstandingBalance: Number(balanceResult?.total || 0),
    },
  })
})

// Get projects
app.get('/p/:token/projects', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const projects = await db
    .select({
      id: project.id,
      number: project.number,
      name: project.name,
      status: project.status,
      progress: project.progress,
      startDate: project.startDate,
      endDate: project.endDate,
      address: project.address,
      city: project.city,
      state: project.state,
    })
    .from(project)
    .where(eq(project.contactId, portalContact.id))
    .orderBy(desc(project.createdAt))

  return c.json(projects)
})

// Get single project
app.get('/p/:token/projects/:projectId', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const projectId = c.req.param('projectId')

  const [foundProject] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.contactId, portalContact.id)))
    .limit(1)

  if (!foundProject) {
    return c.json({ error: 'Project not found' }, 404)
  }

  // Get recent jobs
  const projectJobs = await db
    .select({
      id: job.id,
      number: job.number,
      title: job.title,
      status: job.status,
      scheduledDate: job.scheduledDate,
    })
    .from(job)
    .where(eq(job.projectId, projectId))
    .orderBy(desc(job.scheduledDate))
    .limit(10)

  return c.json({ ...foundProject, jobs: projectJobs })
})

// Get quotes
app.get('/p/:token/quotes', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const quotes = await db
    .select({
      id: quote.id,
      number: quote.number,
      name: quote.name,
      status: quote.status,
      total: quote.total,
      expiryDate: quote.expiryDate,
      createdAt: quote.createdAt,
    })
    .from(quote)
    .where(eq(quote.contactId, portalContact.id))
    .orderBy(desc(quote.createdAt))

  return c.json(quotes)
})

// Get single quote with line items
app.get('/p/:token/quotes/:quoteId', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const portalCompany = portal.company
  const quoteId = c.req.param('quoteId')

  const [foundQuote] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.contactId, portalContact.id)))
    .limit(1)

  if (!foundQuote) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  const lineItems = await db
    .select()
    .from(quoteLineItem)
    .where(eq(quoteLineItem.quoteId, quoteId))
    .orderBy(asc(quoteLineItem.sortOrder))

  // Get project info if linked
  let projectInfo = null
  if (foundQuote.projectId) {
    const [p] = await db
      .select({ name: project.name, number: project.number })
      .from(project)
      .where(eq(project.id, foundQuote.projectId))
      .limit(1)
    projectInfo = p || null
  }

  // Mark as viewed if sent
  if (foundQuote.status === 'sent') {
    await db
      .update(quote)
      .set({ status: 'viewed', updatedAt: new Date() })
      .where(eq(quote.id, quoteId))
  }

  return c.json({
    ...foundQuote,
    lineItems,
    project: projectInfo,
    company: {
      name: portalCompany.name,
      email: portalCompany.email,
      phone: portalCompany.phone,
    },
  })
})

// Approve quote
app.post('/p/:token/quotes/:quoteId/approve', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const quoteId = c.req.param('quoteId')
  const { signature, signedBy, notes } = await c.req.json()

  const [foundQuote] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.contactId, portalContact.id)))
    .limit(1)

  if (!foundQuote) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  if (foundQuote.status === 'approved') {
    return c.json({ error: 'Quote already approved' }, 400)
  }

  const [updated] = await db
    .update(quote)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      signature: signature || null,
      signedAt: signature ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: foundQuote.projectId,
    entityType: 'quote',
    entityId: quoteId,
    action: 'approved',
    actorName: signedBy || portalContact.name,
    actorRole: portalContact.type || 'client',
    summary: `approved quote ${foundQuote.number} "${foundQuote.name}"`,
    details: { notes: notes || null },
  })

  return c.json({ success: true, quote: updated })
})

// Reject quote
app.post('/p/:token/quotes/:quoteId/reject', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const quoteId = c.req.param('quoteId')
  const { reason } = await c.req.json()

  const [foundQuote] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.contactId, portalContact.id)))
    .limit(1)

  if (!foundQuote) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  const [updated] = await db
    .update(quote)
    .set({
      status: 'rejected',
      updatedAt: new Date(),
    })
    .where(eq(quote.id, quoteId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: foundQuote.projectId,
    entityType: 'quote',
    entityId: quoteId,
    action: 'rejected',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'client',
    summary: `rejected quote ${foundQuote.number} "${foundQuote.name}"`,
    details: { reason: reason || null },
  })

  return c.json({ success: true, quote: updated })
})

// Get invoices
app.get('/p/:token/invoices', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const invoices = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      dueDate: invoice.dueDate,
      createdAt: invoice.createdAt,
    })
    .from(invoice)
    .where(eq(invoice.contactId, portalContact.id))
    .orderBy(desc(invoice.createdAt))

  return c.json(invoices)
})

// Get single invoice with line items and payments
app.get('/p/:token/invoices/:invoiceId', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const portalCompany = portal.company
  const invoiceId = c.req.param('invoiceId')

  const [foundInvoice] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.contactId, portalContact.id)))
    .limit(1)

  if (!foundInvoice) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  const lineItems = await db
    .select()
    .from(invoiceLineItem)
    .where(eq(invoiceLineItem.invoiceId, invoiceId))
    .orderBy(asc(invoiceLineItem.sortOrder))

  const payments = await db
    .select()
    .from(payment)
    .where(eq(payment.invoiceId, invoiceId))
    .orderBy(desc(payment.paidAt))

  // Get project info if linked
  let projectInfo = null
  if (foundInvoice.projectId) {
    const [p] = await db
      .select({ name: project.name, number: project.number })
      .from(project)
      .where(eq(project.id, foundInvoice.projectId))
      .limit(1)
    projectInfo = p || null
  }

  return c.json({
    ...foundInvoice,
    lineItems,
    payments,
    project: projectInfo,
    company: {
      name: portalCompany.name,
      email: portalCompany.email,
      phone: portalCompany.phone,
      address: (portalCompany as any).address,
    },
  })
})

// Download invoice PDF
app.get('/p/:token/invoices/:invoiceId/pdf', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const portalCompany = portal.company
  const invoiceId = c.req.param('invoiceId')

  const [foundInvoice] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.contactId, portalContact.id)))
    .limit(1)

  if (!foundInvoice) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  const lineItems = await db
    .select()
    .from(invoiceLineItem)
    .where(eq(invoiceLineItem.invoiceId, invoiceId))
    .orderBy(asc(invoiceLineItem.sortOrder))

  const payments = await db
    .select()
    .from(payment)
    .where(eq(payment.invoiceId, invoiceId))
    .orderBy(desc(payment.paidAt))

  const { generateInvoicePDF } = await import('../services/pdf.ts')
  const pdfBuffer = await generateInvoicePDF({ ...foundInvoice, lineItems, payments, contact: portalContact }, portalCompany)

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${foundInvoice.number}.pdf"`,
    },
  })
})

// Download quote PDF
app.get('/p/:token/quotes/:quoteId/pdf', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const portalCompany = portal.company
  const quoteId = c.req.param('quoteId')

  const [foundQuote] = await db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.contactId, portalContact.id)))
    .limit(1)

  if (!foundQuote) {
    return c.json({ error: 'Quote not found' }, 404)
  }

  const lineItems = await db
    .select()
    .from(quoteLineItem)
    .where(eq(quoteLineItem.quoteId, quoteId))
    .orderBy(asc(quoteLineItem.sortOrder))

  const { generateQuotePDF } = await import('../services/pdf.ts')
  const pdfBuffer = await generateQuotePDF({ ...foundQuote, lineItems, contact: portalContact }, portalCompany)

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${foundQuote.number}.pdf"`,
    },
  })
})

// =============================================
// CHANGE ORDERS
// =============================================

// Get change orders for contact's projects
app.get('/p/:token/change-orders', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  // Get contact's project IDs
  const contactProjects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.contactId, portalContact.id))

  const projectIds = contactProjects.map((p) => p.id)

  if (projectIds.length === 0) {
    return c.json([])
  }

  const changeOrders = await db
    .select({
      id: changeOrder.id,
      number: changeOrder.number,
      title: changeOrder.title,
      description: changeOrder.description,
      status: changeOrder.status,
      reason: changeOrder.reason,
      amount: changeOrder.amount,
      daysAdded: changeOrder.daysAdded,
      submittedDate: changeOrder.submittedDate,
      approvedDate: changeOrder.approvedDate,
      approvedBy: changeOrder.approvedBy,
      createdAt: changeOrder.createdAt,
      projectId: changeOrder.projectId,
      projectName: project.name,
      projectNumber: project.number,
    })
    .from(changeOrder)
    .leftJoin(project, eq(changeOrder.projectId, project.id))
    .where(
      and(
        inArray(changeOrder.projectId, projectIds),
        inArray(changeOrder.status, ['pending', 'approved', 'rejected'])
      )
    )
    .orderBy(desc(changeOrder.createdAt))

  return c.json(changeOrders)
})

// Get single change order
app.get('/p/:token/change-orders/:changeOrderId', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const portalCompany = portal.company
  const changeOrderId = c.req.param('changeOrderId')

  // Get contact's project IDs
  const contactProjects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.contactId, portalContact.id))

  const projectIds = contactProjects.map((p) => p.id)

  if (projectIds.length === 0) {
    return c.json({ error: 'Change order not found' }, 404)
  }

  const [foundChangeOrder] = await db
    .select({
      id: changeOrder.id,
      number: changeOrder.number,
      title: changeOrder.title,
      description: changeOrder.description,
      status: changeOrder.status,
      reason: changeOrder.reason,
      amount: changeOrder.amount,
      daysAdded: changeOrder.daysAdded,
      submittedDate: changeOrder.submittedDate,
      approvedDate: changeOrder.approvedDate,
      approvedBy: changeOrder.approvedBy,
      createdAt: changeOrder.createdAt,
      projectId: changeOrder.projectId,
      projectName: project.name,
      projectNumber: project.number,
    })
    .from(changeOrder)
    .leftJoin(project, eq(changeOrder.projectId, project.id))
    .where(
      and(
        eq(changeOrder.id, changeOrderId),
        inArray(changeOrder.projectId, projectIds)
      )
    )
    .limit(1)

  if (!foundChangeOrder) {
    return c.json({ error: 'Change order not found' }, 404)
  }

  return c.json({
    ...foundChangeOrder,
    project: { name: foundChangeOrder.projectName, number: foundChangeOrder.projectNumber },
    company: {
      name: portalCompany.name,
      email: portalCompany.email,
      phone: portalCompany.phone,
    },
  })
})

// Approve change order with signature
app.post('/p/:token/change-orders/:changeOrderId/approve', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const changeOrderId = c.req.param('changeOrderId')
  const { signature, signedBy, notes } = await c.req.json()

  // Get contact's project IDs
  const contactProjects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.contactId, portalContact.id))

  const projectIds = contactProjects.map((p) => p.id)

  if (projectIds.length === 0) {
    return c.json({ error: 'Change order not found' }, 404)
  }

  const [foundChangeOrder] = await db
    .select()
    .from(changeOrder)
    .where(
      and(
        eq(changeOrder.id, changeOrderId),
        inArray(changeOrder.projectId, projectIds)
      )
    )
    .limit(1)

  if (!foundChangeOrder) {
    return c.json({ error: 'Change order not found' }, 404)
  }

  if (foundChangeOrder.status === 'approved') {
    return c.json({ error: 'Change order already approved' }, 400)
  }

  const [updated] = await db
    .update(changeOrder)
    .set({
      status: 'approved',
      approvedDate: new Date(),
      approvedBy: signedBy || portalContact.name,
      updatedAt: new Date(),
    })
    .where(eq(changeOrder.id, changeOrderId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: foundChangeOrder.projectId,
    entityType: 'change_order',
    entityId: changeOrderId,
    action: 'approved',
    actorName: signedBy || portalContact.name,
    actorRole: portalContact.type || 'client',
    summary: `approved change order ${foundChangeOrder.number} "${foundChangeOrder.title}" ($${Number(foundChangeOrder.amount || 0).toLocaleString()})`,
    details: { notes: notes || null },
  })

  return c.json({ success: true, changeOrder: updated })
})

// Reject change order
app.post('/p/:token/change-orders/:changeOrderId/reject', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const changeOrderId = c.req.param('changeOrderId')
  const { reason } = await c.req.json()

  // Get contact's project IDs
  const contactProjects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.contactId, portalContact.id))

  const projectIds = contactProjects.map((p) => p.id)

  if (projectIds.length === 0) {
    return c.json({ error: 'Change order not found' }, 404)
  }

  const [foundChangeOrder] = await db
    .select()
    .from(changeOrder)
    .where(
      and(
        eq(changeOrder.id, changeOrderId),
        inArray(changeOrder.projectId, projectIds)
      )
    )
    .limit(1)

  if (!foundChangeOrder) {
    return c.json({ error: 'Change order not found' }, 404)
  }

  const [updated] = await db
    .update(changeOrder)
    .set({
      status: 'rejected',
      updatedAt: new Date(),
    })
    .where(eq(changeOrder.id, changeOrderId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: foundChangeOrder.projectId,
    entityType: 'change_order',
    entityId: changeOrderId,
    action: 'rejected',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'client',
    summary: `rejected change order ${foundChangeOrder.number} "${foundChangeOrder.title}"`,
    details: { reason: reason || null },
  })

  return c.json({ success: true, changeOrder: updated })
})

// =============================================
// SELECTIONS
// =============================================

// Get selections for a project
app.get('/p/:token/selections/project/:projectId/selections', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const projectId = c.req.param('projectId')

  try {
    const data = await selections.getClientSelections(projectId, portalContact.id)
    return c.json(data)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to load selections' }, 400)
  }
})

// Client makes a selection
app.post('/p/:token/selections/project/:projectId/selections/:selectionId', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const projectId = c.req.param('projectId')
  const selectionId = c.req.param('selectionId')
  const { optionId, notes } = await c.req.json()

  if (!optionId) {
    return c.json({ error: 'Option ID is required' }, 400)
  }

  try {
    const result = await selections.clientMakeSelection(
      projectId,
      selectionId,
      portalContact.id,
      { optionId, notes }
    )
    return c.json(result)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to make selection' }, 400)
  }
})

// =============================================
// MESSAGES
// =============================================

// List messages for the portal contact
app.get('/p/:token/messages', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const companyId = portal.companyId

  const messages = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.companyId, companyId),
        eq(message.contactId, portalContact.id)
      )
    )
    .orderBy(desc(message.createdAt))

  return c.json(messages)
})

// Send a new message from portal contact
app.post('/p/:token/messages', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const companyId = portal.companyId
  const body = await c.req.json()

  if (!body.body || !body.body.trim()) {
    return c.json({ error: 'Message body is required' }, 400)
  }

  const [newMessage] = await db
    .insert(message)
    .values({
      companyId,
      contactId: portalContact.id,
      type: 'portal',
      direction: 'inbound',
      subject: body.subject || null,
      body: body.body.trim(),
      status: 'sent',
      sentAt: new Date(),
    })
    .returning()

  return c.json(newMessage)
})

// Get single message detail
app.get('/p/:token/messages/:messageId', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const companyId = portal.companyId
  const messageId = c.req.param('messageId')

  const [foundMessage] = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.id, messageId),
        eq(message.companyId, companyId),
        eq(message.contactId, portalContact.id)
      )
    )
    .limit(1)

  if (!foundMessage) {
    return c.json({ error: 'Message not found' }, 404)
  }

  return c.json(foundMessage)
})

// Mark message as read
app.post('/p/:token/messages/:messageId/read', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const companyId = portal.companyId
  const messageId = c.req.param('messageId')

  const [foundMessage] = await db
    .select()
    .from(message)
    .where(
      and(
        eq(message.id, messageId),
        eq(message.companyId, companyId),
        eq(message.contactId, portalContact.id)
      )
    )
    .limit(1)

  if (!foundMessage) {
    return c.json({ error: 'Message not found' }, 404)
  }

  await db
    .update(message)
    .set({ status: 'read', updatedAt: new Date() })
    .where(eq(message.id, messageId))

  return c.json({ success: true })
})

// =============================================
// COLLABORATOR ENDPOINTS (subcontractors, architects, consultants)
// Role-scoped data for non-client portal users.
// =============================================

// --- SUBCONTRACTOR: Jobs assigned to this contact ---
app.get('/p/:token/my-jobs', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const jobs = await db
    .select({
      id: job.id,
      number: job.number,
      title: job.title,
      description: job.description,
      status: job.status,
      priority: job.priority,
      scheduledDate: job.scheduledDate,
      scheduledEndDate: job.scheduledEndDate,
      scheduledTime: job.scheduledTime,
      address: job.address,
      city: job.city,
      state: job.state,
      zip: job.zip,
      notes: job.notes,
      estimatedHours: job.estimatedHours,
      estimatedValue: job.estimatedValue,
      completedAt: job.completedAt,
      projectId: job.projectId,
      projectName: project.name,
      projectNumber: project.number,
    })
    .from(job)
    .leftJoin(project, eq(job.projectId, project.id))
    .where(
      and(
        eq(job.companyId, portalContact.companyId),
        eq(job.subcontractorId, portalContact.id)
      )
    )
    .orderBy(desc(job.scheduledDate))

  return c.json(jobs)
})

// Sub marks their job as completed
app.post('/p/:token/my-jobs/:jobId/complete', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const jobId = c.req.param('jobId')

  const [foundJob] = await db
    .select()
    .from(job)
    .where(and(eq(job.id, jobId), eq(job.subcontractorId, portalContact.id)))
    .limit(1)

  if (!foundJob) {
    return c.json({ error: 'Job not found' }, 404)
  }

  const [updated] = await db
    .update(job)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(job.id, jobId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: foundJob.projectId,
    entityType: 'job',
    entityId: jobId,
    action: 'completed',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'subcontractor',
    summary: `marked job ${foundJob.number} "${foundJob.title}" complete`,
  })

  return c.json({ success: true, job: updated })
})

// --- SUBCONTRACTOR / VENDOR: Lien waivers for this contact ---
app.get('/p/:token/lien-waivers', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const waivers = await db
    .select({
      id: lienWaiver.id,
      projectId: lienWaiver.projectId,
      projectName: project.name,
      projectNumber: project.number,
      vendorName: lienWaiver.vendorName,
      vendorType: lienWaiver.vendorType,
      waiverType: lienWaiver.waiverType,
      throughDate: lienWaiver.throughDate,
      amountPrevious: lienWaiver.amountPrevious,
      amountCurrent: lienWaiver.amountCurrent,
      amountTotal: lienWaiver.amountTotal,
      status: lienWaiver.status,
      requestedAt: lienWaiver.requestedAt,
      dueDate: lienWaiver.dueDate,
      signedDate: lienWaiver.signedDate,
      documentUrl: lienWaiver.documentUrl,
      notes: lienWaiver.notes,
      createdAt: lienWaiver.createdAt,
    })
    .from(lienWaiver)
    .leftJoin(project, eq(lienWaiver.projectId, project.id))
    .where(
      and(
        eq(lienWaiver.companyId, portalContact.companyId),
        eq(lienWaiver.vendorId, portalContact.id)
      )
    )
    .orderBy(desc(lienWaiver.createdAt))

  return c.json(waivers)
})

// Sub signs a lien waiver from the portal
app.post('/p/:token/lien-waivers/:waiverId/sign', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const waiverId = c.req.param('waiverId')
  const body = await c.req.json().catch(() => ({}))

  const [found] = await db
    .select()
    .from(lienWaiver)
    .where(and(eq(lienWaiver.id, waiverId), eq(lienWaiver.vendorId, portalContact.id)))
    .limit(1)

  if (!found) {
    return c.json({ error: 'Lien waiver not found' }, 404)
  }
  if (found.status === 'approved' || found.status === 'received') {
    return c.json({ error: 'Lien waiver already signed' }, 400)
  }

  const [updated] = await db
    .update(lienWaiver)
    .set({
      status: 'received',
      receivedAt: new Date(),
      signedDate: new Date(),
      documentUrl: body.documentUrl || found.documentUrl,
      notes: body.notes || found.notes,
      updatedAt: new Date(),
    } as any)
    .where(eq(lienWaiver.id, waiverId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: found.projectId,
    entityType: 'lien_waiver',
    entityId: waiverId,
    action: 'signed',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'subcontractor',
    summary: `signed a ${found.waiverType.replace(/_/g, ' ')} lien waiver for $${Number(found.amountTotal || 0).toLocaleString()}`,
  })

  return c.json({ success: true, lienWaiver: updated })
})

// --- ARCHITECT / CONSULTANT: Submittals to review ---
app.get('/p/:token/submittals', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  // Architects see submittals for all projects in this company (scoped by companyId).
  // In a future iteration we can narrow by architect↔project assignment.
  const submittals = await db
    .select({
      id: submittal.id,
      number: submittal.number,
      title: submittal.title,
      description: submittal.description,
      status: submittal.status,
      specSection: submittal.specSection,
      dueDate: submittal.dueDate,
      submittedDate: submittal.submittedDate,
      approvedDate: submittal.approvedDate,
      approvedBy: submittal.approvedBy,
      notes: submittal.notes,
      createdAt: submittal.createdAt,
      projectId: submittal.projectId,
      projectName: project.name,
      projectNumber: project.number,
    })
    .from(submittal)
    .leftJoin(project, eq(submittal.projectId, project.id))
    .where(eq(submittal.companyId, portalContact.companyId))
    .orderBy(desc(submittal.createdAt))

  return c.json(submittals)
})

app.post('/p/:token/submittals/:submittalId/approve', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const submittalId = c.req.param('submittalId')
  const body = await c.req.json().catch(() => ({}))

  const [found] = await db
    .select()
    .from(submittal)
    .where(and(eq(submittal.id, submittalId), eq(submittal.companyId, portalContact.companyId)))
    .limit(1)

  if (!found) {
    return c.json({ error: 'Submittal not found' }, 404)
  }

  const [updated] = await db
    .update(submittal)
    .set({
      status: 'approved',
      approvedDate: new Date(),
      approvedBy: body.signedBy || portalContact.name,
      notes: body.notes || found.notes,
      updatedAt: new Date(),
    })
    .where(eq(submittal.id, submittalId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: found.projectId,
    entityType: 'submittal',
    entityId: submittalId,
    action: 'approved',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'architect',
    summary: `approved submittal ${found.number} "${found.title}"`,
  })

  return c.json({ success: true, submittal: updated })
})

app.post('/p/:token/submittals/:submittalId/revise', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const submittalId = c.req.param('submittalId')
  const { reason } = await c.req.json().catch(() => ({}))

  const [found] = await db
    .select()
    .from(submittal)
    .where(and(eq(submittal.id, submittalId), eq(submittal.companyId, portalContact.companyId)))
    .limit(1)

  if (!found) {
    return c.json({ error: 'Submittal not found' }, 404)
  }

  const existingNotes = found.notes ? `${found.notes}\n\n` : ''
  const revisionNote = `[Revision requested by ${portalContact.name} on ${new Date().toLocaleDateString()}] ${reason || ''}`

  const [updated] = await db
    .update(submittal)
    .set({
      status: 'revise',
      notes: existingNotes + revisionNote,
      updatedAt: new Date(),
    })
    .where(eq(submittal.id, submittalId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: found.projectId,
    entityType: 'submittal',
    entityId: submittalId,
    action: 'revision_requested',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'architect',
    summary: `requested revision on submittal ${found.number} "${found.title}"`,
    details: { reason: reason || null },
  })

  return c.json({ success: true, submittal: updated })
})

// --- ARCHITECT: RFIs assigned to this contact (by name match) ---
app.get('/p/:token/rfis-assigned', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const rfis = await db
    .select({
      id: rfi.id,
      number: rfi.number,
      subject: rfi.subject,
      question: rfi.question,
      status: rfi.status,
      priority: rfi.priority,
      assignedTo: rfi.assignedTo,
      dueDate: rfi.dueDate,
      response: rfi.response,
      respondedAt: rfi.respondedAt,
      createdAt: rfi.createdAt,
      projectId: rfi.projectId,
      projectName: project.name,
      projectNumber: project.number,
    })
    .from(rfi)
    .leftJoin(project, eq(rfi.projectId, project.id))
    .where(
      and(
        eq(rfi.companyId, portalContact.companyId),
        eq(rfi.assignedTo, portalContact.name)
      )
    )
    .orderBy(desc(rfi.createdAt))

  return c.json(rfis)
})

app.post('/p/:token/rfis-assigned/:rfiId/respond', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const rfiId = c.req.param('rfiId')
  const { response } = await c.req.json().catch(() => ({}))

  if (!response || !String(response).trim()) {
    return c.json({ error: 'Response is required' }, 400)
  }

  const [found] = await db
    .select()
    .from(rfi)
    .where(
      and(
        eq(rfi.id, rfiId),
        eq(rfi.companyId, portalContact.companyId),
        eq(rfi.assignedTo, portalContact.name)
      )
    )
    .limit(1)

  if (!found) {
    return c.json({ error: 'RFI not found' }, 404)
  }

  const [updated] = await db
    .update(rfi)
    .set({
      status: 'answered',
      response: String(response).trim(),
      respondedAt: new Date(),
      respondedBy: portalContact.name,
      updatedAt: new Date(),
    })
    .where(eq(rfi.id, rfiId))
    .returning()

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId: found.projectId,
    entityType: 'rfi',
    entityId: rfiId,
    action: 'responded',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'architect',
    summary: `responded to RFI ${found.number} "${found.subject}"`,
  })

  return c.json({ success: true, rfi: updated })
})

// --- DOCUMENTS: Role-scoped shared documents ---
// Clients see all company-wide documents attached to their projects.
// Subs/architects see documents explicitly shared with them via document_share.
app.get('/p/:token/shared-documents', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact

  const shared = await db
    .select({
      id: document.id,
      name: document.name,
      type: document.type,
      originalName: document.originalName,
      mimeType: document.mimeType,
      size: document.size,
      url: document.url,
      thumbnailUrl: document.thumbnailUrl,
      description: document.description,
      createdAt: document.createdAt,
      projectId: document.projectId,
      projectName: project.name,
      sharedAt: documentShare.sharedAt,
    })
    .from(documentShare)
    .innerJoin(document, eq(documentShare.documentId, document.id))
    .leftJoin(project, eq(document.projectId, project.id))
    .where(
      and(
        eq(documentShare.contactId, portalContact.id),
        eq(document.companyId, portalContact.companyId)
      )
    )
    .orderBy(desc(documentShare.sharedAt))

  return c.json(shared)
})

// =============================================
// PROJECT FILE ROOM
// Scopes: client (project owner) sees all project docs; sub/architect sees
// only docs shared with them for this project. Any portal user with project
// access can upload a document into the room.
// =============================================

async function contactHasProjectAccess(contactId: string, companyId: string, projectId: string): Promise<'owner' | 'collaborator' | null> {
  const [owned] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.contactId, contactId), eq(project.companyId, companyId)))
    .limit(1)
  if (owned) return 'owner'

  const [assignedJob] = await db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.projectId, projectId), eq(job.subcontractorId, contactId), eq(job.companyId, companyId)))
    .limit(1)
  if (assignedJob) return 'collaborator'

  const [shared] = await db
    .select({ id: documentShare.id })
    .from(documentShare)
    .innerJoin(document, eq(documentShare.documentId, document.id))
    .where(
      and(
        eq(documentShare.contactId, contactId),
        eq(document.projectId, projectId),
        eq(document.companyId, companyId)
      )
    )
    .limit(1)
  if (shared) return 'collaborator'

  return null
}

// GET all files in the project file room (role-scoped)
app.get('/p/:token/projects/:projectId/files', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const projectId = c.req.param('projectId')

  const access = await contactHasProjectAccess(portalContact.id, portalContact.companyId, projectId)
  if (!access) {
    return c.json({ error: 'Project not found' }, 404)
  }

  if (access === 'owner') {
    const docs = await db
      .select({
        id: document.id,
        name: document.name,
        type: document.type,
        originalName: document.originalName,
        mimeType: document.mimeType,
        size: document.size,
        url: document.url,
        thumbnailUrl: document.thumbnailUrl,
        description: document.description,
        createdAt: document.createdAt,
        uploadedById: document.uploadedById,
      })
      .from(document)
      .where(and(eq(document.companyId, portalContact.companyId), eq(document.projectId, projectId)))
      .orderBy(desc(document.createdAt))
    return c.json(docs)
  }

  // Collaborator — only shared docs for this project
  const docs = await db
    .select({
      id: document.id,
      name: document.name,
      type: document.type,
      originalName: document.originalName,
      mimeType: document.mimeType,
      size: document.size,
      url: document.url,
      thumbnailUrl: document.thumbnailUrl,
      description: document.description,
      createdAt: document.createdAt,
      uploadedById: document.uploadedById,
      sharedAt: documentShare.sharedAt,
    })
    .from(documentShare)
    .innerJoin(document, eq(documentShare.documentId, document.id))
    .where(
      and(
        eq(documentShare.contactId, portalContact.id),
        eq(document.projectId, projectId),
        eq(document.companyId, portalContact.companyId)
      )
    )
    .orderBy(desc(documentShare.sharedAt))
  return c.json(docs)
})

// POST upload a file to the project file room (multipart/form-data)
app.post('/p/:token/projects/:projectId/files', portalAuth, async (c) => {
  const portal = c.get('portal') as any
  const portalContact = portal.contact
  const projectId = c.req.param('projectId')

  const access = await contactHasProjectAccess(portalContact.id, portalContact.companyId, projectId)
  if (!access) {
    return c.json({ error: 'Project not found' }, 404)
  }

  const body = await c.req.parseBody()
  const file = body['file'] as File | undefined
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'No file uploaded' }, 400)
  }

  let uploaded
  try {
    uploaded = await fileService.saveFile(file, portalContact.companyId, 'documents')
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }

  let filePath = uploaded.path
  let thumbnailPath: string | null = null
  if (uploaded.mimetype?.startsWith('image/')) {
    try {
      filePath = await fileService.processImage(filePath, { width: 2000, height: 2000 })
      thumbnailPath = await fileService.generateThumbnail(filePath, 200)
    } catch {
      // Non-fatal
    }
  }

  const name = (body['name'] as string) || uploaded.originalname
  const description = (body['description'] as string) || null
  const type = (body['type'] as string) || 'general'

  const [doc] = await db
    .insert(document)
    .values({
      companyId: portalContact.companyId,
      name,
      description,
      type,
      filename: path.basename(filePath),
      originalName: uploaded.originalname,
      mimeType: uploaded.mimetype,
      size: uploaded.size,
      path: filePath,
      url: fileService.getFileUrl(filePath, portalContact.companyId),
      thumbnailUrl: thumbnailPath ? fileService.getFileUrl(thumbnailPath, portalContact.companyId) : null,
      projectId,
      contactId: portalContact.id,
      uploadedById: null,
    } as any)
    .returning()

  // Auto-share back to the uploader (so they can see their own file under collaborator view)
  if (access === 'collaborator') {
    try {
      await db.insert(documentShare).values({
        documentId: doc.id,
        contactId: portalContact.id,
      } as any)
    } catch {
      // Ignore unique conflict
    }
  }

  notifyCollaboratorAction({
    companyId: portalContact.companyId,
    projectId,
    entityType: 'document',
    entityId: doc.id,
    action: 'uploaded',
    actorName: portalContact.name,
    actorRole: portalContact.type || 'collaborator',
    summary: `uploaded "${name}" to the project file room`,
  })

  return c.json(doc, 201)
})

export default app
