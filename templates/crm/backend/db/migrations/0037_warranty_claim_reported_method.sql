ALTER TABLE "warranty_claim" ADD COLUMN IF NOT EXISTS "reported_method" text;--> statement-breakpoint
ALTER TABLE "warranty_claim" ADD COLUMN IF NOT EXISTS "reported_by" text;
