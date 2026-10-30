CREATE TABLE IF NOT EXISTS "salon_gift_card" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invoice_id" text,
	"purchaser_contact_id" text,
	"purchaser_name" text,
	"purchaser_email" text,
	"recipient_name" text,
	"recipient_email" text,
	"message" text,
	"sold_by_name" text,
	"voided_at" timestamp,
	"void_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "salon_gift_card_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"card_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" text,
	"by_name" text,
	"note" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card" ADD CONSTRAINT "salon_gift_card_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card" ADD CONSTRAINT "salon_gift_card_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card" ADD CONSTRAINT "salon_gift_card_purchaser_contact_id_contact_id_fk" FOREIGN KEY ("purchaser_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card_ledger" ADD CONSTRAINT "salon_gift_card_ledger_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "salon_gift_card_ledger" ADD CONSTRAINT "salon_gift_card_ledger_card_id_salon_gift_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."salon_gift_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_gift_card_company_code_key" ON "salon_gift_card" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "salon_gift_card_company_invoice_key" ON "salon_gift_card" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_gift_card_ledger_card_idx" ON "salon_gift_card_ledger" USING btree ("card_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "salon_gift_card_ledger_invoice_idx" ON "salon_gift_card_ledger" USING btree ("company_id","invoice_id");