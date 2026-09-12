// The two calendars an online booking can land on. Each template picks one and passes its table.
import { eq, and, gte, lte, ne, inArray, notInArray } from 'drizzle-orm'
import { nextNumber } from '../invoicing/money'
import type { BookingCalendar, BookingStatus } from './types'

const hoursToMs = (h: unknown) => (Number(h) || 1) * 3_600_000

/**
 * Trades (contractor, field service, landscaping, events, RV): a booking becomes a scheduled job.
 * Numbered JOB-00001 under the same advisory lock the rest of the app uses.
 */
export function jobCalendar(job: any, opts: { numbering?: { prefix: string; pad?: number; seed?: number } } = {}): BookingCalendar {
  const numbering = opts.numbering || { prefix: 'JOB', pad: 5, seed: 0 }
  const statusFor = (s: BookingStatus) => s === 'pending' ? 'pending' : s === 'confirmed' ? 'scheduled' : s === 'completed' ? 'completed' : 'cancelled'
  return {
    kind: 'job',
    linkField: 'jobId',
    async busy(exec, companyId, from, to) {
      const rows = await exec.select({ start: job.scheduledDate, hours: job.estimatedHours })
        .from(job)
        .where(and(eq(job.companyId, companyId), gte(job.scheduledDate, from), lte(job.scheduledDate, to), ne(job.status, 'cancelled')))
      return rows.filter((r: any) => r.start).map((r: any) => ({ start: new Date(r.start), end: new Date(new Date(r.start).getTime() + hoursToMs(r.hours)) }))
    },
    async create(exec, i) {
      const number = await nextNumber(exec, job, job.number, job.companyId, i.companyId, numbering)
      const [row] = await exec.insert(job).values({
        companyId: i.companyId,
        contactId: i.contactId,
        number,
        title: i.serviceName || 'Online Booking',
        description: i.customerNotes || `Booked online for ${i.serviceName || 'service'}`,
        status: i.pendingDeposit ? 'pending' : 'scheduled',
        priority: 'normal',
        scheduledDate: i.start,
        estimatedHours: String(Math.round((i.durationMinutes / 60) * 100) / 100),
        source: 'online_booking',
      }).returning({ id: job.id, number: job.number })
      return { id: row.id, label: row.number }
    },
    async setStatus(exec, id, status) {
      await exec.update(job).set({ status: statusFor(status), updatedAt: new Date() }).where(eq(job.id, id))
    },
    async lookup(exec, ids) {
      if (!ids.length) return {}
      const rows = await exec.select({ id: job.id, number: job.number, status: job.status }).from(job).where(inArray(job.id, ids))
      return Object.fromEntries(rows.map((r: any) => [r.id, { label: r.number, status: r.status }]))
    },
  }
}

/**
 * Appointment books (salon "The Book", vet appointments): a booking becomes an appointment with a real
 * start/end, so desk-made appointments block online slots and vice versa.
 */
export function appointmentCalendar(appointment: any, opts: {
  /** column that holds the customer: salon contactId, vet ownerId */
  contactColumn: string
  /** column for the vertical's own service id (salon serviceId → service_menu) */
  serviceColumn?: string
  /** column for a free-text reason (vet) */
  reasonColumn?: string
  /** column for the quoted price (salon quotedPrice) */
  priceColumn?: string
  /** extra fixed values on insert (vet: { type: 'wellness' }) */
  defaults?: Record<string, unknown>
  /** the table serviceColumn points at (salon service_menu) — its `name` becomes the booking's service name in the owner's list */
  serviceTable?: any
}): BookingCalendar {
  const inactive = ['cancelled', 'no_show']
  const statusFor = (s: BookingStatus) => s === 'pending' ? 'scheduled' : s
  const svcCol = opts.serviceColumn ? appointment[opts.serviceColumn] : null
  return {
    kind: 'appointment',
    linkField: 'appointmentId',
    async busy(exec, companyId, from, to) {
      const rows = await exec.select({ start: appointment.startTime, end: appointment.endTime })
        .from(appointment)
        .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, from), lte(appointment.startTime, to), notInArray(appointment.status, inactive)))
      return rows.filter((r: any) => r.start).map((r: any) => ({ start: new Date(r.start), end: r.end ? new Date(r.end) : null }))
    },
    async create(exec, i) {
      const values: Record<string, unknown> = {
        companyId: i.companyId,
        [opts.contactColumn]: i.contactId,
        status: 'scheduled',
        startTime: i.start,
        endTime: i.end,
        notes: `Online booking: ${i.serviceName || 'service'}${i.customerNotes ? ' — ' + i.customerNotes : ''}`,
        ...(opts.defaults || {}),
      }
      if (opts.serviceColumn && i.serviceRef) values[opts.serviceColumn] = i.serviceRef
      if (opts.reasonColumn) values[opts.reasonColumn] = i.serviceName || 'Online booking'
      if (opts.priceColumn && i.price != null && i.price > 0) values[opts.priceColumn] = String(i.price)
      const [row] = await exec.insert(appointment).values(values).returning({ id: appointment.id })
      return { id: row.id, label: null }
    },
    async setStatus(exec, id, status) {
      await exec.update(appointment).set({ status: statusFor(status), updatedAt: new Date() }).where(eq(appointment.id, id))
    },
    async lookup(exec, ids) {
      if (!ids.length) return {}
      const rows = await exec.select({ id: appointment.id, status: appointment.status, ...(svcCol ? { serviceId: svcCol } : {}) }).from(appointment).where(inArray(appointment.id, ids))
      const names = new Map<string, string>()
      if (svcCol && opts.serviceTable) {
        const svcIds = [...new Set(rows.map((r: any) => r.serviceId).filter(Boolean))] as string[]
        if (svcIds.length) for (const s of await exec.select({ id: opts.serviceTable.id, name: opts.serviceTable.name }).from(opts.serviceTable).where(inArray(opts.serviceTable.id, svcIds))) names.set(s.id, s.name)
      }
      return Object.fromEntries(rows.map((r: any) => [r.id, { label: null, status: r.status, serviceName: (r.serviceId && names.get(r.serviceId)) || null }]))
    },
  }
}
