ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "hin" text;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "beam_ft" numeric(5, 1);
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "draft_ft" numeric(5, 1);
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "hull_material" text;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "engine_type" text;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "engine_count" integer;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "engine_hp" integer;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "fuel_capacity_gal" integer;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "max_persons" integer;
--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN IF NOT EXISTS "trailer_included" boolean;
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "feed_token" text;
