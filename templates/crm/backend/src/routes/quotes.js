import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import { emitToCompany, EVENTS } from '../services/socket.js';

const router = Router();
router.use(authenticate);

const lineItemSchema = z.object({ description: z.string().min(1), quantity: z.number().default(1), unitPrice: z.number().default(0) });
const schema = z.object({
  name: z.string().min(1),
  contactId: z.string().optional().transform(v => v === '' ? undefined : v),
  projectId: z.string().optional().transform(v => v === '' ? undefined : v),
  expiryDate: z.string().optional(),
  taxRate: z.number().default(0),
  discount: z.number().default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
});

const calcTotals = (items, taxRate, discount) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxAmount = subtotal * (taxRate / 100);
  return { subtotal, taxAmount, total: subtotal + taxAmount - discount };
};

router.get('/', async (req, res, next) => {
  try {
    const { status, contactId, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId };
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;
    const [data, total] = await Promise.all([
      prisma.quote.findMany({ where, include: { contact: { select: { id: true, name: true } }, lineItems: true }, orderBy: { createdAt: 'desc' }, skip: (+page - 1) * +limit, take: +limit }),
      prisma.quote.count({ where }),
    ]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) } });
  } catch (error) { next(error); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const quotes = await prisma.quote.findMany({ where: { companyId: req.user.companyId }, select: { status: true, total: true } });
    const stats = { total: quotes.length, draft: 0, sent: 0, approved: 0, rejected: 0, totalValue: 0, approvedValue: 0 };
    quotes.forEach(q => { stats[q.status] = (stats[q.status] || 0) + 1; stats.totalValue += Number(q.total); if (q.status === 'approved') stats.approvedValue += Number(q.total); });
    res.json(stats);
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const quote = await prisma.quote.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { contact: true, project: true, lineItems: { orderBy: { sortOrder: 'asc' } } } });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const { lineItems, ...quoteData } = data;
    const totals = calcTotals(lineItems, data.taxRate, data.discount);
    const count = await prisma.quote.count({ where: { companyId: req.user.companyId } });
    const quote = await prisma.quote.create({
      data: { ...quoteData, ...totals, number: `QTE-${String(count + 1).padStart(5, '0')}`, expiryDate: data.expiryDate ? new Date(data.expiryDate) : null, companyId: req.user.companyId, lineItems: { create: lineItems.map((item, i) => ({ ...item, total: item.quantity * item.unitPrice, sortOrder: i })) } },
      include: { lineItems: true },
    });
    emitToCompany(req.user.companyId, EVENTS.QUOTE_CREATED, quote);
    res.status(201).json(quote);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = schema.partial().parse(req.body);
    const existing = await prisma.quote.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    const { lineItems, ...quoteData } = data;
    let totals = {};
    if (lineItems) {
      await prisma.quoteLineItem.deleteMany({ where: { quoteId: req.params.id } });
      totals = calcTotals(lineItems, data.taxRate ?? Number(existing.taxRate), data.discount ?? Number(existing.discount));
    }
    const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { ...quoteData, ...totals, expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined, lineItems: lineItems ? { create: lineItems.map((item, i) => ({ ...item, total: item.quantity * item.unitPrice, sortOrder: i })) } : undefined }, include: { lineItems: true } });
    emitToCompany(req.user.companyId, EVENTS.QUOTE_UPDATED, quote);
    res.json(quote);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.quote.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Quote not found' });
    await prisma.quote.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post('/:id/send', async (req, res, next) => {
  try {
    const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status: 'sent', sentAt: new Date() } });
    emitToCompany(req.user.companyId, EVENTS.QUOTE_SENT, { id: quote.id, number: quote.number });
    res.json(quote);
  } catch (error) { next(error); }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status: 'approved', approvedAt: new Date() } });
    emitToCompany(req.user.companyId, EVENTS.QUOTE_APPROVED, { id: quote.id, number: quote.number, total: quote.total });
    res.json(quote);
  } catch (error) { next(error); }
});

router.post('/:id/reject', async (req, res, next) => {
  try { const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status: 'rejected' } }); res.json(quote); } catch (error) { next(error); }
});

router.post('/:id/convert-to-invoice', async (req, res, next) => {
  try {
    const quote = await prisma.quote.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { lineItems: true } });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const count = await prisma.invoice.count({ where: { companyId: req.user.companyId } });
    const invoice = await prisma.invoice.create({
      data: {
        number: `INV-${String(count + 1).padStart(5, '0')}`,
        contactId: quote.contactId,
        projectId: quote.projectId,
        quoteId: quote.id,
        subtotal: quote.subtotal,
        taxRate: quote.taxRate,
        taxAmount: quote.taxAmount,
        discount: quote.discount,
        total: quote.total,
        balance: quote.total,
        notes: quote.notes,
        terms: quote.terms,
        companyId: req.user.companyId,
        lineItems: { create: quote.lineItems.map(item => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, total: item.total, sortOrder: item.sortOrder })) },
      },
      include: { lineItems: true },
    });
    emitToCompany(req.user.companyId, EVENTS.INVOICE_CREATED, invoice);
    res.status(201).json(invoice);
  } catch (error) { next(error); }
});

// PDF download
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const { generateQuotePDF } = await import('../services/pdf.js');
    const quote = await prisma.quote.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: { contact: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId } });
    const pdfBuffer = await generateQuotePDF(quote, company);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote-${quote.number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) { next(error); }
});

export default router;
