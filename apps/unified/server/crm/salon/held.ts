// Who holds a stylist, and when (salon gaps #4, #5): the one clash check the Book and online booking both use.
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { appointment, appointmentItem } from '../../db/schema/index.ts'
import { piecesOf, touch, type Processing } from './segments.ts'
import type { StylistRef } from './people.ts'

const CANCELLED = ['cancelled', 'no_show']
type AppointmentRow = typeof appointment.$inferSelect

/**
 * The appointment (or visit service) that holds this stylist at any point of [start, end) — or undefined. `proc` is the new time's
 * own processing gap (it holds the stylist only outside it). Cancelled and no-show rows free their time.
 * A plain appointment holds its whole span minus its gap; a visit with several services holds each stylist only for their services.
 */
export async function findStylistConflict(exec: any, companyId: string, stylist: StylistRef, start: Date, end: Date, ignoreId?: string, proc: Processing | null = null) {
    // What the new time would hold: the whole span, minus its processing gap. What the others hold: the same, or — for a visit
    // with several services — only the pieces this stylist does (segments.ts). A rule that, for a plain appointment, is the old overlap.
    const mine = piecesOf(start.getTime(), end.getTime(), proc)
    const heldBy = stylist.stylistId ? eq(appointment.stylistId, stylist.stylistId) : eq(appointment.stylistMemberId, stylist.stylistMemberId!)
    const rows: AppointmentRow[] = await exec.select().from(appointment).where(and(
      eq(appointment.companyId, companyId), heldBy,
      lte(appointment.startTime, end), gte(appointment.startTime, new Date(start.getTime() - 86400000)),
      ...(ignoreId ? [ne(appointment.id, ignoreId)] : []),
    ))
    const itemised = rows.length ? new Set<string>((await exec.select({ id: appointmentItem.appointmentId }).from(appointmentItem).where(inArray(appointmentItem.appointmentId, rows.map((r) => r.id)))).map((r: any) => r.id)) : new Set<string>()
    const hit = rows.find((r) => {
      if (CANCELLED.includes(r.status) || itemised.has(r.id)) return false
      const rs = new Date(r.startTime).getTime()
      return touch(mine, piecesOf(rs, r.endTime ? new Date(r.endTime).getTime() : rs + 3600000, { afterMin: r.processingAfterMin, min: r.processingMin }))
    })
    if (hit) return hit
    // The services other visits give this stylist (a visit's own row is held through its items).
    const heldItem = stylist.stylistId ? eq(appointmentItem.stylistId, stylist.stylistId) : eq(appointmentItem.stylistMemberId, stylist.stylistMemberId!)
    const items: Array<typeof appointmentItem.$inferSelect & { apptStart: Date; apptStatus: string }> = await exec.select({
      id: appointmentItem.id, companyId: appointmentItem.companyId, appointmentId: appointmentItem.appointmentId, position: appointmentItem.position,
      serviceId: appointmentItem.serviceId, stylistId: appointmentItem.stylistId, stylistMemberId: appointmentItem.stylistMemberId,
      startOffsetMin: appointmentItem.startOffsetMin, durationMin: appointmentItem.durationMin, processingAfterMin: appointmentItem.processingAfterMin,
      processingMin: appointmentItem.processingMin, price: appointmentItem.price, createdAt: appointmentItem.createdAt,
      apptStart: appointment.startTime, apptStatus: appointment.status,
    }).from(appointmentItem).innerJoin(appointment, eq(appointment.id, appointmentItem.appointmentId)).where(and(
      eq(appointmentItem.companyId, companyId), heldItem,
      lte(appointment.startTime, end), gte(appointment.startTime, new Date(start.getTime() - 86400000)),
      ...(ignoreId ? [ne(appointment.id, ignoreId)] : []),
    ))
    return items.find((it) => {
      if (CANCELLED.includes(it.apptStatus)) return false
      const is = new Date(it.apptStart).getTime() + it.startOffsetMin * 60_000
      return touch(mine, piecesOf(is, is + it.durationMin * 60_000, { afterMin: it.processingAfterMin, min: it.processingMin }))
    })
  }
