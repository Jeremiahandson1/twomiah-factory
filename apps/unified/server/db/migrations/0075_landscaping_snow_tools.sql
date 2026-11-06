ALTER TABLE "landscaping_setting" ADD COLUMN "snow_auto_start" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "depth_bands" json;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "require_photos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "salt_unit" text;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "salt_per_unit_rate" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "salt_unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "material_markup_pct" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "base_minutes" integer;--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "minutes_per_inch" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "salt_quantity" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "computed_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "overridden_by_id" text;--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "overridden_at" timestamp;--> statement-breakpoint
ALTER TABLE "snow_storm" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "snow_storm" ADD COLUMN "expected_inches" numeric(5, 2);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_overridden_by_id_user_id_fk" FOREIGN KEY ("overridden_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
