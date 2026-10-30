CREATE TABLE IF NOT EXISTS "route_billing_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"group_by" text DEFAULT 'none' NOT NULL,
	"invoice_count" integer DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"undone_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_visit_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"invoice_line_item_id" text,
	"batch_id" text,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_route" ADD COLUMN "billing_mode" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_billing_batch" ADD CONSTRAINT "route_billing_batch_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_billing_batch" ADD CONSTRAINT "route_billing_batch_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_invoice_line_item_id_invoice_line_item_id_fk" FOREIGN KEY ("invoice_line_item_id") REFERENCES "public"."invoice_line_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_visit_invoice" ADD CONSTRAINT "route_visit_invoice_batch_id_route_billing_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."route_billing_batch"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_billing_batch_company_id_idx" ON "route_billing_batch" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_visit_invoice_job_idx" ON "route_visit_invoice" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_visit_invoice_invoice_id_idx" ON "route_visit_invoice" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_visit_invoice_company_id_idx" ON "route_visit_invoice" USING btree ("company_id");