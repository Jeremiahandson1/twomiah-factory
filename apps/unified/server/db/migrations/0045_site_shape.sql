CREATE TABLE IF NOT EXISTS "site_shape" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"site_id" text NOT NULL,
	"area_type" text NOT NULL,
	"mode" text DEFAULT 'add' NOT NULL,
	"label" text,
	"path" json NOT NULL,
	"area_sqft" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_shape" ADD CONSTRAINT "site_shape_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_shape" ADD CONSTRAINT "site_shape_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_shape_site_id_idx" ON "site_shape" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_shape_company_id_idx" ON "site_shape" USING btree ("company_id");