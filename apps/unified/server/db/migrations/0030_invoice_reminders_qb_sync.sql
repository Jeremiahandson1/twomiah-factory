CREATE TABLE IF NOT EXISTS "reminder_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"sent_to" text,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_sync_failure" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"label" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"trigger" text DEFAULT 'auto' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"customers" integer DEFAULT 0 NOT NULL,
	"invoices" integer DEFAULT 0 NOT NULL,
	"payments" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "qb_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "qb_payment_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_sync_failure" ADD CONSTRAINT "qb_sync_failure_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_sync_run" ADD CONSTRAINT "qb_sync_run_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_log_once_per_step" ON "reminder_log" USING btree ("company_id","kind","subject_id","step");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_log_subject_idx" ON "reminder_log" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "qb_sync_failure_record_uniq" ON "qb_sync_failure" USING btree ("company_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_sync_run_company_started_idx" ON "qb_sync_run" USING btree ("company_id","started_at");