ALTER TABLE "store_settings" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "email_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_part" text NOT NULL,
	"routing_mode" text DEFAULT 'forward' NOT NULL,
	"forward_to" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "email_alias_local_part_idx" ON "email_alias" USING btree ("local_part");