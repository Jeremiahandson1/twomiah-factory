CREATE TABLE IF NOT EXISTS "bar_availability_date" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"mode" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"decided_by_name" text,
	"decided_at" timestamp,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_declared_tip" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_day" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"original_cents" integer NOT NULL,
	"declared_via" text DEFAULT 'web' NOT NULL,
	"note" text,
	"corrected_by_name" text,
	"corrected_at" timestamp,
	"declared_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tip_import" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"business_day" text NOT NULL,
	"external_staff_id" text,
	"tip_cents" integer NOT NULL,
	"paid_at" timestamp NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tip_source" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text,
	"external_account_id" text,
	"location_id" text,
	"credentials_enc" text NOT NULL,
	"token_expires_at" timestamp,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_import_at" timestamp,
	"connected_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bar_tip_staff_map" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_staff_id" text NOT NULL,
	"external_name" text,
	"external_email" text,
	"user_id" text,
	"matched_by" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bar_shift_request" ADD COLUMN "shift_stamp" text;--> statement-breakpoint
ALTER TABLE "bar_shift_request" ADD COLUMN "with_stamp" text;--> statement-breakpoint
ALTER TABLE "bar_tip_payout" ADD COLUMN "declared_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bar_tip_payout" ADD COLUMN "imported_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_availability_date" ADD CONSTRAINT "bar_availability_date_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_availability_date" ADD CONSTRAINT "bar_availability_date_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_declared_tip" ADD CONSTRAINT "bar_declared_tip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_declared_tip" ADD CONSTRAINT "bar_declared_tip_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_import" ADD CONSTRAINT "bar_tip_import_source_id_bar_tip_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."bar_tip_source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_import" ADD CONSTRAINT "bar_tip_import_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_source" ADD CONSTRAINT "bar_tip_source_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_staff_map" ADD CONSTRAINT "bar_tip_staff_map_source_id_bar_tip_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."bar_tip_source"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_staff_map" ADD CONSTRAINT "bar_tip_staff_map_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_staff_map" ADD CONSTRAINT "bar_tip_staff_map_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_availability_date_key" ON "bar_availability_date" USING btree ("company_id","user_id","day","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_availability_date_day_idx" ON "bar_availability_date" USING btree ("company_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_declared_tip_day_user_key" ON "bar_declared_tip" USING btree ("company_id","business_day","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_import_payment_key" ON "bar_tip_import" USING btree ("company_id","provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bar_tip_import_day_idx" ON "bar_tip_import" USING btree ("company_id","business_day");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_source_provider_key" ON "bar_tip_source" USING btree ("company_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_staff_map_key" ON "bar_tip_staff_map" USING btree ("source_id","external_staff_id");