// Closing a visit, ONE way: the sale (once), the visit record, loyalty and the review request. Completing an
// appointment and logging a service against it both close the visit; the service log had its own copy that raised the
// sale and the review and never awarded loyalty — the salon live test's first client never joined (2026-10-25).
// Never throws: the status change already happened, and none of this may undo it.
import { and, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { appointment, serviceMenu, serviceRecord } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { AUTO_VISIT_NOTE } from './formulas.ts'
import type { createSalonCheckout } from './checkout.ts'
import type { createLoyaltyAward } from './loyaltyAward.ts'

type AppointmentRow = typeof appointment.$inferSelect

export function createVisitClosing(d: CrmDeps, checkout: ReturnType<typeof createSalonCheckout>, loyalty: ReturnType<typeof createLoyaltyAward>) {
  const { db, logger } = d
  const warn = (what: string, e: any) => logger.warn(`[visit] ${what}`, { error: e?.message || String(e) })

  /** The visit's sale id, or null. `charged` is what the stylist logged, where they logged one. */
  async function closeVisit(row: AppointmentRow, actor?: any, charged?: number | null): Promise<string | null> {
    if (!row.contactId) return null
    let invoiceId: string | null = null
    let price = Number(charged) > 0 ? Number(charged) : Number(row.quotedPrice)
    let serviceName: string | null = null
    try {
      if (row.serviceId) {
        const [svc] = await db.select({ name: serviceMenu.name, price: serviceMenu.price }).from(serviceMenu).where(eq(serviceMenu.id, row.serviceId)).limit(1)
        serviceName = svc?.name || null
        if (!(price > 0)) price = Number(svc?.price)
      }
    } catch (e) { warn('service menu not read', e) }

    try {
      const inv = await checkout.ensureInvoiceForVisit({ companyId: row.companyId, contactId: row.contactId, appointmentId: row.id, serviceName, price, actor })
      invoiceId = inv?.id || null
    } catch (e) { warn('sale not created', e) }
    // A completed appointment IS a visit: write the service record once (a logged service already wrote it).
    try {
      const [rec] = await db.select({ id: serviceRecord.id }).from(serviceRecord).where(and(eq(serviceRecord.appointmentId, row.id), eq(serviceRecord.companyId, row.companyId))).limit(1)
      if (!rec) {
        await db.insert(serviceRecord).values({
          id: createId(), contactId: row.contactId, appointmentId: row.id,
          stylistId: row.stylistId || null, stylistMemberId: row.stylistMemberId || null,
          serviceId: row.serviceId || null,
          performedAt: new Date(row.startTime), formula: [], priceCharged: price > 0 ? String(price) : null,
          notes: AUTO_VISIT_NOTE, companyId: row.companyId,
        } as any)
      }
    } catch (e) { warn('visit record not created', e) }
    // Loyalty rides on the same event; idempotent on the appointment.
    try {
      const earnOn = Number(charged) > 0 ? Number(charged) : await loyalty.priceForVisit(row.companyId, row.serviceId, row.quotedPrice)
      await loyalty.awardForCompletedVisit({ companyId: row.companyId, contactId: row.contactId, appointmentId: row.id, serviceId: row.serviceId, price: earnOn, invoiceId })
    } catch (e) { warn('loyalty not awarded', e) }

    d.services.reviews.scheduleReviewRequestForVisit({ companyId: row.companyId, contactId: row.contactId }).catch((e: any) => warn('review schedule failed', e))
    return invoiceId
  }

  return { closeVisit }
}
