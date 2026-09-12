// Shared Schedule page — the contract between a template and the vendored page.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type ScheduleApi = InvoicingApi
export type ScheduleToast = InvoicingToast

export interface ScheduleConfig {
  /** Calendar appointments (/api/schedule-events) with a "New Appointment" form — RV. Default false. */
  events?: boolean
  /** Event type choices for the New Appointment form. */
  eventTypes?: Array<{ value: string; label: string }>
  /** Drag a job block onto another day to reschedule it. Default true. */
  dragDrop?: boolean
  /** Word for a job block in tooltips / legend. Default "Job". */
  jobLabel?: string
  /** Bookings from the connected premium website (/api/bookings/external). Default true. */
  externalBookings?: boolean
}

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
  }
}

export interface SchedulePageProps { api: ScheduleApi; toast: ScheduleToast; config?: ScheduleConfig }

export interface ScheduleJob { id: string; title: string; status: string; scheduledDate?: string | null; scheduledTime?: string | null; contact?: { name: string } | null }
/** One shape for both booking sources: the CRM's own online bookings (scheduledDate) and the premium website's (startAt). */
export interface ScheduleBooking { id: string; startAt: string; status: string; customerName: string; serviceName?: string | null; customerAddress?: string | null; source: 'crm' | 'website' }
export interface ScheduleEvent { id: string; title: string; type?: string | null; start: string; end?: string | null; allDay?: boolean; status?: string | null; notes?: string | null }
