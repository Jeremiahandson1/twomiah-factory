CREATE TABLE IF NOT EXISTS "salon_closed_period" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stylist_id" text,
	"stylist_member_id" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"reason" text,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_closed_period" ADD CONSTRAINT "salon_closed_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_time_off" ADD CONSTRAINT "salon_time_off_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_time_off" ADD CONSTRAINT "salon_time_off_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_time_off" ADD CONSTRAINT "salon_time_off_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_closed_period_company_start_idx" ON "salon_closed_period" USING btree ("company_id","start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_time_off_company_start_idx" ON "salon_time_off" USING btree ("company_id","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_time_off_company_status_idx" ON "salon_time_off" USING btree ("company_id","status");