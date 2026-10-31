// Shared Schedule page — the contract between a template and the vendored page.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type ScheduleApi = InvoicingApi
export type ScheduleToast = InvoicingToast

export interface ScheduleConfig {
  /** Calendar appointments (/api/schedule-events) with a "New Appointment" form — RV. Default false. */
  events?: boolean
  /** Event type choices for the New Appointment form. */
  eventTypes?: Array<{ value: string; label: string }>
  /** Drag a job to another day (week, month) or another hour (day) to reschedule it. Default true. */
  dragDrop?: boolean
  /** Word for a job block in tooltips / legend. Default "Job". */
  jobLabel?: string
  /** Bookings from the connected premium website (/api/bookings/external). Default true. */
  externalBookings?: boolean
  /**
   * Where the week's bookings come from, in place of the CRM's /api/booking and the website's /api/bookings/external.
   * The unified app has one booking engine for site and CRM; it reads its own bookings here.
   */
  loadBookings?: (from: string, to: string) => Promise<ScheduleBooking[]>
  /** Where a booking chip opens (the unified app's booking page). Absent: the chip is not a link, as before. */
  bookingHref?: (b: ScheduleBooking) => string | null
  /**
   * A lane per person (2026-10-24): the Day view puts each person — and "Unassigned" — in a column of their own, the
   * Week view offers "By person". Dragging between lanes changes who is on the job. For the verticals whose jobs carry
   * people (assignedToId and the others on it); roofing's crews are not people lanes. Default false.
   */
  lanes?: boolean
  /** "Optimise route" on a person's lane (GET /api/day-route, then POST /api/jobs/retime when the office agrees). */
  routes?: boolean
  /** The signed-in person's id: a seat that reads only its own jobs routes only its own lane. */
  meId?: string | null
  /**
   * The business's opening hours (company.settings.businessHours, Settings › Company), muted on the calendar the way
   * Jobber greys the hours outside them: a closed day's column, and the hours before opening and after closing in the
   * Day view, are drawn greyed — still droppable, just not where the business normally works. Absent: nothing is muted.
   */
  businessHours?: ScheduleBusinessHours | null
}
/** One day of opening hours, as Settings › Company stores them (tenant-backend company/businessHours.ts). */
export interface ScheduleDayHours { open?: string; close?: string; closed?: boolean }
export type ScheduleBusinessHours = Partial<Record<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday', ScheduleDayHours>>

export const DEFAULT_EVENT_TYPES = [
  { value: 'appointment', label: 'Appointment' },
  { value: 'test_drive', label: 'Test Drive' },
  { value: 'service', label: 'Service Drop-off' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'follow_up', label: 'Follow-up' },
]

export function resolveScheduleConfig(c?: ScheduleConfig) {
  const cfg = c || {}
  return {
    events: !!cfg.events,
    eventTypes: cfg.eventTypes && cfg.eventTypes.length ? cfg.eventTypes : DEFAULT_EVENT_TYPES,
    dragDrop: cfg.dragDrop !== false,
    jobLabel: cfg.jobLabel || 'Job',
    externalBookings: cfg.externalBookings !== false,
    loadBookings: cfg.loadBookings,
    bookingHref: cfg.bookingHref,
    lanes: !!cfg.lanes,
    routes: !!cfg.routes,
    meId: cfg.meId || null,
    businessHours: cfg.businessHours || null,
  }
}

export interface SchedulePageProps { api: ScheduleApi; toast: ScheduleToast; config?: ScheduleConfig }

/** A person on a job, as GET /api/jobs joins them (tenant-backend jobs.ts withRelations): the lead first. */
export interface ScheduleAssignee { id: string; name?: string | null; firstName?: string | null; lastName?: string | null; kind?: 'user' | 'member'; lead?: boolean }
export interface ScheduleJob { id: string; title: string; status: string; scheduledDate?: string | null; scheduledTime?: string | null; contact?: { name: string } | null; number?: string | null; assignedToId?: string | null; assignedToMemberId?: string | null; assignees?: ScheduleAssignee[] }
/** One shape for both booking sources: the CRM's own online bookings (scheduledDate) and the premium website's (startAt). */
/** `calendarId` is the job (or appointment) this booking became, when it became one — see below. */
export interface ScheduleBooking { id: string; startAt: string; status: string; customerName: string; serviceName?: string | null; customerAddress?: string | null; calendarId?: string | null; source: 'crm' | 'website' }
export interface ScheduleEvent { id: string; title: string; type?: string | null; start: string; end?: string | null; allDay?: boolean; status?: string | null; notes?: string | null }
