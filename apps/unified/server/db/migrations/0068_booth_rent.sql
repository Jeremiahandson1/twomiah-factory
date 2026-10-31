CREATE TABLE IF NOT EXISTS "booth_rent_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"renter_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"card_id" text,
	"period" date NOT NULL,
	"attempt" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"payment_intent_id" text,
	"failure_message" text,
	"backup_tried" boolean DEFAULT false NOT NULL,
	"retried_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booth_rent_period" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"renter_id" text NOT NULL,
	"period" date NOT NULL,
	"invoice_id" text,
	"amount_cents" integer NOT NULL,
	"status" text NOT NULL,
	"waived_reason" text,
	"waived_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booth_renter" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"team_member_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rent_cents" integer NOT NULL,
	"frequency" text NOT NULL,
	"due_weekday" integer,
	"due_day" integer,
	"start_date" date NOT NULL,
	"next_due" date,
	"ended_on" date,
	"auto_charge" boolean DEFAULT false NOT NULL,
	"auto_charge_consent_at" timestamp,
	"auto_charge_consent_via" text,
	"auto_charge_consent_user_id" text,
	"paused_for_payment_at" timestamp,
	"card_token" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_renter_id_booth_renter_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."booth_renter"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_card_id_client_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."client_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_charge" ADD CONSTRAINT "booth_rent_charge_retried_by_user_id_user_id_fk" FOREIGN KEY ("retried_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_renter_id_booth_renter_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."booth_renter"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_rent_period" ADD CONSTRAINT "booth_rent_period_waived_by_user_id_user_id_fk" FOREIGN KEY ("waived_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_team_member_id_team_member_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booth_renter" ADD CONSTRAINT "booth_renter_auto_charge_consent_user_id_user_id_fk" FOREIGN KEY ("auto_charge_consent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_rent_charge_invoice_attempt_idx" ON "booth_rent_charge" USING btree ("invoice_id","attempt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_charge_company_idx" ON "booth_rent_charge" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_charge_renter_idx" ON "booth_rent_charge" USING btree ("renter_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_rent_period_renter_period_idx" ON "booth_rent_period" USING btree ("renter_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_period_invoice_idx" ON "booth_rent_period" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_rent_period_company_idx" ON "booth_rent_period" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_renter_company_member_idx" ON "booth_renter" USING btree ("company_id","team_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booth_renter_company_status_idx" ON "booth_renter" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booth_renter_card_token_idx" ON "booth_renter" USING btree ("card_token");