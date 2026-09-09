import { execSync } from 'child_process'
import pg from 'pg'

const MAX_RETRIES = 20
const RETRY_DELAY_MS = 10000

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    console.log(`[migrate] Attempt ${attempt}/${MAX_RETRIES}...`)
    execSync('bun x drizzle-kit migrate', { stdio: 'inherit' })
    console.log('[migrate] Success')
    break
  } catch (err: any) {
    if (attempt === MAX_RETRIES) {
      console.error(`[migrate] Failed after ${MAX_RETRIES} attempts`)
      process.exit(1)
    }
    console.log(`[migrate] Connection failed, retrying in ${RETRY_DELAY_MS / 1000}s...`)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
  }
}

// Reconcile the database to schema.ts. The hand-maintained SQL migrations drifted
// badly behind the Drizzle schema — ~50 tables (locations, batches, metrc, labels,
// kiosk, delivery, compliance, …) were never created, and existing tables like
// cash_sessions were missing newer columns (register, opening_amount, opened_by_id).
// That drift is exactly what made ~20 endpoints (and the whole POS/register path)
// return 500 "relation/column does not exist". schema.ts is a strict superset of the
// DB, so `push` is purely additive here — it creates the missing tables/columns and
// never drops anything. This also stops the drift recurring as the schema evolves.
// drizzle-kit push can stall indefinitely: it hangs on "Pulling schema from database"
// against a busy free-tier Postgres and, despite --force, can block on an interactive
// rename prompt. Plain execSync has no timeout, so a stuck push froze the ENTIRE boot —
// the &&-chained server never started and Render failed the deploy with "no open ports".
// Bound each attempt with `timeout` (the start-command push already uses this pattern):
// -k 10 60 sends SIGTERM at 60s and SIGKILL 10s later, so a hung push is killed, its DB
// connection released, and we fall through to the authoritative, idempotent ENSURE net
// below. Reconciliation is guaranteed by ENSURE + the prune-legacy-protected push in the
// start command — this step is belt-and-suspenders, so timing out is non-fatal.
// ONE tightly-bounded, non-fatal push. drizzle-kit push stalls intermittently on this
// tenant (see above), and each stalled attempt burns ~its full timeout against the
// deploy's port-bind window. Retrying it here only compounds that delay, so we make a
// single bounded attempt and let the authoritative, idempotent ENSURE net below — plus
// the start command's own bounded push — reconcile the schema. -k 10 45: SIGTERM at 45s,
// SIGKILL 10s later, so a hung push is killed and its DB connection freed.
try {
  console.log('[migrate] Reconciling schema (push, single bounded attempt)...')
  execSync('timeout -k 10 25 bun x drizzle-kit push --force', { stdio: 'inherit' })
  console.log('[migrate] Schema reconciled')
} catch (err: any) {
  console.error('[migrate] Schema reconcile (push) skipped/timed out — the idempotent ENSURE net below reconciles the known schema; boot continues')
}

