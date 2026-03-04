/**
 * Bulk Operations Service
 * 
 * Mass update, delete, and other bulk operations
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// CONTACTS
// ============================================

export async function bulkUpdateContacts(companyId, contactIds, updates) {
  const result = await prisma.contact.updateMany({
    where: {
      id: { in: contactIds },
      companyId,
    },
    data: updates,
  });
  return result.count;
}

export async function bulkDeleteContacts(companyId, contactIds) {
  const result = await prisma.contact.deleteMany({
    where: {
      id: { in: contactIds },
      companyId,
    },
  });
  return result.count;
}

export async function bulkAssignContactTags(companyId, contactIds, tags) {
  // For contacts with a tags field (JSON array)
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, companyId },
    select: { id: true, tags: true },
  });

  let updated = 0;
  for (const contact of contacts) {
    const existingTags = contact.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];
    await prisma.contact.update({
      where: { id: contact.id },
      data: { tags: newTags },
    });
    updated++;
  }
  return updated;
}

// ============================================
// PROJECTS
// ============================================

export async function bulkUpdateProjects(companyId, projectIds, updates) {
  const result = await prisma.project.updateMany({
    where: {
      id: { in: projectIds },
      companyId,
    },
    data: updates,
  });
  return result.count;
}

export async function bulkDeleteProjects(companyId, projectIds) {
  const result = await prisma.project.deleteMany({
    where: {
      id: { in: projectIds },
      companyId,
    },
  });
  return result.count;
}

export async function bulkArchiveProjects(companyId, projectIds) {
  const result = await prisma.project.updateMany({
    where: {
      id: { in: projectIds },
      companyId,
    },
    data: { status: 'archived' },
  });
  return result.count;
}

// ============================================
// JOBS
// ============================================

export async function bulkUpdateJobs(companyId, jobIds, updates) {
  const result = await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
      companyId,
    },
    data: updates,
  });
  return result.count;
}

export async function bulkDeleteJobs(companyId, jobIds) {
  const result = await prisma.job.deleteMany({
    where: {
      id: { in: jobIds },
      companyId,
    },
  });
  return result.count;
}

export async function bulkAssignJobs(companyId, jobIds, assignedToId) {
  const result = await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
      companyId,
    },
    data: { assignedToId },
  });
  return result.count;
}

export async function bulkRescheduleJobs(companyId, jobIds, scheduledDate) {
  const result = await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
      companyId,
    },
    data: { scheduledDate: new Date(scheduledDate) },
  });
  return result.count;
}

export async function bulkUpdateJobStatus(companyId, jobIds, status) {
  const updates = { status };
  if (status === 'completed') {
    updates.completedAt = new Date();
  }

  const result = await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
      companyId,
    },
    data: updates,
  });
  return result.count;
}

// ============================================
// INVOICES
// ============================================

export async function bulkUpdateInvoices(companyId, invoiceIds, updates) {
  const result = await prisma.invoice.updateMany({
    where: {
      id: { in: invoiceIds },
      companyId,
    },
    data: updates,
  });
  return result.count;
}

export async function bulkDeleteInvoices(companyId, invoiceIds) {
  // Only delete draft invoices
  const result = await prisma.invoice.deleteMany({
    where: {
      id: { in: invoiceIds },
      companyId,
      status: 'draft',
    },
  });
  return result.count;
}

export async function bulkSendInvoices(companyId, invoiceIds, emailService) {
  const invoices = await prisma.invoice.findMany({
    where: {
      id: { in: invoiceIds },
      companyId,
      status: 'draft',
    },
    include: { contact: true, company: true },
  });

  let sent = 0;
  for (const invoice of invoices) {
    if (invoice.contact?.email) {
      try {
        await emailService?.sendInvoice?.(invoice);
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'sent', sentAt: new Date() },
        });
        sent++;
      } catch (e) {
        console.error(`Failed to send invoice ${invoice.number}:`, e);
      }
    }
  }
  return sent;
}

export async function bulkMarkInvoicesPaid(companyId, invoiceIds) {
  const invoices = await prisma.invoice.findMany({
    where: {
      id: { in: invoiceIds },
      companyId,
      status: { in: ['sent', 'partial', 'overdue'] },
    },
  });

  let updated = 0;
  for (const invoice of invoices) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'paid',
        amountPaid: invoice.total,
        balance: 0,
        paidAt: new Date(),
      },
    });
    updated++;
  }
  return updated;
}

// ============================================
// QUOTES
// ============================================

export async function bulkUpdateQuotes(companyId, quoteIds, updates) {
  const result = await prisma.quote.updateMany({
    where: {
      id: { in: quoteIds },
      companyId,
    },
    data: updates,
  });
  return result.count;
}

export async function bulkDeleteQuotes(companyId, quoteIds) {
  const result = await prisma.quote.deleteMany({
    where: {
      id: { in: quoteIds },
      companyId,
      status: 'draft',
    },
  });
  return result.count;
}

// ============================================
// TIME ENTRIES
// ============================================

export async function bulkApproveTimeEntries(companyId, entryIds, approvedById) {
  const result = await prisma.timeEntry.updateMany({
    where: {
      id: { in: entryIds },
      companyId,
    },
    data: {
      approved: true,
      approvedAt: new Date(),
      approvedById,
    },
  });
  return result.count;
}

export async function bulkDeleteTimeEntries(companyId, entryIds) {
  const result = await prisma.timeEntry.deleteMany({
    where: {
      id: { in: entryIds },
      companyId,
    },
  });
  return result.count;
}

// ============================================
// GENERIC BULK OPERATIONS
// ============================================

const ENTITY_CONFIG = {
  contacts: { model: 'contact', softDelete: false },
  projects: { model: 'project', softDelete: false },
  jobs: { model: 'job', softDelete: false },
  invoices: { model: 'invoice', softDelete: false, restrictDelete: ['sent', 'paid', 'partial'] },
  quotes: { model: 'quote', softDelete: false, restrictDelete: ['sent', 'approved'] },
  timeEntries: { model: 'timeEntry', softDelete: false },
};

export async function bulkOperation(companyId, entityType, operation, ids, data = {}) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  switch (operation) {
    case 'update':
      return prisma[config.model].updateMany({
        where: { id: { in: ids }, companyId },
        data,
      });

    case 'delete':
      const deleteWhere = { id: { in: ids }, companyId };
      if (config.restrictDelete) {
        deleteWhere.status = { notIn: config.restrictDelete };
      }
      return prisma[config.model].deleteMany({ where: deleteWhere });

    case 'archive':
      return prisma[config.model].updateMany({
        where: { id: { in: ids }, companyId },
        data: { status: 'archived' },
      });

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

export default {
  bulkUpdateContacts,
  bulkDeleteContacts,
  bulkAssignContactTags,
  bulkUpdateProjects,
  bulkDeleteProjects,
  bulkArchiveProjects,
  bulkUpdateJobs,
  bulkDeleteJobs,
  bulkAssignJobs,
  bulkRescheduleJobs,
  bulkUpdateJobStatus,
  bulkUpdateInvoices,
  bulkDeleteInvoices,
  bulkSendInvoices,
  bulkMarkInvoicesPaid,
  bulkUpdateQuotes,
  bulkDeleteQuotes,
  bulkApproveTimeEntries,
  bulkDeleteTimeEntries,
  bulkOperation,
};
