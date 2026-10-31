CREATE TABLE IF NOT EXISTS "event_bank_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_payment_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"stripe_account" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'awaiting' NOT NULL,
	"keep_for_autopay" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp,
	"consent_ip" text,
	"consent_text" text,
	"bank_name" text,
	"last4" text,
	"verify_url" text,
	"failure_code" text,
	"failure_message" text,
	"initiated_at" timestamp,
	"settled_at" timestamp,
	"failed_at" timestamp,
	"notice_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_autopay" ADD COLUMN "method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_autopay" ADD COLUMN "setup_method" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_bank_payment" ADD CONSTRAINT "event_bank_payment_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_bank_payment" ADD CONSTRAINT "event_bank_payment_event_payment_id_event_payment_id_fk" FOREIGN KEY ("event_payment_id") REFERENCES "public"."event_payment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_bank_payment" ADD CONSTRAINT "event_bank_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_bank_payment_intent_idx" ON "event_bank_payment" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_bank_payment_event_payment_idx" ON "event_bank_payment" USING btree ("event_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_bank_payment_company_id_idx" ON "event_bank_payment" USING btree ("company_id");