-- Branches and commissions for the general-contractor CRM. (multi_location, commission_tracking)
--
-- The same three tables crm-fieldservice, crm-landscaping and crm-basic created in their migration 0005,
-- column for column: one shared module (packages/tenant-backend/src/{locations,commissions}) reads them in all
-- four CRMs. Additive and idempotent: IF NOT EXISTS throughout, and each constraint added only when missing,
-- because db/reconcile.ts can create the tables from schema.ts before this runs on a tenant that boots twice.
CREATE TABLE IF NOT EXISTS "location" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"email" text,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"service_area_radius_miles" integer DEFAULT 25 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"manager_user_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_company_id_idx" ON "location" ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "location_company_code_unique" ON "location" ("company_id", "code");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "location" ADD CONSTRAINT "location_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"plan_type" text NOT NULL,
	"flat_rate_amount" numeric(10, 2),
	"percent_rate" numeric(5, 2),
	"tiers" json,
	"applies_to_role" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_plan_company_id_idx" ON "commission_plan" ("company_id");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_plan" ADD CONSTRAINT "commission_plan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"plan_id" text,
	"user_id" text NOT NULL,
	"job_id" text,
	"invoice_id" text,
	"base_amount" numeric(12, 2) NOT NULL,
	"rate_applied" numeric(5, 2),
	"commission_amount" numeric(12, 2) NOT NULL,
	"earned_at" timestamp DEFAULT now() NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_company_id_idx" ON "commission" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_user_id_idx" ON "commission" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_status_idx" ON "commission" ("status");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission" ADD CONSTRAINT "commission_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission" ADD CONSTRAINT "commission_plan_id_commission_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."commission_plan"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
