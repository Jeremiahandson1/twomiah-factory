CREATE TABLE IF NOT EXISTS "recurring_route_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"assigned_to_id" text,
	"estimated_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"start_time" text DEFAULT '08:00' NOT NULL,
	"billing_mode" text,
	"season_start" text,
	"season_end" text,
	"notes" text,
	"stops" json DEFAULT '[]'::json NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_template" ADD CONSTRAINT "recurring_route_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_template" ADD CONSTRAINT "recurring_route_template_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_route_template" ADD CONSTRAINT "recurring_route_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_route_template_company_id_idx" ON "recurring_route_template" USING btree ("company_id");