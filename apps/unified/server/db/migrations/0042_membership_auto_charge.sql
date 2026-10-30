CREATE TABLE IF NOT EXISTS "membership_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"card_id" text,
	"period" date NOT NULL,
	"attempt" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"payment_intent_id" text,
	"failure_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "auto_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "auto_charge_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "membership_enrollment" ADD COLUMN "auto_charge_consent_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_enrollment_id_membership_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."membership_enrollment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_charge" ADD CONSTRAINT "membership_charge_card_id_client_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."client_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "membership_charge_invoice_attempt_idx" ON "membership_charge" USING btree ("invoice_id","attempt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_charge_company_id_idx" ON "membership_charge" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_charge_enrollment_id_idx" ON "membership_charge" USING btree ("enrollment_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership_enrollment" ADD CONSTRAINT "membership_enrollment_auto_charge_consent_user_id_user_id_fk" FOREIGN KEY ("auto_charge_consent_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
