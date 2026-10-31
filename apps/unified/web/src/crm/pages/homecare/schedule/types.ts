// The rows the schedule group's screens read, as the unified server answers them (camelCase; RULEBOOK §2).
// Each names the route and data function it was read from.

/**
 * GET /api/caregivers (server/crm/homecare/hr/caregivers.ts, a list reply). Weekly cap and status are the nested
 * `availability` (caregiver_availability), null until the caregiver has one.
 */
export interface Caregiver {
  id: string
  firstName: string
  lastName: string
  phone?: string | null
  isActive?: boolean
  availability?: { status?: string | null; maxHoursPerWeek?: number | null } | null
}

/**
 * GET /api/clients (server/crm/homecare/clients/clients.ts, a list reply): the clients row. The server sends no
 * care-type or payer name on this list (nor did the template's), so the grid's rate hint shows private pay only.
 */
export interface Client {
  id: string
  firstName: string
  lastName: string
  serviceType?: string | null
  isPrivatePay?: boolean | null
  privatePayRate?: string | number | null
  careTypeName?: string | null
  referralSourceName?: string | null
}

/** A per-date exception (server/data/homecareCore.ts EXC_COLS). */
export interface ScheduleException {
  id: string
  scheduleId: string
  exceptionDate: string | null
  exceptionType: string
  overrideStartTime: string | null
  overrideEndTime: string | null
  overrideCaregiverId: string | null
  overrideClientId: string | null
  overrideNotes: string | null
  cancelReason?: string | null
}

/**
 * A schedule row (server/data/homecareCore.ts SCHED_COLS): GET /api/schedules-all and GET /api/schedules/caregiver/:id,
 * each with its `exceptions`. Dates are 'YYYY-MM-DD', times 'HH:MM:SS'.
 */
export interface ScheduleRow {
  id: string
  caregiverId: string | null
  clientId: string
  scheduleType?: string | null
  frequency: string | null
  dayOfWeek: number | null
  date: string | null
  startTime: string
  endTime: string
  effectiveDate: string | null
  anchorDate: string | null
  endDate: string | null
  suspendedFrom: string | null
  isActive?: boolean
  notes: string | null
  isTraining?: boolean
  isSplitShift?: boolean
  splitShiftGroupId?: string | null
  splitSegment?: number | null
  createdAt?: string | null
  exceptions?: ScheduleException[]
  clientFirstName?: string | null
  clientLastName?: string | null
}

/** "First Last" of anyone with a first and last name. */
export const fullName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined): string =>
  p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : ''

/** True for a repeating row (it has a weekday). */
export const isRecurringRow = (s: { dayOfWeek: number | null | undefined }): boolean => s.dayOfWeek !== null && s.dayOfWeek !== undefined

/** What every create / edit answers beside the row: the authorization advice (advisory; the shift is saved). */
export interface SavedReply {
  authWarnings?: string[]
  /** 'CPR (expired 2026-10-01)' for the caregiver put on the shift — empty unless credential tracking is on. */
  credentialWarnings?: string[]
  effectiveDateClamped?: boolean
  effectiveDate?: string | null
}
