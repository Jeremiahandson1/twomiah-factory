CREATE TABLE IF NOT EXISTS "patient" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL REFERENCES "contact"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"species" text DEFAULT 'dog' NOT NULL,
	"breed" text,
	"sex" text,
	"spayed_neutered" boolean DEFAULT false NOT NULL,
	"dob" date,
	"weight_lb" numeric(6, 2),
	"color" text,
	"microchip" text,
	"blood_type" text,
	"insurance_provider" text,
	"insurance_policy" text,
	"allergies" text,
	"alerts" text,
	"rabies_tag" text,
	"photo" text,
	"deceased" boolean DEFAULT false NOT NULL,
	"deceased_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text REFERENCES "patient"("id") ON DELETE set null,
	"owner_id" text REFERENCES "contact"("id") ON DELETE set null,
	"provider_id" text REFERENCES "user"("id") ON DELETE set null,
	"type" text DEFAULT 'wellness' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"room" text,
	"reason" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"checked_in_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL REFERENCES "patient"("id") ON DELETE cascade,
	"appointment_id" text REFERENCES "appointment"("id") ON DELETE set null,
	"provider_id" text REFERENCES "user"("id") ON DELETE set null,
	"visit_date" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"weight_lb" numeric(6, 2),
	"temperature_f" numeric(5, 2),
	"heart_rate" integer,
	"resp_rate" integer,
	"subjective" text,
	"objective" text,
	"assessment" text,
	"plan" text,
	"diagnoses" json DEFAULT '[]'::json NOT NULL,
	"treatments" text,
	"notes" text,
	"total" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vaccination" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL REFERENCES "patient"("id") ON DELETE cascade,
	"visit_id" text REFERENCES "visit"("id") ON DELETE set null,
	"provider_id" text REFERENCES "user"("id") ON DELETE set null,
	"vaccine" text NOT NULL,
	"manufacturer" text,
	"lot_number" text,
	"serial_number" text,
	"site" text,
	"route" text,
	"given_date" date NOT NULL,
	"due_date" date,
	"is_rabies" boolean DEFAULT false NOT NULL,
	"rabies_tag" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prescription" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL REFERENCES "patient"("id") ON DELETE cascade,
	"visit_id" text REFERENCES "visit"("id") ON DELETE set null,
	"prescriber_id" text REFERENCES "user"("id") ON DELETE set null,
	"drug" text NOT NULL,
	"strength" text,
	"form" text,
	"sig" text,
	"quantity" text,
	"refills" integer DEFAULT 0 NOT NULL,
	"is_controlled" boolean DEFAULT false NOT NULL,
	"prescribed_date" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lab_result" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL REFERENCES "patient"("id") ON DELETE cascade,
	"visit_id" text REFERENCES "visit"("id") ON DELETE set null,
	"test_name" text NOT NULL,
	"category" text,
	"result_date" date,
	"status" text DEFAULT 'final' NOT NULL,
	"results" json DEFAULT '{}'::json NOT NULL,
	"summary" text,
	"file_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wellness_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"species" text,
	"monthly_price" numeric(8, 2),
	"annual_price" numeric(8, 2),
	"benefits" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wellness_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL REFERENCES "wellness_plan"("id") ON DELETE cascade,
	"patient_id" text NOT NULL REFERENCES "patient"("id") ON DELETE cascade,
	"owner_id" text REFERENCES "contact"("id") ON DELETE set null,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"start_date" date,
	"renews_at" date,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_company_id_idx" ON "patient" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patient_owner_id_idx" ON "patient" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_company_id_idx" ON "appointment" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_patient_id_idx" ON "appointment" ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_start_idx" ON "appointment" ("start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_company_id_idx" ON "visit" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_patient_id_idx" ON "visit" ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vaccination_company_id_idx" ON "vaccination" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vaccination_patient_id_idx" ON "vaccination" ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vaccination_due_idx" ON "vaccination" ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_company_id_idx" ON "prescription" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prescription_patient_id_idx" ON "prescription" ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_result_company_id_idx" ON "lab_result" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lab_result_patient_id_idx" ON "lab_result" ("patient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_plan_company_id_idx" ON "wellness_plan" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_enrollment_company_id_idx" ON "wellness_enrollment" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellness_enrollment_patient_id_idx" ON "wellness_enrollment" ("patient_id");
