/**
 * Customer Portal Routes
 *
 * Allows contacts to view their quotes, invoices, and project status
 * via a secure token link (no password required)
 */

import { Hono } from 'hono'
import crypto from 'crypto'
import { eq, and, inArray, count, sum, sql, desc, asc, gte } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, company, project, quote, quoteLineItem, invoice, invoiceLineItem, payment, changeOrder, job, message, portalSession, equipment, serviceAgreement, agreementVisit, formSubmission, user } from '../../db/schema.ts'
import selections from '../services/selections.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import emailService, { send } from '../services/email.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

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
// CUSTOMER PORTAL — PIN-based auth (no password)
// =============================================

function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function generateSessionToken(): string {
  return crypto.randomBytes(48).toString('hex')
}

// Middleware: authenticate customer portal session
async function customerPortalAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) return c.json({ error: 'Portal session required' }, 401)

  const [session] = await db.select({
    id: portalSession.id,
    contactId: portalSession.contactId,
    companyId: portalSession.companyId,
    expiresAt: portalSession.expiresAt,
  }).from(portalSession).where(eq(portalSession.token, token)).limit(1)

  if (!session) return c.json({ error: 'Invalid session' }, 401)
  if (new Date() > new Date(session.expiresAt)) {
    await db.delete(portalSession).where(eq(portalSession.id, session.id))
    return c.json({ error: 'Session expired' }, 401)
  }

  const [cust] = await db.select({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    address: contact.address,
    city: contact.city,
    state: contact.state,
    zip: contact.zip,
    companyId: contact.companyId,
    portalEnabled: contact.portalEnabled,
  }).from(contact).where(eq(contact.id, session.contactId)).limit(1)

  if (!cust || !cust.portalEnabled) return c.json({ error: 'Portal access disabled' }, 403)

  // Update last portal visit
  await db.update(contact).set({ lastPortalVisit: new Date() }).where(eq(contact.id, cust.id))

  const [comp] = await db.select({
    id: company.id,
    name: company.name,
    logo: company.logo,
    primaryColor: company.primaryColor,
    phone: company.phone,
    email: company.email,
  }).from(company).where(eq(company.id, session.companyId)).limit(1)

  c.set('customerPortal', { contact: cust, company: comp })
  await next()
}

// POST /api/portal/request-access — customer enters email, gets PIN
app.post('/request-access', async (c) => {
  const { email } = await c.req.json()
  if (!email) return c.json({ error: 'Email is required' }, 400)

  // Find contact by email (across all companies) with portal enabled
  const [cust] = await db.select({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    companyId: contact.companyId,
    portalEnabled: contact.portalEnabled,
  }).from(contact).where(and(eq(contact.email, email.toLowerCase().trim()), eq(contact.portalEnabled, true))).limit(1)

  // Always return success to prevent email enumeration
  if (!cust) return c.json({ success: true })

  const pin = generatePin()
  const pinExpiry = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  await db.update(contact).set({
    portalToken: pin,
    portalTokenExp: pinExpiry,
    updatedAt: new Date(),
  }).where(eq(contact.id, cust.id))

  // Get company name for the email
  const [comp] = await db.select({ name: company.name }).from(company).where(eq(company.id, cust.companyId)).limit(1)

  // Send PIN via email
  try {
    await send(cust.email!, 'portalInvite', {
      contactName: cust.name,
      companyName: comp?.name || 'Your Service Provider',
      portalUrl: `Your login code is: ${pin}`,
    })
  } catch { /* email not configured — non-blocking */ }

  return c.json({ success: true })
})

// POST /api/portal/login — email + PIN → session token
app.post('/login', async (c) => {
  const { email, pin } = await c.req.json()
  if (!email || !pin) return c.json({ error: 'Email and PIN are required' }, 400)

  const [cust] = await db.select({
    id: contact.id,
    name: contact.name,
    email: contact.email,
    companyId: contact.companyId,
    portalEnabled: contact.portalEnabled,
    portalToken: contact.portalToken,
    portalTokenExp: contact.portalTokenExp,
  }).from(contact).where(and(eq(contact.email, email.toLowerCase().trim()), eq(contact.portalEnabled, true))).limit(1)

  if (!cust || cust.portalToken !== pin) {
    return c.json({ error: 'Invalid email or code' }, 401)
  }

  if (cust.portalTokenExp && new Date() > new Date(cust.portalTokenExp)) {
    return c.json({ error: 'Code has expired. Please request a new one.' }, 401)
  }

  // Create session (valid for 30 days)
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await db.insert(portalSession).values({
    token,
    contactId: cust.id,
    companyId: cust.companyId,
    expiresAt,
  })

  // Clear the PIN
  await db.update(contact).set({
    portalToken: null,
    portalTokenExp: null,
    lastPortalVisit: new Date(),
    updatedAt: new Date(),
  }).where(eq(contact.id, cust.id))

  // Get company info
  const [comp] = await db.select({
    name: company.name,
    logo: company.logo,
    primaryColor: company.primaryColor,
  }).from(company).where(eq(company.id, cust.companyId)).limit(1)

  return c.json({
    token,
    expiresAt,
    contact: { name: cust.name, email: cust.email },
    company: comp,
  })
})

