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

const LEGACY_TABLES = ['quickbooks_connection', 'activity_log']

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
  // takeoff_item column drift: fieldservice-lineage migrations created this table
  // with the old cost columns; schema.ts uses assembly_id + measurement columns.
  // Pre-add them so drizzle-kit push sees no NEW column to rename-prompt on.
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS assembly_id text`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS notes text`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS location text`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS measurement_type text`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS measurement_value numeric`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS length numeric`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS width numeric`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS height numeric`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS waste_factor numeric`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS sort_order integer`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS unit text`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS category text`,
  `ALTER TABLE takeoff_item ADD COLUMN IF NOT EXISTS description text`,
  // Pre-create the ads_experiment tables (schema-managed) so drizzle-kit push
  // sees no NEW table and never renders the interactive "created or renamed?"
  // prompt that hangs boot on Render (some verticals have several orphan tables
  // it would otherwise offer as rename targets). Columns match schema.ts; push
  // adds FKs/indexes non-interactively afterward.
  `CREATE TABLE IF NOT EXISTS ads_experiment (
     id text PRIMARY KEY, company_id text NOT NULL, name text NOT NULL, path text NOT NULL,
     status text NOT NULL DEFAULT 'draft', variants json NOT NULL DEFAULT '[]', winner_key text,
     started_at timestamptz, ended_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ads_experiment_assignment (
     id text PRIMARY KEY, experiment_id text NOT NULL, variant_key text NOT NULL,
     visitor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS ads_experiment_conversion (
     id text PRIMARY KEY, experiment_id text NOT NULL, variant_key text NOT NULL,
     visitor_id text NOT NULL, event_type text NOT NULL DEFAULT 'lead', target_id text,
     created_at timestamptz NOT NULL DEFAULT now())`,
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
  // review_request is schema-managed, but drizzle-kit push hangs at "Pulling
  // schema" on Render and never reconciles its added columns (job_id, channel,
  // the *_at timestamps), so /api/reviews 500s. Reconcile it directly.
  `CREATE TABLE IF NOT EXISTS review_request (
     id text PRIMARY KEY, status text DEFAULT 'pending', channel text DEFAULT 'both',
     sent_at timestamp, clicked_at timestamp, follow_up_sent_at timestamp,
     opened_at timestamp, submitted_at timestamp, review_link text,
     company_id text, job_id text, contact_id text, created_at timestamp DEFAULT now())`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS job_id text`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS channel text DEFAULT 'both'`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS sent_at timestamp`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS clicked_at timestamp`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS follow_up_sent_at timestamp`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS opened_at timestamp`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS submitted_at timestamp`,
  `ALTER TABLE review_request ADD COLUMN IF NOT EXISTS review_link text`,
]
for (const stmt of ENSURE) {
  try { await db.execute(sql.raw(stmt)) }
  catch (e: any) { console.warn('[prune-legacy] ensure failed:', e?.message || e) }
}
console.log('[prune-legacy] recurring tables reconciled')

process.exit(0)