// Safety net: ensure all schema columns exist even if a migration was recorded
// before its file was present. Uses IF NOT EXISTS so it's safe to re-run.
const ENSURE_COLUMNS_SQL = `
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_price" TEXT;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "in_stock" BOOLEAN DEFAULT true;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "total_sold" INTEGER DEFAULT 0;

  -- Drift the flaky drizzle-kit push failed to reconcile. Opening a cash drawer
  -- INSERTs created_at (B4), and the loyalty Members tab ORDERs BY created_at — both
  -- 500'd with "column created_at does not exist" until these run. (B4 / N5 loyalty)
  ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT now();
  ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP DEFAULT now();

  -- Category data migration: the client enum fix moved to canonical singular values
  -- ('pre_roll', 'accessory') but legacy rows kept the old spellings, so the Pre-Rolls
  -- and Merch tabs returned nothing. Align stored data to the enum. (B7 / N3)
  UPDATE "products" SET "category" = 'pre_roll' WHERE "category" = 'preroll';
  UPDATE "products" SET "category" = 'accessory' WHERE "category" = 'merch';

  -- Wholesale customers: the create/edit form collects license expiration, tax-exempt
  -- and status, but the table never had columns for them, so those fields were dropped
  -- on save. Add them so wholesale customer records persist fully. (finish/wholesale)
  ALTER TABLE "wholesale_customers" ADD COLUMN IF NOT EXISTS "expiration_date" TIMESTAMP;
  ALTER TABLE "wholesale_customers" ADD COLUMN IF NOT EXISTS "tax_exempt" BOOLEAN DEFAULT false;
  ALTER TABLE "wholesale_customers" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'active';

  -- Cash-drawer and EOD reconciliation attribute completed cash orders to a session
  -- (opening + cash sales - refunds), keyed on completed_at / payment_status / change_due.
  -- If the flaky drizzle push didn't reconcile these, the Cash and EOD pages 500. (retest#6 N2)
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_status" TEXT DEFAULT 'pending';
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "change_due" TEXT;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cash_tendered" TEXT;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "total_tax" TEXT;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tax_amount" TEXT;

  -- Self-order kiosk: the age-gate → browse → add-item → checkout flow persists the
  -- in-progress cart (items), the collected DOB and an updated_at on kiosk_sessions. These
  -- columns were absent from the DB, so /session/start 500'd on insert and the whole kiosk
  -- flow was dead. Safety net in case the drizzle push didn't reconcile them.
  ALTER TABLE "kiosk_sessions" ADD COLUMN IF NOT EXISTS "items" JSON DEFAULT '[]'::json;
  ALTER TABLE "kiosk_sessions" ADD COLUMN IF NOT EXISTS "dob_provided" TEXT;
  ALTER TABLE "kiosk_sessions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT now();

  -- Backfill completed_at on historical completed/refunded orders. Rows completed under
  -- older builds (before /complete and /status stamped completed_at) left it NULL, so
  -- completed_at-based analytics dropped whole days that created_at-based summary counted.
  -- Stamp them with when they were settled (updated_at), falling back to created_at.
  -- Idempotent — only touches rows still NULL. (retest#10 root fix)
  UPDATE "orders" SET "completed_at" = COALESCE("updated_at", "created_at")
  WHERE "completed_at" IS NULL AND "status" IN ('completed', 'refunded');

  -- Legacy orders with a NULL order_number (created before order_number was populated).
  -- Assign sequential numbers per company continuing from the current max. Idempotent. (retest#11)
  UPDATE "orders" o SET "order_number" = seq.rn
  FROM (
    SELECT n.id,
      (SELECT COALESCE(MAX(x.order_number), 1000) FROM "orders" x
         WHERE x.company_id = n.company_id AND x.order_number IS NOT NULL)
      + ROW_NUMBER() OVER (PARTITION BY n.company_id ORDER BY n.created_at) AS rn
    FROM "orders" n WHERE n.order_number IS NULL
  ) seq
  WHERE o.id = seq.id AND o.order_number IS NULL;

  -- Round float-artifact cash variances (e.g. -113.39999999999998) to cents. (retest#12)
  UPDATE "cash_sessions" SET "variance" = ROUND("variance"::numeric, 2)::text
  WHERE "variance" IS NOT NULL AND "variance" <> '' AND "variance" ~ '\\.[0-9]{3}';

  -- Backfill purchase_orders.total for POs created before total was set at create time
  -- (it was left at its '0' default while subtotal was correct). (retest#13 / F-12 medium)
  UPDATE "purchase_orders" SET "total" = "subtotal"
  WHERE ("total" IS NULL OR "total" IN ('0','0.0','0.00'))
    AND "subtotal" IS NOT NULL AND "subtotal" NOT IN ('0','0.0','0.00','');

  -- ============================================================================
  -- Schema-drift safety net for the SMS / push / marketing / predictive-inventory
  -- route code. drizzle-kit push should create all of this from schema.ts, but push
  -- is flaky, so mirror every new table/column here with IF NOT EXISTS so the routes
  -- never 500 on a missing relation/column.
  -- ============================================================================

  -- New columns on existing tables ---------------------------------------------
  -- Wave-2: persist equivalency per-transaction limit + contact store credit.
  ALTER TABLE "equivalency_rules" ADD COLUMN IF NOT EXISTS "purchase_limit_grams" TEXT;
  ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "store_credit" TEXT DEFAULT '0';
  -- NOTE: the user table's active flag is `is_active` (schema column), NOT `active`. The old
  -- ENSURE line here added a phantom `active` column that the reconcile push (schema has only
  -- is_active) dropped every boot; the two training queries that filtered `active` now use
  -- is_active, so no phantom column is needed. (deep-QA push-drop fix)
  -- Manufacturing job fail path (retest#14 F-15): the /fail handler records these but the columns
  -- were never created, so completing OR failing a job 500'd.
  ALTER TABLE "manufacturing_jobs" ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP;
  ALTER TABLE "manufacturing_jobs" ADD COLUMN IF NOT EXISTS "failure_reason" TEXT;
  -- Wholesale order create/update write line items as a JSON column (retest#14 F-16); it was
  -- never created, so POST /wholesale/orders 500'd on "column items does not exist".
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "items" JSONB DEFAULT '[]'::jsonb;
  -- Wholesale order lifecycle columns (retest#15 F-19): confirm/invoice/payment wrote these but
  -- none existed, so an order could be created and then go nowhere (confirm + payment 500'd).
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMP;
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "invoice_number" TEXT;
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "invoiced_at" TIMESTAMP;
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "amount_paid" TEXT DEFAULT '0';
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "payment_reference" TEXT;
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP;
  ALTER TABLE "wholesale_orders" ADD COLUMN IF NOT EXISTS "payments" JSONB DEFAULT '[]'::jsonb;
  -- Partial refunds (retest#18 F-33): track units returned per line + cumulative $ refunded.
  ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "refunded_quantity" INTEGER DEFAULT 0;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_amount" TEXT DEFAULT '0';
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_token" TEXT;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "estimated_delivery_at" TIMESTAMP;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "items" JSON;
  ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source" TEXT;

  ALTER TABLE "metrc_sync_log" ADD COLUMN IF NOT EXISTS "source" TEXT;
  ALTER TABLE "metrc_sync_log" ADD COLUMN IF NOT EXISTS "records_failed" INTEGER DEFAULT 0;
  ALTER TABLE "metrc_sync_log" ADD COLUMN IF NOT EXISTS "error_message" TEXT;

  ALTER TABLE "customer_bank_accounts" ADD COLUMN IF NOT EXISTS "item_id" TEXT;

  ALTER TABLE "wallet_passes" ADD COLUMN IF NOT EXISTS "pass_data" JSON;
  ALTER TABLE "wallet_passes" ADD COLUMN IF NOT EXISTS "device_id" TEXT;

  ALTER TABLE "tax_filings" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT;
  ALTER TABLE "tax_filings" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP;

  ALTER TABLE "company_integrations" ADD COLUMN IF NOT EXISTS "last_test_at" TIMESTAMP;
  ALTER TABLE "company_integrations" ADD COLUMN IF NOT EXISTS "last_test_result" TEXT;

  ALTER TABLE "uptime_incidents" ADD COLUMN IF NOT EXISTS "affected_services" JSON DEFAULT '[]'::json;

  ALTER TABLE "fraud_rules" ADD COLUMN IF NOT EXISTS "description" TEXT;

  -- Predictive inventory: the /forecast upsert writes these columns and upserts
  -- ON CONFLICT (product_id, company_id). It never supplies forecast_date, so a
  -- NOT NULL there 500s the insert — drop it. (predictive-inventory.ts)
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "current_stock" TEXT;
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "daily_avg_sales_7d" TEXT;
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "daily_avg_sales_30d" TEXT;
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "urgency" TEXT;
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "total_sold_90d" INTEGER;
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "data_points" INTEGER;
  ALTER TABLE "inventory_forecasts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT now();
  ALTER TABLE "inventory_forecasts" ALTER COLUMN "forecast_date" DROP NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS "inv_forecast_product_company_unique"
    ON "inventory_forecasts" ("product_id", "company_id");

  -- Reorder suggestions: the /reorder-suggestions/generate upsert writes suggested_qty
  -- (distinct from the legacy suggested_quantity) + daily_avg_sales/days_until_stockout/
  -- updated_at, and upserts ON CONFLICT (product_id, company_id, status) WHERE status='pending'.
  ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "daily_avg_sales" TEXT;
  ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "days_until_stockout" INTEGER;
  ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "suggested_qty" INTEGER;
  ALTER TABLE "reorder_suggestions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT now();
  CREATE UNIQUE INDEX IF NOT EXISTS "reorder_suggestion_product_company_pending_unique"
    ON "reorder_suggestions" ("product_id", "company_id", "status") WHERE "status" = 'pending';

  -- F-34: at most ONE open cash drawer per company. The /sessions/open handler did a
  -- SELECT-for-open then a separate INSERT — a read-decide-write that raced: under
  -- concurrent opens, several requests passed the SELECT before any INSERT landed and
  -- multiple drawers opened (EOD then reconciled only the latest). A partial unique
  -- index makes a second open row physically impossible; the handler catches the
  -- resulting 23505 and returns the same friendly 400. First retire any pre-existing
  -- extra open drawers (keep the earliest per company) so the index can build.
  UPDATE "cash_sessions" SET "status" = 'closed', "closed_at" = COALESCE("closed_at", now())
    WHERE "status" = 'open' AND "id" NOT IN (
      SELECT DISTINCT ON ("company_id") "id" FROM "cash_sessions"
      WHERE "status" = 'open' ORDER BY "company_id", "opened_at" ASC
    );
  CREATE UNIQUE INDEX IF NOT EXISTS "cash_session_one_open_per_company"
    ON "cash_sessions" ("company_id") WHERE "status" = 'open';

  -- Loyalty: total_points_earned is the authoritative lifetime-earned counter (it drives
  -- every tier threshold). lifetime_points is the outward "Lifetime Points" alias shown in
  -- the UI/export/API; it had drifted low because member-create + gamified/referral/POS
  -- award paths bumped only total_points_earned. Those paths now write both in lockstep;
  -- reconcile existing rows so the two agree. (F-34 retest#19)
  UPDATE "loyalty_members" SET "lifetime_points" = COALESCE("total_points_earned", 0)
    WHERE COALESCE("lifetime_points", 0) <> COALESCE("total_points_earned", 0);

  -- New tables -----------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS "sms_conversations" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "phone" TEXT,
    "contact_id" TEXT,
    "contact_name" TEXT,
    "status" TEXT DEFAULT 'active',
    "unread" BOOLEAN DEFAULT false,
    "last_message" TEXT,
    "last_message_at" TIMESTAMP,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "sms_conversation_company_phone_unique"
    ON "sms_conversations" ("company_id", "phone");
  CREATE INDEX IF NOT EXISTS "sms_conversation_company_idx" ON "sms_conversations" ("company_id");

  CREATE TABLE IF NOT EXISTS "sms_messages" (
    "id" TEXT PRIMARY KEY,
    "conversation_id" TEXT,
    "company_id" TEXT,
    "direction" TEXT,
    "phone" TEXT,
    "body" TEXT,
    "twilio_sid" TEXT,
    "status" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "sms_message_conversation_idx" ON "sms_messages" ("conversation_id");
  CREATE INDEX IF NOT EXISTS "sms_message_company_idx" ON "sms_messages" ("company_id");

  CREATE TABLE IF NOT EXISTS "sms_templates" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "name" TEXT,
    "body" TEXT,
    "category" TEXT,
    "variables" JSON DEFAULT '[]'::json,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "sms_template_company_idx" ON "sms_templates" ("company_id");

  CREATE TABLE IF NOT EXISTS "sms_auto_responders" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "name" TEXT,
    "trigger_type" TEXT,
    "trigger_keyword" TEXT,
    "response_message" TEXT,
    "enabled" BOOLEAN DEFAULT true,
    "priority" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "sms_auto_responder_company_idx" ON "sms_auto_responders" ("company_id");

  CREATE TABLE IF NOT EXISTS "push_subscription" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "user_id" TEXT,
    "endpoint" TEXT,
    "p256dh" TEXT,
    "auth" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "push_subscription_user_idx" ON "push_subscription" ("user_id");

  CREATE TABLE IF NOT EXISTS "marketing_templates" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "name" TEXT,
    "subject" TEXT,
    "content" TEXT,
    "type" TEXT DEFAULT 'email',
    "category" TEXT,
    "variables" JSON DEFAULT '[]'::json,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "marketing_template_company_idx" ON "marketing_templates" ("company_id");

  CREATE TABLE IF NOT EXISTS "marketing_campaigns" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "name" TEXT,
    "type" TEXT DEFAULT 'email',
    "subject" TEXT,
    "content" TEXT,
    "audience_filter" JSON DEFAULT '{}'::json,
    "status" TEXT DEFAULT 'draft',
    "scheduled_at" TIMESTAMP,
    "sent_at" TIMESTAMP,
    "recipient_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "marketing_campaign_company_idx" ON "marketing_campaigns" ("company_id");
  CREATE INDEX IF NOT EXISTS "marketing_campaign_status_idx" ON "marketing_campaigns" ("status");

  CREATE TABLE IF NOT EXISTS "marketing_sequences" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "name" TEXT,
    "trigger_type" TEXT,
    "steps" JSON DEFAULT '[]'::json,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT now(),
    "updated_at" TIMESTAMP DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS "marketing_sequence_company_idx" ON "marketing_sequences" ("company_id");

  CREATE TABLE IF NOT EXISTS "marketing_sequence_enrollments" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT,
    "sequence_id" TEXT,
    "contact_id" TEXT,
    "current_step" INTEGER DEFAULT 0,
    "status" TEXT DEFAULT 'active',
    "enrolled_at" TIMESTAMP DEFAULT now(),
    "completed_at" TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS "marketing_seq_enroll_company_idx" ON "marketing_sequence_enrollments" ("company_id");
  CREATE INDEX IF NOT EXISTS "marketing_seq_enroll_sequence_idx" ON "marketing_sequence_enrollments" ("sequence_id");

  -- Training compliance dashboard (GET /api/training/compliance) — drizzle-kit push is flaky and
  -- left training_courses / training_enrollments missing columns on some tenants, 500ing the route.
  CREATE TABLE IF NOT EXISTS "training_courses" (
    "id" TEXT PRIMARY KEY,
    "company_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP DEFAULT now()
  );
  ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "is_required" BOOLEAN DEFAULT false;
  ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN DEFAULT true;
  ALTER TABLE "training_courses" ADD COLUMN IF NOT EXISTS "renewal_months" INTEGER;
  CREATE TABLE IF NOT EXISTS "training_enrollments" (
    "id" TEXT PRIMARY KEY,
    "course_id" TEXT,
    "user_id" TEXT,
    "company_id" TEXT,
    "created_at" TIMESTAMP DEFAULT now()
  );
  ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "company_id" TEXT;
  ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'assigned';
  ALTER TABLE "training_enrollments" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP;
`

try {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  await pool.query(ENSURE_COLUMNS_SQL)
  await pool.end()
  console.log('[migrate] Verified required columns exist')
} catch (err: any) {
  console.error('[migrate] Column safety check failed:', err.message)
  process.exit(1)
}

process.exit(0)
