ALTER TABLE "inspection" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_by" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_ip" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signed_user_agent" text;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "inspection" ADD COLUMN "signature_hash" text;--> statement-breakpoint
ALTER TABLE "inspection_template" ADD COLUMN "auto_attach" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspection_template" ADD COLUMN "job_types" json DEFAULT '[]'::json NOT NULL;