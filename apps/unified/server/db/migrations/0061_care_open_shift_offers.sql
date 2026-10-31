CREATE TABLE IF NOT EXISTS "open_shift_message" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"channel" text NOT NULL,
	"target" text,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shift_response" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"response" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN "respond_by" timestamp;--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN "series_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_message" ADD CONSTRAINT "open_shift_message_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_message" ADD CONSTRAINT "open_shift_message_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_message" ADD CONSTRAINT "open_shift_message_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_response" ADD CONSTRAINT "open_shift_response_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_response" ADD CONSTRAINT "open_shift_response_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_response" ADD CONSTRAINT "open_shift_response_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_message_shift_idx" ON "open_shift_message" USING btree ("open_shift_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_message_company_idx" ON "open_shift_message" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_shift_response_shift_caregiver_idx" ON "open_shift_response" USING btree ("open_shift_id","caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_response_company_idx" ON "open_shift_response" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_series_idx" ON "open_shifts" USING btree ("series_id");