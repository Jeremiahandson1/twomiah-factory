// Bulk operations — shared implementation (packages/tenant-backend/src/bulk/bulk.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's db + tables in; behaviour lives
// in one place for every CRM.
import { createBulkService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, project, job, invoice, quote, timeEntry, payment } from '../../db/schema.ts'

const service = createBulkService({
  db,
  tables: { contact, project, job, invoice, quote, timeEntry, payment },
})

export const {
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
} = service

export default service
