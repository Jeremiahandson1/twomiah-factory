CREATE TABLE IF NOT EXISTS "commission_disclaimer_acceptance" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"version" integer NOT NULL,
	"disclaimer_text" text NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roof_money_setting" ADD COLUMN "commission_disclaimer" text;--> statement-breakpoint
ALTER TABLE "roof_money_setting" ADD COLUMN "commission_disclaimer_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "commission_disclaimer_acceptance" ADD CONSTRAINT "commission_disclaimer_acceptance_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_disclaimer_acceptance_user_version_idx" ON "commission_disclaimer_acceptance" USING btree ("user_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_disclaimer_acceptance_company_id_idx" ON "commission_disclaimer_acceptance" USING btree ("company_id");