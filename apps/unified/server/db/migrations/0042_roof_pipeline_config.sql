CREATE TABLE IF NOT EXISTS "roof_pipeline_config" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"config" json DEFAULT '{}'::json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_pipeline_config" ADD CONSTRAINT "roof_pipeline_config_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roof_pipeline_config_company_id_idx" ON "roof_pipeline_config" USING btree ("company_id");