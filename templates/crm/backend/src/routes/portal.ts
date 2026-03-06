/**
 * Customer Portal Routes
 *
 * Allows contacts to view their quotes, invoices, and project status
 * via a secure token link (no password required)
 */

import { Hono } from 'hono'
import crypto from 'crypto'
import { eq, and, inArray, count, sum, sql, desc, asc } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { contact, company, project, quote, quoteLineItem, invoice, invoiceLineItem, payment, changeOrder, job } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import emailService from '../services/email.ts'

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
    } as any)
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
    } as any)
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
    } as any)
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
      portalEnabled: sql`${contact}.portal_enabled`.as('portalEnabled'),
      portalToken: sql`${contact}.portal_token`.as('portalToken'),
      portalTokenExp: sql`${contact}.portal_token_exp`.as('portalTokenExp'),
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
        sql`${contact}.portal_token = ${token}`,
        sql`${contact}.portal_enabled = true`
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
    .set({ lastPortalVisit: new Date(), updatedAt: new Date() } as any)
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

export default app
