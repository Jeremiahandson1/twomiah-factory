CREATE TABLE IF NOT EXISTS "event_form_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "campaign_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_form_campaign" ADD CONSTRAINT "event_form_campaign_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_form_campaign_token_idx" ON "event_form_campaign" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_form_campaign_company_id_idx" ON "event_form_campaign" USING btree ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event" ADD CONSTRAINT "event_campaign_id_event_form_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."event_form_campaign"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
