ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "audience_type" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "audience_filter" json;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "unsubscribe_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "email_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "email_opt_out_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_recipient') THEN
    ALTER TABLE "email_recipient" ADD COLUMN IF NOT EXISTS "open_count" integer DEFAULT 0 NOT NULL;
    ALTER TABLE "email_recipient" ADD COLUMN IF NOT EXISTS "click_count" integer DEFAULT 0 NOT NULL;
    ALTER TABLE "email_recipient" ADD COLUMN IF NOT EXISTS "unsubscribed_at" timestamp;
    CREATE INDEX IF NOT EXISTS "email_recipient_campaign_id_idx" ON "email_recipient" ("campaign_id");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sequence_enrollment') THEN
    ALTER TABLE "sequence_enrollment" ADD COLUMN IF NOT EXISTS "last_email_at" timestamp;
  END IF;
END $$;
