CREATE TABLE IF NOT EXISTS "financing_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"company_id" text NOT NULL,
	"application_id" text NOT NULL,
	"status" text NOT NULL,
	"lender_status" text,
	"amount" numeric(12, 2),
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "quote_id" text;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "lender_status" text;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "funded_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "funded_at" timestamp;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "payment_id" text;--> statement-breakpoint
ALTER TABLE "financing_application" ADD COLUMN "created_by_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_event" ADD CONSTRAINT "financing_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_event" ADD CONSTRAINT "financing_event_application_id_financing_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."financing_application"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financing_event_provider_event_idx" ON "financing_event" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financing_event_application_id_idx" ON "financing_event" USING btree ("application_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_application" ADD CONSTRAINT "financing_application_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_application" ADD CONSTRAINT "financing_application_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_application" ADD CONSTRAINT "financing_application_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financing_application_quote_id_idx" ON "financing_application" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financing_application_invoice_id_idx" ON "financing_application" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "financing_application_provider_external_idx" ON "financing_application" USING btree ("provider","external_id");