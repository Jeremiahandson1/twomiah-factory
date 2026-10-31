CREATE TABLE IF NOT EXISTS "event_marketing_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"month" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_report_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"report" text NOT NULL,
	"frequency" text NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"recipients" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_marketing_spend" ADD CONSTRAINT "event_marketing_spend_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_report_schedule" ADD CONSTRAINT "event_report_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_marketing_spend_once_idx" ON "event_marketing_spend" USING btree ("company_id","source","month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_report_schedule_company_id_idx" ON "event_report_schedule" USING btree ("company_id");