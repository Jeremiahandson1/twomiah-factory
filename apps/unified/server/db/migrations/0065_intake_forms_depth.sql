CREATE TABLE IF NOT EXISTS "intake_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"form_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"channel" text,
	"reason" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "membership_plan_ids" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "valid_for_days" integer;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "before_confirm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_form" ADD COLUMN "signature" text DEFAULT 'typed' NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "files" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "signature_key" text;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "signature_type" text;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "expires_on" text;--> statement-breakpoint
ALTER TABLE "intake_response" ADD COLUMN "via" text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_form_id_intake_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_form"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_request" ADD CONSTRAINT "intake_request_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intake_request_token_idx" ON "intake_request" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_request_form_idx" ON "intake_request" USING btree ("company_id","form_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_request_contact_idx" ON "intake_request" USING btree ("company_id","contact_id");