/**
 * Bulk Operations Service (Drizzle) — ONE implementation for every CRM template, vendored into each
 * tenant at generation (../shared). The template's services/bulk.ts passes its Drizzle db + tables;
 * behaviour is the per-template code as it stood before consolidation (#152), moved verbatim.
 *
 * Mass update, delete, and other bulk operations
 */

import { eq, and, inArray, sql } from 'drizzle-orm';

export interface BulkTables {
  contact: any
  project: any
  job: any
  invoice: any
  quote: any
  timeEntry: any
}

export interface BulkServiceDeps {
  db: any
  tables: BulkTables
}

export function createBulkService(deps: BulkServiceDeps) {
  const { db, tables: { contact, project, job, invoice, quote, timeEntry } } = deps

  // ============================================
  // CONTACTS
  // ============================================

  async function bulkUpdateContacts(companyId: string, contactIds: string[], updates: Record<string, unknown>): Promise<number> {
    const result = await db.update(contact)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(inArray(contact.id, contactIds), eq(contact.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkDeleteContacts(companyId: string, contactIds: string[]): Promise<number> {
    const result = await db.delete(contact)
      .where(and(inArray(contact.id, contactIds), eq(contact.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkAssignContactTags(companyId: string, contactIds: string[], tags: string[]): Promise<number> {
    const contacts = await db.select({ id: contact.id, tags: contact.tags })
      .from(contact)
      .where(and(inArray(contact.id, contactIds), eq(contact.companyId, companyId)));

    let updated = 0;
    for (const c of contacts) {
      const existingTags = (c.tags as string[]) || [];
      const newTags = [...new Set([...existingTags, ...tags])];
      await db.update(contact)
        .set({ tags: newTags, updatedAt: new Date() })
        .where(eq(contact.id, c.id));
      updated++;
    }
    return updated;
  }

  // ============================================
  // PROJECTS
  // ============================================

  async function bulkUpdateProjects(companyId: string, projectIds: string[], updates: Record<string, unknown>): Promise<number> {
    const result = await db.update(project)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(inArray(project.id, projectIds), eq(project.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkDeleteProjects(companyId: string, projectIds: string[]): Promise<number> {
    const result = await db.delete(project)
      .where(and(inArray(project.id, projectIds), eq(project.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkArchiveProjects(companyId: string, projectIds: string[]): Promise<number> {
    const result = await db.update(project)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(inArray(project.id, projectIds), eq(project.companyId, companyId)))
      .returning();
    return result.length;
  }

  // ============================================
  // JOBS
  // ============================================

  async function bulkUpdateJobs(companyId: string, jobIds: string[], updates: Record<string, unknown>): Promise<number> {
    const result = await db.update(job)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(inArray(job.id, jobIds), eq(job.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkDeleteJobs(companyId: string, jobIds: string[]): Promise<number> {
    const result = await db.delete(job)
      .where(and(inArray(job.id, jobIds), eq(job.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkAssignJobs(companyId: string, jobIds: string[], assignedToId: string): Promise<number> {
    const result = await db.update(job)
      .set({ assignedToId, updatedAt: new Date() })
      .where(and(inArray(job.id, jobIds), eq(job.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkRescheduleJobs(companyId: string, jobIds: string[], scheduledDate: string): Promise<number> {
    const result = await db.update(job)
      .set({ scheduledDate: new Date(scheduledDate), updatedAt: new Date() })
      .where(and(inArray(job.id, jobIds), eq(job.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkUpdateJobStatus(companyId: string, jobIds: string[], status: string): Promise<number> {
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'completed') {
      updates.completedAt = new Date();
    }

    const result = await db.update(job)
      .set(updates)
      .where(and(inArray(job.id, jobIds), eq(job.companyId, companyId)))
      .returning();
    return result.length;
  }

  // ============================================
  // INVOICES
  // ============================================

  async function bulkUpdateInvoices(companyId: string, invoiceIds: string[], updates: Record<string, unknown>): Promise<number> {
    const result = await db.update(invoice)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(inArray(invoice.id, invoiceIds), eq(invoice.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkDeleteInvoices(companyId: string, invoiceIds: string[]): Promise<number> {
    // Only delete draft invoices
    const result = await db.delete(invoice)
      .where(and(
        inArray(invoice.id, invoiceIds),
        eq(invoice.companyId, companyId),
        eq(invoice.status, 'draft'),
      ))
      .returning();
    return result.length;
  }

  async function bulkSendInvoices(companyId: string, invoiceIds: string[], emailService?: any): Promise<number> {
    const invoices = await db.select()
      .from(invoice)
      .where(and(
        inArray(invoice.id, invoiceIds),
        eq(invoice.companyId, companyId),
        eq(invoice.status, 'draft'),
      ));

    // Fetch contacts for each invoice
    let sent = 0;
    for (const inv of invoices) {
      if (inv.contactId) {
        const [c] = await db.select().from(contact).where(eq(contact.id, inv.contactId)).limit(1);
        if (c?.email) {
          try {
            await emailService?.sendInvoice?.({ ...inv, contact: c });
            await db.update(invoice)
              .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
              .where(eq(invoice.id, inv.id));
            sent++;
          } catch (e) {
            console.error(`Failed to send invoice ${inv.number}:`, e);
          }
        }
      }
    }
    return sent;
  }

  async function bulkMarkInvoicesPaid(companyId: string, invoiceIds: string[]): Promise<number> {
    const invoices = await db.select()
      .from(invoice)
      .where(and(
        inArray(invoice.id, invoiceIds),
        eq(invoice.companyId, companyId),
        sql`${invoice.status} IN ('sent', 'partial', 'overdue')`,
      ));

    let updated = 0;
    for (const inv of invoices) {
      await db.update(invoice)
        .set({
          status: 'paid',
          amountPaid: inv.total,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoice.id, inv.id));
      updated++;
    }
    return updated;
  }

  // ============================================
  // QUOTES
  // ============================================

  async function bulkUpdateQuotes(companyId: string, quoteIds: string[], updates: Record<string, unknown>): Promise<number> {
    const result = await db.update(quote)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(inArray(quote.id, quoteIds), eq(quote.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkDeleteQuotes(companyId: string, quoteIds: string[]): Promise<number> {
    const result = await db.delete(quote)
      .where(and(
        inArray(quote.id, quoteIds),
        eq(quote.companyId, companyId),
        eq(quote.status, 'draft'),
      ))
      .returning();
    return result.length;
  }

  // ============================================
  // TIME ENTRIES
  // ============================================

  async function bulkApproveTimeEntries(companyId: string, entryIds: string[], _approvedById: string): Promise<number> {
    const result = await db.update(timeEntry)
      .set({
        approved: true,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(inArray(timeEntry.id, entryIds), eq(timeEntry.companyId, companyId)))
      .returning();
    return result.length;
  }

  async function bulkDeleteTimeEntries(companyId: string, entryIds: string[]): Promise<number> {
    const result = await db.delete(timeEntry)
      .where(and(inArray(timeEntry.id, entryIds), eq(timeEntry.companyId, companyId)))
      .returning();
    return result.length;
  }

  // ============================================
  // GENERIC BULK OPERATIONS
  // ============================================

  type EntityTableMap = {
    [key: string]: {
      table: any;
      restrictDelete?: string[];
    };
  };

  const ENTITY_CONFIG: EntityTableMap = {
    contacts: { table: contact },
    projects: { table: project },
    jobs: { table: job },
    invoices: { table: invoice, restrictDelete: ['sent', 'paid', 'partial'] },
    quotes: { table: quote, restrictDelete: ['sent', 'approved'] },
    timeEntries: { table: timeEntry },
  };

  async function bulkOperation(
    companyId: string,
    entityType: string,
    operation: string,
    ids: string[],
    data: Record<string, unknown> = {},
  ) {
    const config = ENTITY_CONFIG[entityType];
    if (!config) {
      throw new Error(`Unknown entity type: ${entityType}`);
    }

    const tbl = config.table;

    switch (operation) {
      case 'update': {
        const result = await db.update(tbl)
          .set({ ...data, updatedAt: new Date() })
          .where(and(inArray(tbl.id, ids), eq(tbl.companyId, companyId)))
          .returning();
        return { count: result.length };
      }

      case 'delete': {
        let whereClause = and(inArray(tbl.id, ids), eq(tbl.companyId, companyId));
        if (config.restrictDelete) {
          whereClause = and(
            whereClause,
            sql`${tbl.status} NOT IN (${sql.join(config.restrictDelete.map(s => sql`${s}`), sql`, `)})`,
          );
        }
        const result = await db.delete(tbl)
          .where(whereClause!)
          .returning();
        return { count: result.length };
      }

      case 'archive': {
        const result = await db.update(tbl)
          .set({ status: 'archived', updatedAt: new Date() })
          .where(and(inArray(tbl.id, ids), eq(tbl.companyId, companyId)))
          .returning();
        return { count: result.length };
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  return {
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
}

export type BulkService = ReturnType<typeof createBulkService>