// GET /api/portal/me — customer profile
app.get('/me', customerPortalAuth, async (c) => {
  const { contact: cust, company: comp } = c.get('customerPortal') as any
  return c.json({ contact: cust, company: comp })
})

// GET /api/portal/equipment — customer's equipment
app.get('/equipment', customerPortalAuth, async (c) => {
  const { contact: cust } = c.get('customerPortal') as any

  const eqList = await db.select({
    id: equipment.id,
    name: equipment.name,
    model: equipment.model,
    manufacturer: equipment.manufacturer,
    serialNumber: equipment.serialNumber,
    status: equipment.status,
    location: equipment.location,
    purchaseDate: equipment.purchaseDate,
    warrantyExpiry: equipment.warrantyExpiry,
  }).from(equipment).where(and(eq(equipment.contactId, cust.id), eq(equipment.companyId, cust.companyId))).orderBy(asc(equipment.name))

  // Get last service date per equipment
  const enriched = await Promise.all(eqList.map(async (eqItem) => {
    const [lastJob] = await db.select({
      completedAt: job.completedAt,
    }).from(job).where(and(eq(job.equipmentId, eqItem.id), eq(job.status, 'completed'))).orderBy(desc(job.completedAt)).limit(1)
    return { ...eqItem, lastServiceDate: lastJob?.completedAt || null }
  }))

  return c.json(enriched)
})

// GET /api/portal/equipment/:id/history — service history for one unit
app.get('/equipment/:equipmentId/history', customerPortalAuth, async (c) => {
  const { contact: cust } = c.get('customerPortal') as any
  const equipmentId = c.req.param('equipmentId')

  // Verify equipment belongs to this customer
  const [eqUnit] = await db.select().from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.contactId, cust.id))).limit(1)
  if (!eqUnit) return c.json({ error: 'Equipment not found' }, 404)

  // Get jobs linked to this equipment
  const jobs = await db.select({
    id: job.id,
    title: job.title,
    status: job.status,
    jobType: job.jobType,
    scheduledDate: job.scheduledDate,
    completedAt: job.completedAt,
    notes: job.notes,
    assignedToId: job.assignedToId,
  }).from(job).where(eq(job.equipmentId, equipmentId)).orderBy(desc(job.scheduledDate))

  // Get tech first names
  const techIds = [...new Set(jobs.filter(j => j.assignedToId).map(j => j.assignedToId!))]
  const techs = techIds.length ? await db.select({ id: user.id, firstName: user.firstName }).from(user).where(inArray(user.id, techIds)) : []
  const techMap = Object.fromEntries(techs.map(t => [t.id, t.firstName]))

  // Get checklist submissions per job
  const jobIds = jobs.map(j => j.id)
  const checklists = jobIds.length ? await db.select({
    jobId: formSubmission.jobId,
    values: formSubmission.values,
  }).from(formSubmission).where(inArray(formSubmission.jobId, jobIds)) : []
  const checklistMap: Record<string, any[]> = {}
  for (const cl of checklists) {
    if ((cl.values as any)?.type === 'hvac_inspection_checklist') {
      if (!checklistMap[cl.jobId!]) checklistMap[cl.jobId!] = []
      checklistMap[cl.jobId!].push(cl.values)
    }
  }

  const history = jobs.map(j => ({
    id: j.id,
    title: j.title,
    status: j.status,
    jobType: j.jobType,
    scheduledDate: j.scheduledDate,
    completedAt: j.completedAt,
    notes: j.notes,
    techName: j.assignedToId ? techMap[j.assignedToId] || null : null,
    checklist: checklistMap[j.id] || null,
  }))

  return c.json({ equipment: eqUnit, history })
})

