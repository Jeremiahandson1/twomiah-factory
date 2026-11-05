CREATE TABLE IF NOT EXISTS "quote_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"body" json NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lost_note" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lost_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "site_visit_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "site_visit_event_id" text;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_by" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_ip" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_user_agent" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signature_hash" text;--> statement-breakpoint
ALTER TABLE "inspection_template" ADD COLUMN "auto_attach" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_template" ADD COLUMN "job_types" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "vendor_bill" ADD COLUMN "cost_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_template" ADD CONSTRAINT "quote_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_template" ADD CONSTRAINT "quote_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_template_company_id_idx" ON "quote_template" USING btree ("company_id");