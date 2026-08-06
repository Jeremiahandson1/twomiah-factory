CREATE TABLE IF NOT EXISTS "shipping_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"credentials_enc" text NOT NULL,
	"from_address" jsonb,
	"default_parcel" jsonb,
	"connected" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "label_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "label_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "label_purchased_at" timestamptz;
