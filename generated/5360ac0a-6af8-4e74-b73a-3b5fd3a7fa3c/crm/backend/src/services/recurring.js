/**
 * Recurring Invoice Service
 * 
 * Manages recurring invoice templates and generates invoices on schedule.
 */

import { PrismaClient } from '@prisma/client';
import emailService from './email.js';

const prisma = new PrismaClient();

/**
 * Frequency options
 */
export const FREQUENCIES = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  SEMIANNUAL: 'semiannual',
  ANNUAL: 'annual',
};

/**
 * Calculate next invoice date based on frequency
 */
export function calculateNextDate(fromDate, frequency) {
  const date = new Date(fromDate);
  
  switch (frequency) {
    case FREQUENCIES.WEEKLY:
      date.setDate(date.getDate() + 7);
      break;
    case FREQUENCIES.BIWEEKLY:
      date.setDate(date.getDate() + 14);
      break;
    case FREQUENCIES.MONTHLY:
      date.setMonth(date.getMonth() + 1);
      break;
    case FREQUENCIES.QUARTERLY:
      date.setMonth(date.getMonth() + 3);
      break;
    case FREQUENCIES.SEMIANNUAL:
      date.setMonth(date.getMonth() + 6);
      break;
    case FREQUENCIES.ANNUAL:
      date.setFullYear(date.getFullYear() + 1);
      break;
    default:
      date.setMonth(date.getMonth() + 1);
  }
  
  return date;
}

/**
 * Calculate due date based on terms
 */
function calculateDueDate(invoiceDate, terms) {
  const date = new Date(invoiceDate);
  const days = parseInt(terms) || 30;
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Generate next invoice number
 */
async function generateInvoiceNumber(companyId) {
  const lastInvoice = await prisma.invoice.findFirst({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });

  if (!lastInvoice) {
    return 'INV-00001';
  }

  const match = lastInvoice.number.match(/(\d+)$/);
  if (match) {
    const num = parseInt(match[1]) + 1;
    const prefix = lastInvoice.number.replace(/\d+$/, '');
    return `${prefix}${String(num).padStart(5, '0')}`;
  }

  return `INV-${Date.now()}`;
}

/**
 * Create a recurring invoice template
 */
export async function createRecurringInvoice(data, companyId) {
  const {
    contactId,
    projectId,
    frequency,
    startDate,
    endDate,
    terms,
    lineItems,
    notes,
    autoSend,
  } = data;

  // Calculate totals
  let subtotal = 0;
  const processedItems = lineItems.map((item, index) => {
    const total = (item.quantity || 1) * (item.unitPrice || 0);
    subtotal += total;
    return {
      ...item,
      sortOrder: index,
      total,
    };
  });

  const taxRate = data.taxRate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const discount = data.discount || 0;
  const total = subtotal + taxAmount - discount;

  const recurring = await prisma.recurringInvoice.create({
    data: {
      companyId,
      contactId,
      projectId: projectId || null,
      frequency,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      nextRunDate: new Date(startDate),
      terms: terms || '30',
      subtotal,
      taxRate,
      taxAmount,
      discount,
      total,
      notes,
      autoSend: autoSend || false,
      status: 'active',
      lineItems: {
        create: processedItems.map(item => ({
          description: item.description,
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          total: item.total,
          sortOrder: item.sortOrder,
        })),
      },
    },
    include: {
      lineItems: true,
      contact: true,
    },
  });

  return recurring;
}

/**
 * Generate invoice from recurring template
 */
export async function generateInvoiceFromRecurring(recurringId) {
  const recurring = await prisma.recurringInvoice.findUnique({
    where: { id: recurringId },
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' } },
      contact: true,
      project: true,
      company: true,
    },
  });

  if (!recurring) {
    throw new Error('Recurring invoice not found');
  }

  if (recurring.status !== 'active') {
    throw new Error('Recurring invoice is not active');
  }

  // Generate invoice number
  const number = await generateInvoiceNumber(recurring.companyId);
  
  // Calculate dates
  const invoiceDate = new Date();
  const dueDate = calculateDueDate(invoiceDate, recurring.terms);

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      companyId: recurring.companyId,
      contactId: recurring.contactId,
      projectId: recurring.projectId,
      number,
      status: 'draft',
      issueDate: invoiceDate,
      dueDate,
      terms: recurring.terms,
      subtotal: recurring.subtotal,
      taxRate: recurring.taxRate,
      taxAmount: recurring.taxAmount,
      discount: recurring.discount,
      total: recurring.total,
      balance: recurring.total,
      amountPaid: 0,
      notes: recurring.notes,
      recurringInvoiceId: recurring.id,
      lineItems: {
        create: recurring.lineItems.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          sortOrder: item.sortOrder,
        })),
      },
    },
    include: {
      lineItems: true,
      contact: true,
    },
  });

  // Update recurring invoice
  const nextRunDate = calculateNextDate(recurring.nextRunDate, recurring.frequency);
  
  // Check if we've reached end date
  let newStatus = recurring.status;
  if (recurring.endDate && nextRunDate > recurring.endDate) {
    newStatus = 'completed';
  }

  await prisma.recurringInvoice.update({
    where: { id: recurringId },
    data: {
      nextRunDate,
      lastRunDate: invoiceDate,
      invoiceCount: { increment: 1 },
      status: newStatus,
    },
  });

  // Auto-send if enabled
  if (recurring.autoSend && recurring.contact?.email) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'sent', sentAt: new Date() },
    });

    try {
      await emailService.sendInvoice(recurring.contact.email, {
        invoiceNumber: invoice.number,
        contactName: recurring.contact.name,
        total: invoice.total,
        balance: invoice.balance,
        dueDate: dueDate.toLocaleDateString(),
        companyName: recurring.company.name,
        companyEmail: recurring.company.email,
      });
    } catch (error) {
      console.error('Failed to send recurring invoice email:', error);
    }
  }

  return invoice;
}

