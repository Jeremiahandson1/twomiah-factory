CREATE TABLE IF NOT EXISTS "care_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"service_type" text,
	"frequency" text,
	"care_goals" text,
	"special_instructions" text,
	"precautions" text,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hourly_rate" numeric(8, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_care_type_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"caregiver_id" text NOT NULL,
	"care_type_id" text NOT NULL,
	"hourly_rate" numeric(8, 2),
	"overtime_rate" numeric(8, 2),
	"holiday_rate" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certification_records" (
	"id" text PRIMARY KEY NOT NULL,
	"caregiver_id" text NOT NULL,
	"certification_type" text NOT NULL,
	"issuing_body" text,
	"issue_date" date,
	"expiry_date" date,
	"document_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"caregiver_id" text,
	"incident_type" text NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"involved_parties" text,
	"action_taken" text,
	"investigation_status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"reported_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medications" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"dosage" text,
	"frequency" text,
	"route" text,
	"indication" text,
	"prescribed_by" text,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medication_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"medication_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"administered_at" timestamp NOT NULL,
	"status" text DEFAULT 'given' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text,
	"requester_id" text NOT NULL,
	"target_id" text,
	"client_id" text,
	"shift_date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_records" (
	"id" text PRIMARY KEY NOT NULL,
	"caregiver_id" text NOT NULL,
	"training_name" text NOT NULL,
	"provider" text,
	"completed_date" date,
	"expiry_date" date,
	"hours_completed" numeric(5, 1),
	"certificate_url" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mileage_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"caregiver_id" text NOT NULL,
	"date" date NOT NULL,
	"start_location" text,
	"end_location" text,
	"miles" numeric(7, 2) NOT NULL,
	"rate_per_mile" numeric(5, 3) DEFAULT '0.670',
	"amount" numeric(8, 2),
	"client_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospect_appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time,
	"notes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_care_type_rates" ADD CONSTRAINT "caregiver_care_type_rates_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_care_type_rates" ADD CONSTRAINT "caregiver_care_type_rates_care_type_id_care_types_id_fk" FOREIGN KEY ("care_type_id") REFERENCES "care_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_records" ADD CONSTRAINT "certification_records_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medications" ADD CONSTRAINT "medications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_appointments" ADD CONSTRAINT "prospect_appointments_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "lead"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_appointments" ADD CONSTRAINT "prospect_appointments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plans_client_id_idx" ON "care_plans" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_care_type_rates_caregiver_idx" ON "caregiver_care_type_rates" USING btree ("caregiver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_records_caregiver_idx" ON "certification_records" USING btree ("caregiver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_status_idx" ON "incidents" USING btree ("investigation_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medications_client_idx" ON "medications" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_swaps_status_idx" ON "shift_swaps" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_caregiver_idx" ON "training_records" USING btree ("caregiver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mileage_entries_caregiver_idx" ON "mileage_entries" USING btree ("caregiver_id");
