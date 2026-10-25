CREATE TABLE IF NOT EXISTS "scheduled_text" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"conversation_id" text,
	"to_phone" text NOT NULL,
	"body" text NOT NULL,
	"media" json,
	"send_at" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"error" text,
	"message_id" text,
	"created_by_id" text,
	"cancelled_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "bill_kind" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "billed_quote_id" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "credit_applied" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_line_item" ADD COLUMN "quote_line_item_id" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "deposit_type" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "deposit_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "selected" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_text" ADD CONSTRAINT "scheduled_text_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_text" ADD CONSTRAINT "scheduled_text_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_text" ADD CONSTRAINT "scheduled_text_conversation_id_sms_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sms_conversation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_text" ADD CONSTRAINT "scheduled_text_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_text_company_id_idx" ON "scheduled_text" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_text_status_send_at_idx" ON "scheduled_text" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_text_conversation_id_idx" ON "scheduled_text" USING btree ("conversation_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_billed_quote_id_quote_id_fk" FOREIGN KEY ("billed_quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_quote_line_item_id_quote_line_item_id_fk" FOREIGN KEY ("quote_line_item_id") REFERENCES "public"."quote_line_item"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_billed_quote_id_idx" ON "invoice" USING btree ("billed_quote_id");