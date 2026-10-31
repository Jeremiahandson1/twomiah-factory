CREATE TABLE IF NOT EXISTS "family_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"family_member_id" text NOT NULL,
	"kind" text NOT NULL,
	"visit_date" text,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"task_id" text,
	"handled_by_id" text,
	"handled_note" text,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "family_visit_text_key";--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_text_consent_wording" text;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_text_optout_at" timestamp;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_email_optin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_email_optin_at" timestamp;--> statement-breakpoint
ALTER TABLE "family_visit_text" ADD COLUMN "channel" text DEFAULT 'sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "family_visit_text" ADD COLUMN "reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_request" ADD CONSTRAINT "family_request_handled_by_id_user_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_request_company_idx" ON "family_request" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_request_client_idx" ON "family_request" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_visit_text_key" ON "family_visit_text" USING btree ("time_entry_id","family_member_id","event","channel");