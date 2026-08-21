CREATE TABLE IF NOT EXISTS "service_menu" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'hair' NOT NULL,
	"description" text,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"price" numeric(10, 2),
	"price_is_from" boolean DEFAULT false NOT NULL,
	"rebook_interval_days" integer,
	"requires_patch_test" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE cascade,
	"preferred_stylist_id" text REFERENCES "user"("id") ON DELETE set null,
	"hair_type" text,
	"scalp_notes" text,
	"allergies" text,
	"patch_test_at" date,
	"preferences" text,
	"pronouns" text,
	"birthday" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text REFERENCES "contact"("id") ON DELETE set null,
	"stylist_id" text REFERENCES "user"("id") ON DELETE set null,
	"service_id" text REFERENCES "service_menu"("id") ON DELETE set null,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"station" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"checked_in_at" timestamp,
	"quoted_price" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_record" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE cascade,
	"appointment_id" text REFERENCES "appointment"("id") ON DELETE set null,
	"stylist_id" text REFERENCES "user"("id") ON DELETE set null,
	"service_id" text REFERENCES "service_menu"("id") ON DELETE set null,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"formula" json DEFAULT '[]'::json NOT NULL,
	"developer_volume" text,
	"processing_min" integer,
	"products_used" text,
	"result" text,
	"photo_before" text,
	"photo_after" text,
	"price_charged" numeric(10, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(10, 2),
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"credits_total" integer,
	"included_services" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "membership_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL REFERENCES "membership_plan"("id") ON DELETE cascade,
	"contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE cascade,
	"status" text DEFAULT 'active' NOT NULL,
	"credits_remaining" integer,
	"start_date" date,
	"renews_at" date,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_menu_company_id_idx" ON "service_menu" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_profile_company_id_idx" ON "client_profile" ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_profile_contact_id_key" ON "client_profile" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_company_id_idx" ON "appointment" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_contact_id_idx" ON "appointment" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_start_idx" ON "appointment" ("start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_record_company_id_idx" ON "service_record" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_record_contact_id_idx" ON "service_record" ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_record_performed_idx" ON "service_record" ("performed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_plan_company_id_idx" ON "membership_plan" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_enrollment_company_id_idx" ON "membership_enrollment" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "membership_enrollment_contact_id_idx" ON "membership_enrollment" ("contact_id");
