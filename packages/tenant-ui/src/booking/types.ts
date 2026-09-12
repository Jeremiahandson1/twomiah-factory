// Shared online-booking UI — the contract between a template and the vendored page.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type BookingApi = InvoicingApi
export type BookingToast = InvoicingToast

export interface BookingConfig {
  /** What a booking becomes on this CRM's calendar: "Job" (trades) or "Appointment" (salon, vet). */
  calendarLabel?: string
  /** Link for a booking's calendar entry. Return null for no link. Default /crm/jobs/:id */
  calendarPath?: (id: string) => string | null
  /** Salon: services offered online come from the Service Menu at this path once anything there is flagged. */
  serviceMenuPath?: string
  /** Label + help for the per-slot capacity setting ("Crews bookable at once", "Chairs bookable at once"…). */
  concurrentLabel?: string
  concurrentHelp?: string
}

export interface BookingPageProps {
  api: BookingApi
  toast: BookingToast
  config?: BookingConfig
}

export const defaultBookingConfig: Required<BookingConfig> = {
  calendarLabel: 'Job',
  calendarPath: (id) => `/crm/jobs/${id}`,
  serviceMenuPath: '',
  concurrentLabel: 'Bookings per time slot',
  concurrentHelp: 'How many online bookings one time slot can take. Entries made from the office count too.',
}

export const resolveBookingConfig = (c?: BookingConfig) => ({ ...defaultBookingConfig, ...(c || {}) })

export interface BookingRow {
  id: string
  customerName: string
  customerEmail: string
  customerPhone?: string | null
  serviceName?: string | null
  scheduledDate: string
  status: string
  confirmationCode?: string | null
  depositAmount?: number
  depositStatus?: string
  notes?: string | null
  calendar?: { kind: 'job' | 'appointment'; id: string | null; label: string | null; status: string | null }
}

export interface BookableServiceRow {
  id?: string
  name: string
  description?: string | null
  durationMinutes: number
  price: number
  depositRequired: boolean
  depositAmount: number
  active: boolean
}

export interface BookingSettings {
  enabled: boolean
  slotDurationMinutes: number
  leadTimeDays: number
  maxDaysOut: number
  concurrentBookings: number
  timezone: string
  workingHours: Record<string, { start: string; end: string; enabled: boolean }>
  welcomeMessage: string
  confirmationMessage: string
  notifyEmail: boolean
  notifySms: boolean
}
