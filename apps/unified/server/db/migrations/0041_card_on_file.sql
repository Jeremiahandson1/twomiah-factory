CREATE TABLE IF NOT EXISTS "card_fee_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"appointment_id" text,
	"card_id" text,
	"kind" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"payment_intent_id" text,
	"failure_message" text,
	"charged_by_user_id" text,
	"receipt_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"card_requirement" text DEFAULT 'off' NOT NULL,
	"no_show_fee_amount" numeric(10, 2),
	"no_show_fee_percent" integer,
	"late_cancel_window_minutes" integer,
	"late_cancel_fee_amount" numeric(10, 2),
	"late_cancel_fee_percent" integer,
	"policy_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_card" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"payment_method_id" text NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"consent_at" timestamp NOT NULL,
	"consent_text" text NOT NULL,
	"consent_via" text NOT NULL,
	"consent_user_id" text,
	"removed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_card_id_client_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."client_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_charged_by_user_id_user_id_fk" FOREIGN KEY ("charged_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_policy" ADD CONSTRAINT "card_policy_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_card" ADD CONSTRAINT "client_card_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_card" ADD CONSTRAINT "client_card_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_card" ADD CONSTRAINT "client_card_consent_user_id_user_id_fk" FOREIGN KEY ("consent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_fee_charge_company_idx" ON "card_fee_charge" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_fee_charge_appointment_idx" ON "card_fee_charge" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_fee_charge_contact_idx" ON "card_fee_charge" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_policy_company_id_key" ON "card_policy" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_card_client_idx" ON "client_card" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_card_payment_method_key" ON "client_card" USING btree ("company_id","payment_method_id");