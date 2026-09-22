// Documents — shared implementation (packages/tenant-backend/src/files/documents.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables, storage and
// audit log in.
//
// Roof was the one template that offered "Documents" in Settings and in its STARTER plan while
// mounting no route and rendering no page — the switch and the plan both promised something that did
// not exist. Everything here already existed and was in use by five other templates; roof was simply
// never wired up, the same way it was never wired to the shared AuthContext or AppShell.
//
// `links` is where the vertical shows: roof hangs a document off a JOB, a contact or an invoice.
// There is no `project` table here — that is the contractor lineage, not this one.
import { createDocumentRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { document, documentVersion, contact, job, invoice, user, planMarkup } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import storage from '../services/fileUpload.ts'

// No `audit` hook: unlike the contractor lineage, roof has no audit-log service and its logger has no
// audit method. The hook is optional in the shared module, so it is left off rather than pointed at
// something that does not exist — a document upload is still recorded by the row itself
// (uploadedById + createdAt) and by the version history.
export default createDocumentRoutes({
  db,
  tables: { document, documentVersion, contact, user, planMarkup },
  storage,
  authenticate,
  options: {
    types: ['general', 'contract', 'permit', 'warranty', 'insurance', 'scope', 'inspection', 'photo', 'invoice', 'receipt', 'other'],
    links: { jobId: job, contactId: contact, invoiceId: invoice },
  },
})
