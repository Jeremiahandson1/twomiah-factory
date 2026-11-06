CREATE TABLE IF NOT EXISTS "plan_takeoff" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"site_id" text,
	"contact_id" text,
	"name" text NOT NULL,
	"file_key" text NOT NULL,
	"file_type" text NOT NULL,
	"file_name" text,
	"page" integer DEFAULT 1 NOT NULL,
	"page_aspect" numeric(8, 5),
	"feet_per_width" numeric(14, 4),
	"items" json DEFAULT '[]'::json NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_takeoff" ADD CONSTRAINT "plan_takeoff_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_takeoff" ADD CONSTRAINT "plan_takeoff_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_takeoff" ADD CONSTRAINT "plan_takeoff_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plan_takeoff" ADD CONSTRAINT "plan_takeoff_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_takeoff_company_id_idx" ON "plan_takeoff" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_takeoff_site_id_idx" ON "plan_takeoff" USING btree ("site_id");