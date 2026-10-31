CREATE TABLE IF NOT EXISTS "autopay_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"client_id" text NOT NULL,
	"charge_on" date NOT NULL,
	"amount_cents" integer,
	"label" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "schedule_id" text;--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "reminders_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "last_reminder_at" timestamp;--> statement-breakpoint
ALTER TABLE "autopay_attempt" ADD COLUMN "receipt_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "method" text DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "mandate_id" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "saved_by" text;--> statement-breakpoint
ALTER TABLE "client_autopay" ADD COLUMN "expiry_warned_for" text;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "can_manage_payments" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_schedule" ADD CONSTRAINT "autopay_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_schedule" ADD CONSTRAINT "autopay_schedule_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "autopay_schedule" ADD CONSTRAINT "autopay_schedule_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopay_schedule_due_idx" ON "autopay_schedule" USING btree ("company_id","status","charge_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autopay_schedule_invoice_idx" ON "autopay_schedule" USING btree ("invoice_id");