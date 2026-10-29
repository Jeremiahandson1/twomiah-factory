// WHO IS DUE A REBOOKING — one computation, for the recall list and the dashboard's tile (T58: "the rebooking counts
// disagree"). Moved from templates/crm-salon/backend/src/services/rebookingDue.ts.
//
// Four rules the tile once lacked: one row per client per RHYTHM, not per service; the client's OWN rhythm from their
// visit history; the categories the salon switched off (settings.rebookingCategoriesOff); and a client who already
// holds a future appointment is not chased.
import { and, eq, gt, isNotNull } from 'drizzle-orm'
import { liveAppointment } from './tileConditions.ts'
import { rebookInterval, describeInterval, categoryKey } from '@twomiah/tenant-backend'
import { serviceRecord, serviceMenu, contact, user, appointment, company } from '../../db/schema/index.ts'
import { calendarDateIn, shiftDays, type SalonClock } from './days.ts'

const dayStr = (d: Date) => d.toISOString().slice(0, 10)

export interface DueOptions {
  /** Due within this many days counts as due. */
  windowDays?: number
  /** How far overdue still counts as a call list; past it a client is a win-back (/lapsed). */
  maxOverdue?: number
}

export interface DueRow {
  recordId: string
  performedAt: Date
  serviceId: string | null
  serviceName: string
  category: string
  rebookIntervalDays: number
  stylistFirstName: string | null
  stylistLastName: string | null
  contactId: string
  clientName: string | null
  clientEmail: string | null
  clientPhone: string | null
  clientMobile: string | null
  intervalBasis: string
  intervalNote: string
  visitsInRhythm: number
  dueDate: string
  overdue: boolean
}

export function createRebookingDue(db: any, clock: SalonClock) {
  /**
   * Categories this salon does not want chased, folded the way the rhythms are keyed, so switching off "Colour" also
   * switches off "Color". (RR0929)
   */
  async function excludedCategories(companyId: string): Promise<Set<string>> {
    try {
      const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
      const raw = (co?.settings as any)?.rebookingCategoriesOff
      return new Set(Array.isArray(raw) ? raw.map((s: unknown) => categoryKey(s as string)) : [])
    } catch { return new Set() }
  }

  /** The due rows, windowed, de-duplicated by rhythm, the already-booked removed, in due-date order with `overdue`. */
  async function dueRebookings(companyId: string, opts: DueOptions = {}): Promise<DueRow[]> {
    const windowDays = Math.min(365, Math.max(1, Number(opts.windowDays ?? 14) || 14))
    const maxOverdue = Math.min(3650, Math.max(1, Number(opts.maxOverdue ?? 90) || 90))

    // The shop's calendar (Salon T25 N2).
    const tz = await clock.salonTimezone(companyId)
    const today = calendarDateIn(new Date(), tz)
    const cutoff = shiftDays(today, windowDays)
    const floor = shiftDays(today, -maxOverdue)

    const rows: any[] = await db.select({
      recordId: serviceRecord.id,
      performedAt: serviceRecord.performedAt,
      serviceId: serviceRecord.serviceId,
      serviceName: serviceMenu.name,
      category: serviceMenu.category,
      rebookIntervalDays: serviceMenu.rebookIntervalDays,
      stylistFirstName: user.firstName,
      stylistLastName: user.lastName,
      contactId: contact.id,
      clientName: contact.name,
      clientEmail: contact.email,
      clientPhone: contact.phone,
      clientMobile: contact.mobile,
    })
      .from(serviceRecord)
      .innerJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
      .leftJoin(user, eq(serviceRecord.stylistId, user.id))
      .where(and(eq(serviceRecord.companyId, companyId), isNotNull(serviceMenu.rebookIntervalDays)))

    // One row per client per RHYTHM: categoryKey folds case, spacing and the British/American spelling. (RR0929)
    const excluded = await excludedCategories(companyId)
    const byRhythm = new Map<string, any[]>()
    for (const r of rows) {
      if (!r.contactId) continue
      const rhythm = categoryKey(String(r.category || 'other'))
      if (excluded.has(rhythm)) continue
      const key = `${r.contactId}|${rhythm}`
      const list = byRhythm.get(key)
      if (list) list.push(r); else byRhythm.set(key, [r])
    }

    const data = [...byRhythm.values()]
      .map((visits) => {
        // The most recent visit is the one the row is ABOUT; the whole history decides WHEN.
        const last = visits.reduce((a, b) => (new Date(a.performedAt) > new Date(b.performedAt) ? a : b))
        const interval = rebookInterval(visits.map((v) => v.performedAt), last.rebookIntervalDays)
        if (!interval.days) return null
        return {
          ...last,
          rebookIntervalDays: interval.days,
          intervalBasis: interval.basis,
          intervalNote: describeInterval(interval),
          visitsInRhythm: visits.length,
          dueDate: dayStr(new Date(new Date(last.performedAt).getTime() + interval.days * 86400000)),
        }
      })
      .filter((r): r is any => !!r)
      .filter((r) => r.dueDate <= cutoff && r.dueDate >= floor)
      .map((r) => ({ ...r, overdue: r.dueDate < today }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

    // A client who already has a LIVE future appointment has effectively rebooked: a cancelled or no-show one has not. (RECALL-02)
    const booked = new Set(
      (await db.select({ contactId: appointment.contactId }).from(appointment)
        .where(and(eq(appointment.companyId, companyId), gt(appointment.startTime, new Date()), liveAppointment(appointment))))
        .map((a: { contactId: string | null }) => a.contactId).filter(Boolean),
    )
    return data.filter((r) => !booked.has(r.contactId)) as DueRow[]
  }

  return { dueRebookings, excludedCategories }
}

export type RebookingDue = ReturnType<typeof createRebookingDue>
