// Pre-push prune.
//
// `drizzle-kit push` renders an interactive "Is X created or renamed?" prompt
// when it sees a table dropped from the schema (e.g. the removed
// quickbooks_connection) alongside a newly-added table (ads_experiment). In
// Render's non-TTY that prompt hangs forever, the boot's `timeout` kills push,
// and the schema is left only partially reconciled — which is why columns like
// review_request.job_id never get added and those endpoints 500.
//
// Dropping the known-removed legacy tables here (BEFORE push) eliminates the
// rename ambiguity so push runs non-interactively and fully reconciles. This is
// a TARGETED allowlist — never a generic "drop everything not in the schema",
// which would wipe raw-SQL tables (recurring_invoice, recurring_line_item) that
// are intentionally not modelled in the Drizzle schema.

import { db } from './index.ts'
import { sql } from 'drizzle-orm'

const LEGACY_TABLES = ['quickbooks_connection']

for (const t of LEGACY_TABLES) {
  try {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
    console.log('[prune-legacy] ensured dropped:', t)
  } catch (e: any) {
    console.warn('[prune-legacy] could not drop', t, e?.message || e)
  }
}

// The recurring_invoice / recurring_line_item tables are raw-SQL (not in the
// Drizzle schema), so `drizzle-kit push` never reconciles them — an old table
// missing the `total` column made recurring-invoice creation 500. Ensure they
// exist with every column the recurring service writes (idempotent).
const ENSURE = [
  `CREATE TABLE IF NOT EXISTS recurring_invoice (
     id text PRIMARY KEY, company_id text NOT NULL, contact_id text, project_id text,
     frequency text, start_date timestamp, end_date timestamp, next_run_date timestamp,
     terms text, subtotal numeric, tax_rate numeric, tax_amount numeric, discount numeric,
     total numeric, notes text, auto_send boolean DEFAULT false, status text DEFAULT 'active',
     created_at timestamp DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS recurring_line_item (
     id text PRIMARY KEY, recurring_invoice_id text, description text, quantity numeric,
     unit_price numeric, total numeric, sort_order integer)`,
  `ALTER TABLE recurring_line_item ADD COLUMN IF NOT EXISTS total numeric`,
  `ALTER TABLE recurring_line_item ADD COLUMN IF NOT EXISTS unit_price numeric`,
  `ALTER TABLE recurring_line_item ADD COLUMN IF NOT EXISTS sort_order integer`,
  `ALTER TABLE recurring_invoice ADD COLUMN IF NOT EXISTS total numeric`,
  `ALTER TABLE recurring_invoice ADD COLUMN IF NOT EXISTS next_run_date timestamp`,
  `ALTER TABLE recurring_invoice ADD COLUMN IF NOT EXISTS auto_send boolean DEFAULT false`,
  // Schema-managed column that drizzle-kit push should add but often can't
  // (the pull phase is slow on a cold free-tier DB and gets killed by the boot
  // timeout). Ensure it directly so /api/reviews stops 500ing.
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS job_id text`,
]
for (const stmt of ENSURE) {
  try { await db.execute(sql.raw(stmt)) }
  catch (e: any) { console.warn('[prune-legacy] ensure failed:', e?.message || e) }
}
console.log('[prune-legacy] recurring tables reconciled')

process.exit(0)
