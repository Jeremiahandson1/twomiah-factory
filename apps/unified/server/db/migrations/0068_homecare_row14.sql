ALTER TABLE "caregiver_profiles" ADD COLUMN "max_travel_miles" integer;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "avoid_attributes" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "required_certifications" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "home_attributes" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "match_must_have" json DEFAULT '[]'::json NOT NULL;