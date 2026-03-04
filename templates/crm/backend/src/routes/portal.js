/**
 * Customer Portal Routes
 * 
 * Allows contacts to view their quotes, invoices, and project status
 * via a secure token link (no password required)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import emailService from '../services/email.js';

const router = Router();

// =============================================
// ADMIN ROUTES (for managing portal access)
// =============================================

// Enable portal for a contact
router.post('/contacts/:contactId/enable', authenticate, requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const { contactId } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, companyId: req.user.companyId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    if (!contact.email) {
      return res.status(400).json({ error: 'Contact must have an email to enable portal access' });
    }
    
    // Generate token (valid for 90 days)
    const portalToken = crypto.randomBytes(32).toString('hex');
    const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    
    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: {
        portalEnabled: true,
        portalToken,
        portalTokenExp,
      },
    });
    
    const portalUrl = `${process.env.FRONTEND_URL}/portal/${portalToken}`;
    
    res.json({
      success: true,
      portalUrl,
      expiresAt: portalTokenExp,
    });
  } catch (error) {
    next(error);
  }
});

// Disable portal for a contact
router.post('/contacts/:contactId/disable', authenticate, requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const { contactId } = req.params;
    
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        portalEnabled: false,
        portalToken: null,
        portalTokenExp: null,
      },
    });
    
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Regenerate portal token
router.post('/contacts/:contactId/regenerate', authenticate, requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const { contactId } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, companyId: req.user.companyId },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    const portalToken = crypto.randomBytes(32).toString('hex');
    const portalTokenExp = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    
    await prisma.contact.update({
      where: { id: contactId },
      data: { portalToken, portalTokenExp },
    });
    
    const portalUrl = `${process.env.FRONTEND_URL}/portal/${portalToken}`;
    
    res.json({
      success: true,
      portalUrl,
      expiresAt: portalTokenExp,
    });
  } catch (error) {
    next(error);
  }
});

// Send portal link via email
router.post('/contacts/:contactId/send-link', authenticate, requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const { contactId } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, companyId: req.user.companyId },
      include: { companyRef: true },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    if (!contact.email) {
      return res.status(400).json({ error: 'Contact has no email address' });
    }
    
    if (!contact.portalEnabled || !contact.portalToken) {
      return res.status(400).json({ error: 'Portal access not enabled for this contact' });
    }
    
    const portalUrl = `${process.env.FRONTEND_URL}/portal/${contact.portalToken}`;
    
    await emailService.send(contact.email, 'portalInvite', {
      contactName: contact.name,
      companyName: contact.companyRef.name,
      portalUrl,
    });
    
    res.json({ success: true, sentTo: contact.email });
  } catch (error) {
    next(error);
  }
});

// Get portal status for a contact
router.get('/contacts/:contactId/status', authenticate, requirePermission('contacts:read'), async (req, res, next) => {
  try {
    const { contactId } = req.params;
    
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, companyId: req.user.companyId },
      select: {
        portalEnabled: true,
        portalToken: true,
        portalTokenExp: true,
        lastPortalVisit: true,
      },
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json({
      enabled: contact.portalEnabled,
      hasToken: !!contact.portalToken,
      expiresAt: contact.portalTokenExp,
      lastVisit: contact.lastPortalVisit,
      portalUrl: contact.portalToken ? `${process.env.FRONTEND_URL}/portal/${contact.portalToken}` : null,
    });
  } catch (error) {
    next(error);
  }
});

// =============================================
// PUBLIC PORTAL ROUTES (token-based auth)
// =============================================

// Middleware to authenticate portal token
async function portalAuth(req, res, next) {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(401).json({ error: 'Portal token required' });
    }
    
    const contact = await prisma.contact.findFirst({
      where: {
        portalToken: token,
        portalEnabled: true,
      },
      include: {
        companyRef: {
          select: { id: true, name: true, logo: true, primaryColor: true, email: true, phone: true },
        },
      },
    });
    
    if (!contact) {
      return res.status(401).json({ error: 'Invalid or expired portal link' });
    }
    
    if (contact.portalTokenExp && new Date() > contact.portalTokenExp) {
      return res.status(401).json({ error: 'Portal link has expired. Please contact the company for a new link.' });
    }
    
    // Update last visit
    await prisma.contact.update({
      where: { id: contact.id },
      data: { lastPortalVisit: new Date() },
    });
    
    req.portal = {
      contact,
      company: contact.companyRef,
      companyId: contact.companyId,
    };
    
    next();
  } catch (error) {
    next(error);
  }
}

// Get portal home (contact info + summary)
router.get('/p/:token', portalAuth, async (req, res, next) => {
  try {
    const { contact, company } = req.portal;
    
    // Get counts
    const [projectCount, quoteCount, invoiceCount, openInvoiceBalance] = await Promise.all([
      prisma.project.count({ where: { contactId: contact.id } }),
      prisma.quote.count({ where: { contactId: contact.id, status: { in: ['sent', 'viewed'] } } }),
      prisma.invoice.count({ where: { contactId: contact.id } }),
      prisma.invoice.aggregate({
        where: { contactId: contact.id, status: { in: ['sent', 'partial', 'overdue'] } },
        _sum: { balance: true },
      }),
    ]);
    
    res.json({
      contact: {
        name: contact.name,
        email: contact.email,
      },
      company: {
        name: company.name,
        logo: company.logo,
        primaryColor: company.primaryColor,
        email: company.email,
        phone: company.phone,
      },
      summary: {
        activeProjects: projectCount,
        pendingQuotes: quoteCount,
        totalInvoices: invoiceCount,
        outstandingBalance: Number(openInvoiceBalance._sum.balance || 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get projects
router.get('/p/:token/projects', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    
    const projects = await prisma.project.findMany({
      where: { contactId: contact.id },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        progress: true,
        startDate: true,
        endDate: true,
        address: true,
        city: true,
        state: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(projects);
  } catch (error) {
    next(error);
  }
});

// Get single project
router.get('/p/:token/projects/:projectId', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    const { projectId } = req.params;
    
    const project = await prisma.project.findFirst({
      where: { id: projectId, contactId: contact.id },
      include: {
        jobs: {
          select: { id: true, number: true, title: true, status: true, scheduledDate: true },
          orderBy: { scheduledDate: 'desc' },
          take: 10,
        },
      },
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    res.json(project);
  } catch (error) {
    next(error);
  }
});

// Get quotes
router.get('/p/:token/quotes', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    
    const quotes = await prisma.quote.findMany({
      where: { contactId: contact.id },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        total: true,
        validUntil: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(quotes);
  } catch (error) {
    next(error);
  }
});

// Get single quote with line items
router.get('/p/:token/quotes/:quoteId', portalAuth, async (req, res, next) => {
  try {
    const { contact, company } = req.portal;
    const { quoteId } = req.params;
    
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, contactId: contact.id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        project: { select: { name: true, number: true } },
      },
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Mark as viewed if sent
    if (quote.status === 'sent') {
      await prisma.quote.update({
        where: { id: quoteId },
        data: { status: 'viewed' },
      });
    }
    
    res.json({
      ...quote,
      company: {
        name: company.name,
        email: company.email,
        phone: company.phone,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Approve quote
router.post('/p/:token/quotes/:quoteId/approve', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    const { quoteId } = req.params;
    const { signature, signedBy, notes } = req.body;
    
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, contactId: contact.id },
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    if (quote.status === 'approved') {
      return res.status(400).json({ error: 'Quote already approved' });
    }
    
    const updated = await prisma.quote.update({
      where: { id: quoteId },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: signedBy || contact.name,
        signature: signature || null,
        signedBy: signedBy || contact.name,
        signedAt: signature ? new Date() : null,
        approvalNotes: notes || null,
        approvalIp: req.ip || req.headers?.['x-forwarded-for'] || null,
      },
    });
    
    res.json({ success: true, quote: updated });
  } catch (error) {
    next(error);
  }
});

// Reject quote
router.post('/p/:token/quotes/:quoteId/reject', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    const { quoteId } = req.params;
    const { reason } = req.body;
    
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, contactId: contact.id },
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    const updated = await prisma.quote.update({
      where: { id: quoteId },
      data: {
        status: 'rejected',
        rejectionReason: reason || null,
      },
    });
    
    res.json({ success: true, quote: updated });
  } catch (error) {
    next(error);
  }
});

// Get invoices
router.get('/p/:token/invoices', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    
    const invoices = await prisma.invoice.findMany({
      where: { contactId: contact.id },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        balance: true,
        dueDate: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(invoices);
  } catch (error) {
    next(error);
  }
});

// Get single invoice with line items and payments
router.get('/p/:token/invoices/:invoiceId', portalAuth, async (req, res, next) => {
  try {
    const { contact, company } = req.portal;
    const { invoiceId } = req.params;
    
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, contactId: contact.id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        project: { select: { name: true, number: true } },
      },
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    res.json({
      ...invoice,
      company: {
        name: company.name,
        email: company.email,
        phone: company.phone,
        address: company.address,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Download invoice PDF
router.get('/p/:token/invoices/:invoiceId/pdf', portalAuth, async (req, res, next) => {
  try {
    const { contact, company } = req.portal;
    const { invoiceId } = req.params;
    
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, contactId: contact.id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    const { generateInvoicePDF } = await import('../services/pdf.js');
    const pdfBuffer = await generateInvoicePDF({ ...invoice, contact }, company);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// Download quote PDF
router.get('/p/:token/quotes/:quoteId/pdf', portalAuth, async (req, res, next) => {
  try {
    const { contact, company } = req.portal;
    const { quoteId } = req.params;
    
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, contactId: contact.id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    const { generateQuotePDF } = await import('../services/pdf.js');
    const pdfBuffer = await generateQuotePDF({ ...quote, contact }, company);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote-${quote.number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// =============================================
// CHANGE ORDERS
// =============================================

// Get change orders for contact's projects
router.get('/p/:token/change-orders', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    
    // Get contact's project IDs
    const projects = await prisma.project.findMany({
      where: { contactId: contact.id },
      select: { id: true },
    });
    const projectIds = projects.map(p => p.id);
    
    const changeOrders = await prisma.changeOrder.findMany({
      where: { 
        projectId: { in: projectIds },
        status: { in: ['pending', 'approved', 'rejected'] },
      },
      include: {
        project: { select: { name: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    res.json(changeOrders);
  } catch (error) {
    next(error);
  }
});

// Get single change order
router.get('/p/:token/change-orders/:changeOrderId', portalAuth, async (req, res, next) => {
  try {
    const { contact, company } = req.portal;
    const { changeOrderId } = req.params;
    
    // Get contact's project IDs
    const projects = await prisma.project.findMany({
      where: { contactId: contact.id },
      select: { id: true },
    });
    const projectIds = projects.map(p => p.id);
    
    const changeOrder = await prisma.changeOrder.findFirst({
      where: { 
        id: changeOrderId,
        projectId: { in: projectIds },
      },
      include: {
        project: { select: { name: true, number: true } },
      },
    });
    
    if (!changeOrder) {
      return res.status(404).json({ error: 'Change order not found' });
    }
    
    res.json({
      ...changeOrder,
      company: {
        name: company.name,
        email: company.email,
        phone: company.phone,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Approve change order with signature
router.post('/p/:token/change-orders/:changeOrderId/approve', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    const { changeOrderId } = req.params;
    const { signature, signedBy, notes } = req.body;
    
    // Get contact's project IDs
    const projects = await prisma.project.findMany({
      where: { contactId: contact.id },
      select: { id: true },
    });
    const projectIds = projects.map(p => p.id);
    
    const changeOrder = await prisma.changeOrder.findFirst({
      where: { 
        id: changeOrderId,
        projectId: { in: projectIds },
      },
    });
    
    if (!changeOrder) {
      return res.status(404).json({ error: 'Change order not found' });
    }
    
    if (changeOrder.status === 'approved') {
      return res.status(400).json({ error: 'Change order already approved' });
    }
    
    const updated = await prisma.changeOrder.update({
      where: { id: changeOrderId },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: signedBy || contact.name,
        signature: signature || null,
        signedBy: signedBy || contact.name,
        signedAt: signature ? new Date() : null,
        approvalNotes: notes || null,
        approvalIp: req.ip || req.headers?.['x-forwarded-for'] || null,
      },
    });
    
    res.json({ success: true, changeOrder: updated });
  } catch (error) {
    next(error);
  }
});

// Reject change order
router.post('/p/:token/change-orders/:changeOrderId/reject', portalAuth, async (req, res, next) => {
  try {
    const { contact } = req.portal;
    const { changeOrderId } = req.params;
    const { reason } = req.body;
    
    // Get contact's project IDs
    const projects = await prisma.project.findMany({
      where: { contactId: contact.id },
      select: { id: true },
    });
    const projectIds = projects.map(p => p.id);
    
    const changeOrder = await prisma.changeOrder.findFirst({
      where: { 
        id: changeOrderId,
        projectId: { in: projectIds },
      },
    });
    
    if (!changeOrder) {
      return res.status(404).json({ error: 'Change order not found' });
    }
    
    const updated = await prisma.changeOrder.update({
      where: { id: changeOrderId },
      data: {
        status: 'rejected',
        rejectionReason: reason || null,
        rejectedAt: new Date(),
      },
    });
    
    res.json({ success: true, changeOrder: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