/**
 * Process all due recurring invoices
 * Run this via cron job daily
 */
export async function processRecurringInvoices() {
  const now = new Date();
  
  // Find all active recurring invoices that are due
  const dueRecurring = await prisma.recurringInvoice.findMany({
    where: {
      status: 'active',
      nextRunDate: { lte: now },
    },
  });

  const results = [];

  for (const recurring of dueRecurring) {
    try {
      const invoice = await generateInvoiceFromRecurring(recurring.id);
      results.push({
        recurringId: recurring.id,
        success: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
      });
    } catch (error) {
      results.push({
        recurringId: recurring.id,
        success: false,
        error: error.message,
      });
    }
  }

  return {
    processed: results.length,
    successful: results.filter(r => r.success).length,
    results,
  };
}

/**
 * Get recurring invoices
 */
export async function getRecurringInvoices(companyId, { status, contactId, page = 1, limit = 25 }) {
  const where = { companyId };
  if (status) where.status = status;
  if (contactId) where.contactId = contactId;

  const [data, total] = await Promise.all([
    prisma.recurringInvoice.findMany({
      where,
      include: {
        contact: { select: { name: true, email: true } },
        project: { select: { name: true, number: true } },
        _count: { select: { generatedInvoices: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.recurringInvoice.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single recurring invoice
 */
export async function getRecurringInvoice(id, companyId) {
  return prisma.recurringInvoice.findFirst({
    where: { id, companyId },
    include: {
      contact: true,
      project: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      generatedInvoices: {
        select: { id: true, number: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
}

/**
 * Update recurring invoice
 */
export async function updateRecurringInvoice(id, companyId, data) {
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, companyId },
  });

  if (!existing) return null;

  // Recalculate totals if line items changed
  let updateData = { ...data };
  
  if (data.lineItems) {
    // Delete existing line items and recreate
    await prisma.recurringInvoiceLineItem.deleteMany({
      where: { recurringInvoiceId: id },
    });

    let subtotal = 0;
    const processedItems = data.lineItems.map((item, index) => {
      const total = (item.quantity || 1) * (item.unitPrice || 0);
      subtotal += total;
      return {
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        total,
        sortOrder: index,
        recurringInvoiceId: id,
      };
    });

    await prisma.recurringInvoiceLineItem.createMany({
      data: processedItems,
    });

    const taxRate = data.taxRate ?? existing.taxRate;
    const taxAmount = subtotal * (taxRate / 100);
    const discount = data.discount ?? existing.discount;

    updateData = {
      ...updateData,
      subtotal,
      taxRate,
      taxAmount,
      discount,
      total: subtotal + taxAmount - discount,
    };
    delete updateData.lineItems;
  }

  return prisma.recurringInvoice.update({
    where: { id },
    data: updateData,
    include: {
      contact: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

/**
 * Pause recurring invoice
 */
export async function pauseRecurringInvoice(id, companyId) {
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, companyId },
  });

  if (!existing) return null;

  return prisma.recurringInvoice.update({
    where: { id },
    data: { status: 'paused' },
  });
}

/**
 * Resume recurring invoice
 */
export async function resumeRecurringInvoice(id, companyId) {
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, companyId },
  });

  if (!existing) return null;

  // Calculate next run date if it's in the past
  let nextRunDate = existing.nextRunDate;
  const now = new Date();
  
  while (nextRunDate < now) {
    nextRunDate = calculateNextDate(nextRunDate, existing.frequency);
  }

  return prisma.recurringInvoice.update({
    where: { id },
    data: { 
      status: 'active',
      nextRunDate,
    },
  });
}

/**
 * Cancel recurring invoice
 */
export async function cancelRecurringInvoice(id, companyId) {
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, companyId },
  });

  if (!existing) return null;

  return prisma.recurringInvoice.update({
    where: { id },
    data: { status: 'cancelled' },
  });
}

/**
 * Delete recurring invoice
 */
export async function deleteRecurringInvoice(id, companyId) {
  const existing = await prisma.recurringInvoice.findFirst({
    where: { id, companyId },
  });

  if (!existing) return false;

  // Delete line items first
  await prisma.recurringInvoiceLineItem.deleteMany({
    where: { recurringInvoiceId: id },
  });

  await prisma.recurringInvoice.delete({
    where: { id },
  });

  return true;
}

export default {
  FREQUENCIES,
  calculateNextDate,
  createRecurringInvoice,
  generateInvoiceFromRecurring,
  processRecurringInvoices,
  getRecurringInvoices,
  getRecurringInvoice,
  updateRecurringInvoice,
  pauseRecurringInvoice,
  resumeRecurringInvoice,
  cancelRecurringInvoice,
  deleteRecurringInvoice,
};
