-- Automatic commissions, and branches that mean something. (commission_tracking, multi_location)
--
-- The same file in crm, crm-fieldservice, crm-landscaping and crm-basic: one shared module reads these columns in
-- all four. Additive and idempotent throughout — db/reconcile.ts may have added a column from schema.ts already.
--
-- commission_plan.auto_earn / auto_since: who a plan pays by itself when an invoice is paid in full, and from when.
-- Only invoices paid AFTER auto_since earn, so switching it on never pays out an imported or migrated history.
ALTER TABLE "commission_plan" ADD COLUMN IF NOT EXISTS "auto_earn" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_plan" ADD COLUMN IF NOT EXISTS "auto_since" timestamp;--> statement-breakpoint
-- commission.source: manual | auto | reversal. reversal_of: the auto earning a reversal takes back.
ALTER TABLE "commission" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN IF NOT EXISTS "reversal_of" text;--> statement-breakpoint
-- Once per invoice, plan and person — the backstop under the sweep, the webhook and a double click.
CREATE UNIQUE INDEX IF NOT EXISTS "commission_auto_once" ON "commission" ("invoice_id", "plan_id", "user_id") WHERE source = 'auto';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_reversal_once" ON "commission" ("reversal_of") WHERE source = 'reversal';--> statement-breakpoint
-- The branch a job, a person and a stock location belong to. job.location_id already exists on crm-fieldservice,
-- crm-landscaping and crm-basic (their 0005 added it; schema.ts never declared it); IF NOT EXISTS makes this a no-op there.
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "location_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_location_id_idx" ON "job" ("location_id");--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN IF NOT EXISTS "location_id" text;--> statement-breakpoint
ALTER TABLE "inventory_location" ADD COLUMN IF NOT EXISTS "branch_id" text;
