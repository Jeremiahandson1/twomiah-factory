CREATE TABLE IF NOT EXISTS "call_tracking_visit" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tracking_number_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"source" text,
	"medium" text,
	"campaign" text,
	"keyword" text,
	"landing_page" text,
	"referrer" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracking_number" ADD COLUMN "swap_source" text;--> statement-breakpoint
ALTER TABLE "tracking_number" ADD COLUMN "in_pool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_tracking_visit" ADD CONSTRAINT "call_tracking_visit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_tracking_visit" ADD CONSTRAINT "call_tracking_visit_tracking_number_id_tracking_number_id_fk" FOREIGN KEY ("tracking_number_id") REFERENCES "public"."tracking_number"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_tracking_visit_number_idx" ON "call_tracking_visit" USING btree ("tracking_number_id","last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_tracking_visit_visitor_idx" ON "call_tracking_visit" USING btree ("company_id","visitor_id","last_seen_at");