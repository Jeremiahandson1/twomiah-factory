// Jobs (service calls) — shared implementation (packages/tenant-backend/src/jobs/jobs.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, storage and services in.
import { z } from 'zod'
import { createJobRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { job, project, contact, user, timeEntry, equipment, jobPhoto, teamMember, invoice, invoiceLineItem, location } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { cleanText } from '../utils/sanitize.ts'
import jobHooks from '../services/jobHooks.ts'
import storage from '../services/fileUpload.ts'
import { requirePermission, hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

export default createJobRoutes({
  db,
  tables: { job, project, contact, user, timeEntry, equipment, jobPhoto, teamMember, invoice, invoiceLineItem, location },
  authenticate,
  requirePermission,
  // Changing what a job is WORTH needs the right that prices a quote. `jobs:update` has to stay
  // with field — it is how the work gets run — and was also letting a technician drop a job from
  // $11,183 to $1. (T32 M7)
  canSee: async (role: string, permission: string, userId?: string) =>
    hasPermission(role, permission, await getExtraPermissions(userId)),
  emitToCompany,
  EVENTS,
  cleanText,
  options: {
    // this vertical's job table also points at a piece of equipment and a service location
    extraFields: { equipmentId: z.string().optional().transform((v) => (v === '' ? undefined : v)), siteId: z.string().optional().transform((v) => (v === '' ? undefined : v)) },
    // job photos live in the private bucket and are served by /media (routes/media.ts)
    storage,
    // A service call can be billed: POST /api/jobs/:id/invoice. invoice.job_id exists here
    // (migration 0025), which is what makes the revenue reach the job in job costing. (T41)
    billing: { numbering: { prefix: 'INV', pad: 5 }, termsDays: 30 },
    // dispatched / started / completed: services/jobHooks.ts, the one definition routes/tech.ts runs too
    onDispatch: jobHooks.onDispatch,
    onStart: jobHooks.onStart,
    onComplete: jobHooks.onComplete,
  },
})
