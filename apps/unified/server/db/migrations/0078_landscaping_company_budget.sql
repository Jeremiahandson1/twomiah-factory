CREATE TABLE IF NOT EXISTS "company_budget" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"year" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"method" text DEFAULT 'mors' NOT NULL,
	"profit_pct" numeric(6, 2) DEFAULT '10' NOT NULL,
	"labor_burden_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"overhead_burden_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"overtime_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"overtime_multiplier" numeric(4, 2) DEFAULT '1.5' NOT NULL,
	"unbillable_pct" numeric(6, 2) DEFAULT '0' NOT NULL,
	"materials_markup_pct" numeric(6, 2) DEFAULT '10' NOT NULL,
	"equipment_markup_pct" numeric(6, 2) DEFAULT '25' NOT NULL,
	"subs_markup_pct" numeric(6, 2) DEFAULT '5' NOT NULL,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"activated_at" timestamp,
	"activated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_budget" ADD CONSTRAINT "company_budget_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_budget" ADD CONSTRAINT "company_budget_activated_by_id_user_id_fk" FOREIGN KEY ("activated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_budget_company_id_idx" ON "company_budget" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_budget_active_year_idx" ON "company_budget" USING btree ("company_id","year") WHERE status = 'active';