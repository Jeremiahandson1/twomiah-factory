CREATE TABLE IF NOT EXISTS "sms_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"phone" text NOT NULL,
	"source" text NOT NULL,
	"page" text,
	"ip" text,
	"wording" text,
	"given_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_consent" ADD CONSTRAINT "sms_consent_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_consent_company_phone_idx" ON "sms_consent" USING btree ("company_id","phone");