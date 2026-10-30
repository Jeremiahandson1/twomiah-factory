CREATE TABLE IF NOT EXISTS "canvass_territory" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"boundary" json,
	"zips" json DEFAULT '[]'::json NOT NULL,
	"storm_event_id" text,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvass_territory_rep" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"territory_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storm_event" ADD COLUMN "path" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_storm_event_id_storm_event_id_fk" FOREIGN KEY ("storm_event_id") REFERENCES "public"."storm_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory" ADD CONSTRAINT "canvass_territory_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory_rep" ADD CONSTRAINT "canvass_territory_rep_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory_rep" ADD CONSTRAINT "canvass_territory_rep_territory_id_canvass_territory_id_fk" FOREIGN KEY ("territory_id") REFERENCES "public"."canvass_territory"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvass_territory_rep" ADD CONSTRAINT "canvass_territory_rep_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvass_territory_company_id_idx" ON "canvass_territory" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvass_territory_rep_company_id_idx" ON "canvass_territory_rep" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "canvass_territory_rep_territory_user_uniq" ON "canvass_territory_rep" USING btree ("territory_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvass_territory_rep_user_id_idx" ON "canvass_territory_rep" USING btree ("user_id");