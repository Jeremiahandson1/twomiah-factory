ALTER TABLE "shopper_logins" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shopper_logins" ADD COLUMN "email" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopper_logins_email_idx" ON "shopper_logins" USING btree ("company_id","email","created_at");