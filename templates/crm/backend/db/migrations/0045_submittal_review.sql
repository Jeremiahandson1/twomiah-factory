-- Submittals keep what the form asks for and what the reviewer said. (Launch list, 10/17)
--
-- The office routes wrote reviewNotes, approvedAt and submittedAt — names this table never had — through `as any`,
-- so every approval, rejection and revise-and-resubmit lost its notes and its dates without an error. The form's
-- type, priority and assignee had no columns either and were run together into `notes`. Additive and idempotent:
-- db/reconcile.ts may have added a column from schema.ts already.
ALTER TABLE "submittal" ADD COLUMN IF NOT EXISTS "submittal_type" text DEFAULT 'product_data' NOT NULL;--> statement-breakpoint
ALTER TABLE "submittal" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "submittal" ADD COLUMN IF NOT EXISTS "assigned_to" text;--> statement-breakpoint
ALTER TABLE "submittal" ADD COLUMN IF NOT EXISTS "review_notes" text;
