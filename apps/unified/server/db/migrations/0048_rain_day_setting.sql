CREATE TABLE IF NOT EXISTS "landscaping_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"rain_day_skip_sundays" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "landscaping_setting" ADD CONSTRAINT "landscaping_setting_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "landscaping_setting_company_id_idx" ON "landscaping_setting" USING btree ("company_id");