// GET /api/portal/agreements — customer's service agreements
app.get('/agreements', customerPortalAuth, async (c) => {
  const { contact: cust } = c.get('customerPortal') as any

  const agreements = await db.select({
    id: serviceAgreement.id,
    name: serviceAgreement.name,
    status: serviceAgreement.status,
    startDate: serviceAgreement.startDate,
    endDate: serviceAgreement.endDate,
    renewalType: serviceAgreement.renewalType,
    billingFrequency: serviceAgreement.billingFrequency,
    amount: serviceAgreement.amount,
    terms: serviceAgreement.terms,
    notes: serviceAgreement.notes,
  }).from(serviceAgreement).where(eq(serviceAgreement.contactId, cust.id)).orderBy(desc(serviceAgreement.startDate))

  // Get next scheduled visit per agreement
  const enriched = await Promise.all(agreements.map(async (a) => {
    const [nextVisit] = await db.select({
      scheduledDate: agreementVisit.scheduledDate,
    }).from(agreementVisit).where(and(eq(agreementVisit.agreementId, a.id), eq(agreementVisit.status, 'scheduled'))).orderBy(asc(agreementVisit.scheduledDate)).limit(1)
    return { ...a, nextVisitDate: nextVisit?.scheduledDate || null }
  }))

  return c.json(enriched)
})

// GET /api/portal/invoices — customer's invoices
app.get('/invoices', customerPortalAuth, async (c) => {
  const { contact: cust } = c.get('customerPortal') as any

  const invoices = await db.select({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
  }).from(invoice).where(eq(invoice.contactId, cust.id)).orderBy(desc(invoice.issueDate))

  return c.json(invoices)
})

// GET /api/portal/invoices/:id — single invoice detail
app.get('/invoices/:invoiceId', customerPortalAuth, async (c) => {
  const { contact: cust, company: comp } = c.get('customerPortal') as any
  const invoiceId = c.req.param('invoiceId')

  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.contactId, cust.id))).limit(1)
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)

  const lineItems = await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, invoiceId)).orderBy(asc(invoiceLineItem.sortOrder))
  const payments = await db.select().from(payment).where(eq(payment.invoiceId, invoiceId)).orderBy(desc(payment.paidAt))

  return c.json({ ...inv, lineItems, payments, company: comp })
})

// POST /api/portal/invoices/:id/pay — create Stripe payment intent
app.post('/invoices/:invoiceId/pay', customerPortalAuth, async (c) => {
  const { contact: cust } = c.get('customerPortal') as any
  const invoiceId = c.req.param('invoiceId')

  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.contactId, cust.id))).limit(1)
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)

  if (inv.status === 'paid') return c.json({ error: 'Invoice already paid' }, 400)

  try {
    const stripeService = (await import('../services/stripe.ts')).default
    const result = await stripeService.createPaymentIntent(inv, cust)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message || 'Payment processing unavailable' }, 500)
  }
})

// POST /api/portal/service-request — customer submits service request
app.post('/service-request', customerPortalAuth, async (c) => {
  const { contact: cust } = c.get('customerPortal') as any
  const { equipmentId, description, urgency, preferredContact } = await c.req.json()

  if (!description) return c.json({ error: 'Issue description is required' }, 400)

  // Get next job number
  const [lastJob] = await db.select({ number: job.number }).from(job).where(eq(job.companyId, cust.companyId)).orderBy(desc(job.createdAt)).limit(1)
  const lastNum = lastJob ? parseInt(lastJob.number.replace('JOB-', '')) : 0
  const nextNumber = `JOB-${String(lastNum + 1).padStart(5, '0')}`

  // Verify equipment belongs to customer if provided
  let eqName = ''
  if (equipmentId) {
    const [eqRow] = await db.select({ name: equipment.name }).from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.contactId, cust.id))).limit(1)
    if (eqRow) eqName = eqRow.name
  }

  const title = eqName ? `Service Request: ${eqName}` : 'Service Request from Customer Portal'

  const [newJob] = await db.insert(job).values({
    number: nextNumber,
    title,
    description,
    status: 'scheduled',
    priority: urgency === 'urgent' ? 'high' : 'normal',
    jobType: 'repair',
    source: 'customer_portal',
    address: cust.address,
    city: cust.city,
    state: cust.state,
    zip: cust.zip,
    internalNotes: `[${new Date().toISOString()}] Customer portal request\nPreferred contact: ${preferredContact || 'any'}\nUrgency: ${urgency || 'routine'}`,
    companyId: cust.companyId,
    contactId: cust.id,
    equipmentId: equipmentId || null,
  }).returning()

  // Notify contractor via socket
  try {
    emitToCompany(cust.companyId, EVENTS.JOB_CREATED, { id: newJob.id, number: nextNumber, source: 'customer_portal' })
  } catch { /* socket not available — non-blocking */ }

  const responseHours = urgency === 'urgent' ? 4 : 24

  return c.json({
    success: true,
    jobNumber: nextNumber,
    responseHours,
  }, 201)
})

export default app
