CREATE TABLE IF NOT EXISTS "bar_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dow" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_shift_request" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"shift_id" text NOT NULL,
	"with_shift_id" text,
	"from_user_id" text NOT NULL,
	"to_user_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"decided_by_name" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_availability" ADD CONSTRAINT "bar_availability_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_availability" ADD CONSTRAINT "bar_availability_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_shift_request" ADD CONSTRAINT "bar_shift_request_shift_id_bar_schedule_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."bar_schedule_shift"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_shift_request" ADD CONSTRAINT "bar_shift_request_with_shift_id_bar_schedule_shift_id_fk" FOREIGN KEY ("with_shift_id") REFERENCES "public"."bar_schedule_shift"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_shift_request" ADD CONSTRAINT "bar_shift_request_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_shift_request" ADD CONSTRAINT "bar_shift_request_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_shift_request" ADD CONSTRAINT "bar_shift_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_availability_user_idx" ON "bar_availability" USING btree ("company_id","user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_shift_request_company_idx" ON "bar_shift_request" USING btree ("company_id","status");