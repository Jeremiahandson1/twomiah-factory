CREATE TABLE IF NOT EXISTS "offer_code" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"code" text NOT NULL,
	"source" text NOT NULL,
	"send_id" text,
	"discount_type" text NOT NULL,
	"value" integer NOT NULL,
	"expires_on" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"used_at" timestamp,
	"used_invoice_id" text,
	"discount_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_members" ADD COLUMN "tier_min" integer;--> statement-breakpoint
ALTER TABLE "loyalty_members" ADD COLUMN "tier_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_code" ADD CONSTRAINT "offer_code_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_code" ADD CONSTRAINT "offer_code_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offer_code" ADD CONSTRAINT "offer_code_used_invoice_id_invoice_id_fk" FOREIGN KEY ("used_invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_code_company_code" ON "offer_code" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offer_code_used_invoice" ON "offer_code" USING btree ("used_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_code_company_created_idx" ON "offer_code" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_code_contact_idx" ON "offer_code" USING btree ("contact_id");