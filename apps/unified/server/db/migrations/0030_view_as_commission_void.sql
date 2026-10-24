ALTER TABLE "audit_log" ADD COLUMN "impersonator_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "impersonator_email" text;--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "commission" ADD COLUMN "voided_by_id" text;