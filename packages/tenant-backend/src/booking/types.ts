// Online booking — shared types. The template injects its Drizzle tables, the calendar the booking
// lands on (a job for the trades, an appointment for salon/vet) and a few options; the behaviour is
// identical everywhere.

/** A customer-facing rejection: closed day, past date, taken slot, bad input. Routes answer 400. */
export class BookingError extends Error {
  status = 400
  constructor(message: string) { super(message); this.name = 'BookingError' }
}

export interface BusyWindow { start: Date; end: Date | null }

export interface CalendarEntry { id: string; label: string | null }

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'

/**
 * Where a booking lands and what blocks availability. The calendar of record for a business is the
 * thing its staff actually look at — desk-made entries block online slots too.
 */
export interface BookingCalendar {
  kind: 'job' | 'appointment'
  /** online_booking column (camelCase, as the Drizzle table declares it) linking to the calendar row */
  linkField: 'jobId' | 'appointmentId'
  /** Active entries that START inside [from, to] (callers widen the window by a day each side). */
  busy(exec: any, companyId: string, from: Date, to: Date): Promise<BusyWindow[]>
  create(exec: any, input: {
    companyId: string
    contactId: string
    start: Date
    end: Date
    durationMinutes: number
    serviceName: string | null
    /** the vertical's own service reference (salon: service_menu id) when the catalog resolved one */
    serviceRef: string | null
    price: number | null
    customerNotes: string | null
    /** the booking still owes a deposit — the trades hold the job as 'pending' */
    pendingDeposit: boolean
  }): Promise<CalendarEntry>
  /** Mirror a booking status onto the calendar row. */
  setStatus(exec: any, id: string, status: BookingStatus): Promise<void>
  /** Label + status for the owner's list, keyed by calendar row id. */
  lookup(exec: any, ids: string[]): Promise<Record<string, { label: string | null; status: string | null }>>
}

export interface CatalogService {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  price: number
  depositRequired: boolean
  depositAmount: number
  active: boolean
  sortOrder: number
  source: 'widget' | 'menu'
  /** bookable_service id (online_booking.service_id FK) when this is a widget service */
  legacyServiceId: string | null
  /** the vertical's own service id (salon service_menu) when this came from its menu */
  menuServiceId: string | null
}

/** What customers may book. Default: the bookable_service table. Salon: its Service Menu. */
export interface BookingCatalog {
  publicServices(companyId: string, exec?: any): Promise<CatalogService[]>
  /** Active + currently offered only — a retired or switched-off service is not bookable. */
  resolve(companyId: string, serviceId: string, exec?: any): Promise<CatalogService | null>
  /** True when the vertical's own menu has taken over and the widget list is retired (salon). */
  retired?(companyId: string, exec?: any): Promise<boolean>
}

export interface BookingTables {
  company: any
  contact: any
  bookingSettings: any
  bookableService: any
  onlineBooking: any
}

export interface BookingOptions {
  /** The widget asks for a street address (the trades show up at it). Default false. */
  requireAddress?: boolean
  /** The widget asks for a phone number. Default true. */
  requirePhone?: boolean
  /** contact.type for a brand-new booker. Trades: 'lead'. Salon: 'client'. Default 'lead'. */
  contactType?: string
  /** Fallback zone when booking_settings.timezone is unset. Default America/Chicago. */
  defaultTimezone?: string
  /** Default opening hours for a brand-new settings row. Default 09:00–17:00 Mon–Fri. */
  defaultHours?: { start: string; end: string }
  /** Upper bound for concurrent bookings per slot. Default 20. */
  maxConcurrent?: number
  /** Minutes an unpaid deposit holds a slot. Default env BOOKING_DEPOSIT_HOLD_MINUTES or 30. */
  depositHoldMinutes?: number
  catalog?: BookingCatalog
  /** Owner notifications on each new booking, honouring the notifyEmail / notifySms switches. */
  notify?: {
    email?: (args: { to: string; subject: string; html: string }) => Promise<unknown>
    sms?: (companyId: string, args: { toPhone: string; message: string }) => Promise<unknown>
  }
  /** Stripe deposit intent for a service that requires one. Lazy so Stripe loads only when needed. */
  createDepositIntent?: (args: { bookingId: string; companyId: string; amount: number; contactRow: any; description: string }) => Promise<{ clientSecret?: string; publishableKey?: string; paymentIntentId?: string } | null>
  /** Host the embed snippet points at. Default RENDER_EXTERNAL_URL → FRONTEND_URL → BACKEND_URL. */
  embedHost?: () => string
}

export interface BookingDeps {
  db: any
  tables: BookingTables
  authenticate: any
  calendar: BookingCalendar
  options?: BookingOptions
}
