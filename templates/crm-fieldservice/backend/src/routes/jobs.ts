// Jobs (service calls) — shared implementation (packages/tenant-backend/src/jobs/jobs.ts), vendored into this
// tenant as ../shared at generation. This file only wires the template's tables, storage and services in.
import { z } from 'zod'
import { createJobRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { job, project, contact, user, timeEntry, equipment, jobPhoto } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import { cleanText } from '../utils/sanitize.ts'
import storage from '../services/fileUpload.ts'
import smsService from '../services/sms.ts'
import agreementService from '../services/agreements.ts'

export default createJobRoutes({
  db,
  tables: { job, project, contact, user, timeEntry, equipment, jobPhoto },
  authenticate,
  emitToCompany,
  EVENTS,
  cleanText,
  options: {
    // this vertical's job table also points at a piece of equipment and a service location
    extraFields: { equipmentId: z.string().optional().transform((v) => (v === '' ? undefined : v)), siteId: z.string().optional().transform((v) => (v === '' ? undefined : v)) },
    // job photos live in the private bucket and are served by /media (routes/media.ts)
    storage,
    // the customer hears from us as the tech moves through the call
    onDispatch: async ({ job, companyId }) => { smsService.sendJobUpdate(companyId, job.id, 'on_my_way').catch(() => {}) },
    onStart: async ({ job, companyId }) => { smsService.sendJobUpdate(companyId, job.id, 'on_site').catch(() => {}) },
    // completing a call under a service agreement schedules the next visit
    onComplete: async ({ job, companyId }) => {
      smsService.sendJobUpdate(companyId, job.id, 'completed').catch(() => {})
      if (!job.serviceAgreementId) return
      try {
        const result = await agreementService.generateNextJob(job.serviceAgreementId, companyId)
        return { nextServiceDate: result?.nextServiceDate ?? null }
      } catch (err) {
        // the daily scanner will pick it up
        console.log('Auto-schedule next job skipped:', (err as Error).message)
      }
    },
  },
})
