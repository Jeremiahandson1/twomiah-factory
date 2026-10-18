// The conditions of the schema's partial indexes. Drizzle writes a condition built from eq() into the migration as a
// bind placeholder ("WHERE source = $1"), which Postgres refuses in an index, so each is written out here as SQL
// (RULEBOOK §2: raw SQL lives in server/data/).
import { sql } from 'drizzle-orm'

/** commission: one automatic commission per invoice, plan and person; one reversal per commission. */
export const commissionIsAuto = sql`source = 'auto'`
export const commissionIsReversal = sql`source = 'reversal'`
