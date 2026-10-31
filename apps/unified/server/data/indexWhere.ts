// The conditions of the schema's partial indexes. Drizzle writes a condition built from eq() into the migration as a
// bind placeholder ("WHERE source = $1"), which Postgres refuses in an index, so each is written out here as SQL
// (RULEBOOK §2: raw SQL lives in server/data/).
import { sql } from 'drizzle-orm'

/** commission: one automatic commission per invoice, plan and person; one reversal per commission. */
export const commissionIsAuto = sql`source = 'auto'`
export const commissionIsReversal = sql`source = 'reversal'`
/** commission: a roofing job's commission, draw or refund adjustment is made once per its earn_key (roof/commissions.ts). */
export const commissionHasEarnKey = sql`earn_key IS NOT NULL`

/** job: one visit per route stop per day — making a route's visits twice cannot stack two on one day (landscaping routes). */
export const jobOnRouteStop = sql`recurring_route_stop_id IS NOT NULL`

/** invoice: a number is held by one live invoice per company; a voided one gives its number up (Vet T41, T58d). */
export const invoiceIsLive = sql`status <> 'void'`

// Home care's own guards and partial indexes (templates/crm-homecare/backend/db/migrations 0015–0017), which the
// first home-care migration (0007) left out — found moving the visits and billing routes; restored by 0010.
/** schedules: one ACTIVE recurring pattern per caregiver, client, weekday and clock time (the 409 on a duplicate). */
export const scheduleActiveRecurring = sql`is_active = true AND day_of_week IS NOT NULL AND end_date IS NULL`
export const scheduleStartClock = sql`(start_time::time)`
export const scheduleEndClock = sql`(end_time::time)`
/** time_entries: one OPEN visit per caregiver — two taps of clock-in cannot make twin visits that bill twice. */
export const timeEntryOpen = sql`end_time IS NULL`
export const scheduleIsTraining = sql`is_training = true`
export const scheduleSuspended = sql`suspended_from IS NOT NULL`
export const timeEntryNeedsApproval = sql`needs_approval = true`
export const userHasResetToken = sql`reset_token IS NOT NULL`
/** invoices.seq_number: the friendly, never-reused "Invoice #42", from its own sequence. */
export const invoiceSeqNext = sql`nextval('invoice_seq_number_seq')`
