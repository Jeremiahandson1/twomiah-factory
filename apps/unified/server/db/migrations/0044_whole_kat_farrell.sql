ALTER TABLE "caregiver_profiles" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "languages" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "required_skills" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "preferred_caregiver_gender" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "preferred_language" text;