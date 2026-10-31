CREATE TABLE IF NOT EXISTS "open_shift_pickup" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text,
	"shift_date" date NOT NULL,
	"bonus_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cost_points" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_point" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"reference" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"reward_item_id" text,
	"name" text NOT NULL,
	"points" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"handled_by_id" text,
	"handled_note" text,
	"handled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "caregiver_availability" ADD COLUMN "hours_wanted" integer;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD COLUMN "bonus_pay" numeric(10, 2) DEFAULT '0';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_pickup" ADD CONSTRAINT "open_shift_pickup_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_pickup" ADD CONSTRAINT "open_shift_pickup_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_pickup" ADD CONSTRAINT "open_shift_pickup_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_item" ADD CONSTRAINT "reward_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_point" ADD CONSTRAINT "reward_point_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_point" ADD CONSTRAINT "reward_point_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_reward_item_id_reward_item_id_fk" FOREIGN KEY ("reward_item_id") REFERENCES "public"."reward_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_handled_by_id_user_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_shift_pickup_shift_idx" ON "open_shift_pickup" USING btree ("open_shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_pickup_caregiver_idx" ON "open_shift_pickup" USING btree ("company_id","caregiver_id","shift_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_item_company_idx" ON "reward_item" USING btree ("company_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reward_point_ref_idx" ON "reward_point" USING btree ("company_id","caregiver_id","kind","reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_point_caregiver_idx" ON "reward_point" USING btree ("company_id","caregiver_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_redemption_company_idx" ON "reward_redemption" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_redemption_caregiver_idx" ON "reward_redemption" USING btree ("caregiver_id");