// The bookings the Schedule draws, from the booking list's rows. A cancelled booking isn't drawn, and a booking converted
// into a job is on the board as that job — wherever the job now sits (the crew may have moved it to another day), so
// the booking is never drawn as well: one visit, drawn once. Every other live booking is drawn as a booking chip that
// opens its own page, where "Convert to job" is.
import type { ScheduleBooking } from '@twomiah/tenant-ui/src/schedule/types'

export function scheduleBookingsOf(rows: any[]): ScheduleBooking[] {
  return (rows || []).filter((b) => b && b.status !== 'cancelled' && !b.job).map((b) => ({
    id: b.id, startAt: b.startAt, status: b.status, customerName: b.customerName, serviceName: b.serviceName ?? null,
    customerAddress: b.customerAddress ?? null, calendarId: null, source: b.source === 'public' ? 'website' as const : 'crm' as const,
  }))
}
