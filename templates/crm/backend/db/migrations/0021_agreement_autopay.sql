ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "autopay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "payment_method_id" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "last_billed_at" timestamp;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "next_bill_date" timestamp;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "autopay_last_error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_agreement_next_bill_date_idx" ON "service_agreement" ("next_bill_date");
