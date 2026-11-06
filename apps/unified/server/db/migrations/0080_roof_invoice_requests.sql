ALTER TABLE "payment" ADD COLUMN "receipt_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "scheduled_text" ADD COLUMN "invoice_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_text" ADD CONSTRAINT "scheduled_text_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
