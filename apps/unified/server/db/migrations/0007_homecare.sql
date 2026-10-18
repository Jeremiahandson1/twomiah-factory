CREATE TABLE IF NOT EXISTS "absences" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"reported_by_id" text,
	"coverage_needed" boolean DEFAULT true NOT NULL,
	"coverage_assigned_to" text,
	"notes" text,
	"status" text DEFAULT 'reported' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adl_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"adl_category" text NOT NULL,
	"status" text NOT NULL,
	"assistance_level" text,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"time_entry_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adl_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"adl_category" text NOT NULL,
	"assistance_level" text NOT NULL,
	"frequency" text,
	"special_instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"due_date" timestamp,
	"related_entity_type" text,
	"related_entity_id" text,
	"acknowledged_at" timestamp,
	"acknowledged_by_id" text,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"resolution" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"application_id" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"changed_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"status" text DEFAULT 'new' NOT NULL,
	"desired_position" text,
	"desired_pay_rate" numeric(8, 2),
	"available_start_date" date,
	"experience" text,
	"has_cna" boolean DEFAULT false NOT NULL,
	"has_lpn" boolean DEFAULT false NOT NULL,
	"has_rn" boolean DEFAULT false NOT NULL,
	"has_cpr" boolean DEFAULT false NOT NULL,
	"has_first_aid" boolean DEFAULT false NOT NULL,
	"references" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"interview_notes" text,
	"hired_user_id" text,
	"date_of_birth" date,
	"has_drivers_license" boolean DEFAULT false NOT NULL,
	"has_transportation" boolean DEFAULT false NOT NULL,
	"legal_to_work" boolean DEFAULT false NOT NULL,
	"willing_background_check" boolean DEFAULT false NOT NULL,
	"felony_conviction" boolean DEFAULT false NOT NULL,
	"felony_explanation" text,
	"years_experience" integer DEFAULT 0 NOT NULL,
	"cna_license" text,
	"certifications" json DEFAULT '[]'::json NOT NULL,
	"previous_employer" text,
	"reason_for_leaving" text,
	"availability_days" text,
	"availability_shifts" text,
	"hours_desired" text,
	"why_interested" text,
	"posting_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"table_name" text,
	"record_id" text,
	"old_data" json,
	"new_data" json,
	"ip_address" text,
	"reason_code" text,
	"is_sensitive" boolean DEFAULT false,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"payer_id" text,
	"auth_number" text,
	"midas_auth_id" text,
	"procedure_code" text,
	"modifier" text,
	"authorized_units" numeric(10, 2) NOT NULL,
	"unit_type" text DEFAULT '15min' NOT NULL,
	"used_units" numeric(10, 2) DEFAULT '0' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"low_units_alert_threshold" numeric(10, 2) DEFAULT '20' NOT NULL,
	"notes" text,
	"imported_from" text DEFAULT 'manual' NOT NULL,
	"renewal_requested" boolean DEFAULT false NOT NULL,
	"renewal_requested_at" timestamp,
	"renewal_requested_by" text,
	"referral_source_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_check_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"background_check_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer,
	"file_data" text NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"check_type" text DEFAULT 'criminal' NOT NULL,
	"provider" text,
	"cost" numeric(8, 2),
	"status" text DEFAULT 'pending' NOT NULL,
	"initiated_date" date DEFAULT now() NOT NULL,
	"expiration_date" date,
	"worcs_reference_number" text,
	"worcs_status" text,
	"ssn_encrypted" text,
	"drivers_license_encrypted" text,
	"drivers_license_state" text,
	"reference_number" text,
	"findings" text,
	"result" text,
	"completed_date" date,
	"notes" text,
	"created_by" text,
	"submitted_date" date,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_plan_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"care_plan_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by_id" text,
	"service_type" text,
	"service_description" text,
	"frequency" text,
	"care_goals" text,
	"special_instructions" text,
	"precautions" text,
	"medication_notes" text,
	"mobility_notes" text,
	"dietary_notes" text,
	"communication_notes" text,
	"start_date" date,
	"end_date" date,
	"status" text,
	"visit_schedule" text,
	"visit_schedule_as_of" date
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_plan_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_name" text NOT NULL,
	"template_description" text,
	"category" text,
	"service_type" text,
	"service_description" text,
	"frequency" text,
	"care_goals" text,
	"special_instructions" text,
	"precautions" text,
	"medication_notes" text,
	"mobility_notes" text,
	"dietary_notes" text,
	"communication_notes" text,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"service_type" text,
	"frequency" text,
	"care_goals" text,
	"special_instructions" text,
	"precautions" text,
	"service_description" text,
	"medication_notes" text,
	"mobility_notes" text,
	"dietary_notes" text,
	"communication_notes" text,
	"visit_schedule" text,
	"visit_schedule_as_of" date,
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
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hourly_rate" numeric(8, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"default_service_code" text,
	"default_modifier" text,
	"requires_evv" boolean DEFAULT true,
	"required_certifications" json DEFAULT '[]'::json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"max_hours_per_week" integer DEFAULT 40 NOT NULL,
	"weekly_availability" json,
	"notes" text,
	"monday_available" boolean DEFAULT true,
	"monday_start_time" time,
	"monday_end_time" time,
	"tuesday_available" boolean DEFAULT true,
	"tuesday_start_time" time,
	"tuesday_end_time" time,
	"wednesday_available" boolean DEFAULT true,
	"wednesday_start_time" time,
	"wednesday_end_time" time,
	"thursday_available" boolean DEFAULT true,
	"thursday_start_time" time,
	"thursday_end_time" time,
	"friday_available" boolean DEFAULT true,
	"friday_start_time" time,
	"friday_end_time" time,
	"saturday_available" boolean DEFAULT false,
	"saturday_start_time" time,
	"saturday_end_time" time,
	"sunday_available" boolean DEFAULT false,
	"sunday_start_time" time,
	"sunday_end_time" time,
	"monday_preferred_start" time,
	"monday_preferred_end" time,
	"tuesday_preferred_start" time,
	"tuesday_preferred_end" time,
	"wednesday_preferred_start" time,
	"wednesday_preferred_end" time,
	"thursday_preferred_start" time,
	"thursday_preferred_end" time,
	"friday_preferred_start" time,
	"friday_preferred_end" time,
	"saturday_preferred_start" time,
	"saturday_preferred_end" time,
	"sunday_preferred_start" time,
	"sunday_preferred_end" time,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_availability_caregiver_id_unique" UNIQUE("caregiver_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"proficiency_level" text DEFAULT 'basic',
	"certified_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_care_type_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"care_type_id" text NOT NULL,
	"hourly_rate" numeric(8, 2),
	"overtime_rate" numeric(8, 2),
	"holiday_rate" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_disqualifiers" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"state" text,
	"category" text NOT NULL,
	"statute" text NOT NULL,
	"short_title" text NOT NULL,
	"description" text,
	"severity" text NOT NULL,
	"match_patterns" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"notes" text,
	"capabilities" text,
	"limitations" text,
	"preferred_hours" text,
	"available_mon" boolean DEFAULT true NOT NULL,
	"available_tue" boolean DEFAULT true NOT NULL,
	"available_wed" boolean DEFAULT true NOT NULL,
	"available_thu" boolean DEFAULT true NOT NULL,
	"available_fri" boolean DEFAULT true NOT NULL,
	"available_sat" boolean DEFAULT false NOT NULL,
	"available_sun" boolean DEFAULT false NOT NULL,
	"npi_number" text,
	"taxonomy_code" text DEFAULT '374700000X',
	"evv_worker_id" text,
	"medicaid_provider_id" text,
	"sms_enabled" boolean DEFAULT true,
	"sms_open_shifts" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_profiles_caregiver_id_unique" UNIQUE("caregiver_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"rate_type" text DEFAULT 'base' NOT NULL,
	"hourly_rate" numeric(8, 2) NOT NULL,
	"effective_date" date NOT NULL,
	"end_date" date,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"day_of_week" integer,
	"date" date,
	"start_time" time,
	"end_time" time,
	"is_available" boolean DEFAULT true NOT NULL,
	"max_hours_per_week" integer DEFAULT 40 NOT NULL,
	"overtime_approved" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caregiver_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"approved_by_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certification_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"certification_record_id" text,
	"certification_type" text NOT NULL,
	"expiry_date" date NOT NULL,
	"alert_type" text DEFAULT 'expiring_soon' NOT NULL,
	"days_until_expiry" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certification_records" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"certification_type" text NOT NULL,
	"issuing_body" text,
	"issue_date" date,
	"expiry_date" date,
	"document_url" text,
	"certification_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claim_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text,
	"caregiver_id" text,
	"edi_batch_id" text,
	"evv_visit_id" text,
	"authorization_id" text,
	"payer_id" text,
	"claim_number" text,
	"service_date" date,
	"service_code" text,
	"billed_amount" numeric(10, 2),
	"allowed_amount" numeric(10, 2),
	"paid_amount" numeric(10, 2),
	"denial_code" text,
	"denial_reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"submission_date" date,
	"accepted_date" date,
	"paid_date" date,
	"submission_method" text,
	"edi_file_path" text,
	"clearinghouse_id" text,
	"eob_notes" text,
	"check_number" text,
	"units_billed" numeric(10, 2),
	"payer_type" text,
	"resubmitted_from" text,
	"voided_at" timestamp,
	"voided_by" text,
	"notes" text,
	"invoice_id" text,
	"modifier" text,
	"diagnosis_code" text,
	"service_date_from" date,
	"service_date_to" date,
	"place_of_service" text,
	"created_by_id" text,
	"units_deducted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"assignment_date" date NOT NULL,
	"hours_per_week" numeric(5, 2),
	"pay_rate" numeric(10, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_caregiver_restrictions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"restriction_type" text DEFAULT 'do_not_assign' NOT NULL,
	"reason" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"requires_relationship" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"template_id" text,
	"document_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"viewed_at" timestamp,
	"signed_at" timestamp,
	"signed_by" text,
	"signer_relationship" text,
	"signed_ip" text,
	"signed_user_agent" text,
	"signature_image" text,
	"consent_at" timestamp,
	"document_hash" text,
	"declined_at" timestamp,
	"decline_reason" text,
	"voided_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_emergency_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"portal_enabled" boolean DEFAULT true,
	"caregiver_alerts" boolean DEFAULT true,
	"schedule_alerts" boolean DEFAULT true,
	"billing_alerts" boolean DEFAULT true,
	"assignment_alerts" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "client_notification_preferences_client_id_key" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"type" text,
	"title" text NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"related_visit_id" text,
	"related_invoice_id" text,
	"related_caregiver_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_onboarding" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"emergency_contacts_completed" boolean DEFAULT false NOT NULL,
	"medical_history_completed" boolean DEFAULT false NOT NULL,
	"insurance_info_completed" boolean DEFAULT false NOT NULL,
	"care_preferences_completed" boolean DEFAULT false NOT NULL,
	"family_communication_completed" boolean DEFAULT false NOT NULL,
	"initial_assessment_completed" boolean DEFAULT false NOT NULL,
	"all_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_onboarding_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_portal_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"password_hash" text,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"invite_token" text,
	"invite_expires_at" timestamp,
	"last_login" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_services" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"service_pricing_id" text NOT NULL,
	"is_primary" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_task_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"task_name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"allotted_minutes" integer DEFAULT 0 NOT NULL,
	"weekly_frequency" integer DEFAULT 1 NOT NULL,
	"days_of_week" text,
	"time_of_day" text DEFAULT 'any' NOT NULL,
	"assessment_source" text,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_task_templates_category_check" CHECK ("client_task_templates"."category" IN ('adl','iadl','medication','companion','safety','other')),
	CONSTRAINT "client_task_templates_time_of_day_check" CHECK ("client_task_templates"."time_of_day" IN ('AM','PM','any')),
	CONSTRAINT "client_task_templates_cadence_check" CHECK ("client_task_templates"."cadence" IN ('daily','weekly'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_visit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"note" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_vitals" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"time_entry_id" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"systolic_bp" integer,
	"diastolic_bp" integer,
	"pulse" integer,
	"respirations" integer,
	"oxygen_saturation" integer,
	"temperature_f" numeric(4, 1),
	"blood_glucose" integer,
	"weight_lbs" numeric(5, 1),
	"pain_scale" integer,
	"pain_location" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vitals_systolic_range" CHECK ("client_vitals"."systolic_bp" IS NULL OR "client_vitals"."systolic_bp" BETWEEN 50 AND 260),
	CONSTRAINT "vitals_diastolic_range" CHECK ("client_vitals"."diastolic_bp" IS NULL OR "client_vitals"."diastolic_bp" BETWEEN 25 AND 160),
	CONSTRAINT "vitals_pulse_range" CHECK ("client_vitals"."pulse" IS NULL OR "client_vitals"."pulse" BETWEEN 25 AND 220),
	CONSTRAINT "vitals_resp_range" CHECK ("client_vitals"."respirations" IS NULL OR "client_vitals"."respirations" BETWEEN 4 AND 70),
	CONSTRAINT "vitals_o2_range" CHECK ("client_vitals"."oxygen_saturation" IS NULL OR "client_vitals"."oxygen_saturation" BETWEEN 50 AND 100),
	CONSTRAINT "vitals_temp_range" CHECK ("client_vitals"."temperature_f" IS NULL OR "client_vitals"."temperature_f" BETWEEN 85.0 AND 112.0),
	CONSTRAINT "vitals_glucose_range" CHECK ("client_vitals"."blood_glucose" IS NULL OR "client_vitals"."blood_glucose" BETWEEN 20 AND 800),
	CONSTRAINT "vitals_weight_range" CHECK ("client_vitals"."weight_lbs" IS NULL OR "client_vitals"."weight_lbs" BETWEEN 30 AND 800),
	CONSTRAINT "vitals_pain_range" CHECK ("client_vitals"."pain_scale" IS NULL OR "client_vitals"."pain_scale" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"ssn_encrypted" text,
	"gender" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"phone" text,
	"email" text,
	"referred_by_id" text,
	"referral_date" date,
	"start_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"service_type" text,
	"insurance_provider" text,
	"insurance_id" text,
	"insurance_group" text,
	"medical_conditions" json DEFAULT '[]'::json NOT NULL,
	"allergies" json DEFAULT '[]'::json NOT NULL,
	"medications" json DEFAULT '[]'::json NOT NULL,
	"preferred_caregivers" json DEFAULT '[]'::json NOT NULL,
	"do_not_use_caregivers" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"evv_client_id" text,
	"mco_member_id" text,
	"primary_diagnosis_code" text,
	"secondary_diagnosis_code" text,
	"care_type_id" text,
	"is_private_pay" boolean DEFAULT false NOT NULL,
	"private_pay_rate" numeric(8, 2),
	"private_pay_rate_type" text DEFAULT 'hourly',
	"weekly_authorized_units" numeric(8, 2),
	"service_days_per_week" integer,
	"service_allowed_days" json,
	"assistance_needs" text,
	"billing_notes" text,
	"medical_notes" text,
	"care_preferences" text,
	"status" text DEFAULT 'active',
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relationship" text,
	"mobility_assistance_needs" text,
	"billing_frequency_weeks" integer,
	"billed_through" date,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"ivr_code" text,
	"medicaid_id" text,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"portal_token" text,
	"portal_token_exp" timestamp,
	"last_portal_visit" timestamp,
	"portal_email" text,
	"portal_password_hash" text,
	"sandata_sequence" bigint DEFAULT 0,
	"sandata_synced_at" timestamp,
	"evv_weekly_units" integer,
	"insurance_card_front" text,
	"insurance_card_back" text,
	"insurance_card_uploaded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_ivr_code_unique" UNIQUE("ivr_code"),
	CONSTRAINT "clients_insurance_front_size_cap" CHECK ("clients"."insurance_card_front" IS NULL OR LENGTH("clients"."insurance_card_front") <= 7000000),
	CONSTRAINT "clients_insurance_back_size_cap" CHECK ("clients"."insurance_card_back" IS NULL OR LENGTH("clients"."insurance_card_back") <= 7000000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communication_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"log_type" text DEFAULT 'note' NOT NULL,
	"direction" text,
	"subject" text,
	"body" text NOT NULL,
	"logged_by_id" text,
	"logged_by_name" text,
	"client_id" text,
	"follow_up_date" date,
	"follow_up_done" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"document_url" text,
	"requires_acknowledgment" boolean DEFAULT false NOT NULL,
	"effective_date" date,
	"expiry_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"data" json,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "denial_code_lookup" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"remediation" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "denial_code_lookup_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_acknowledgments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"acknowledged_at" timestamp DEFAULT now() NOT NULL,
	"signature_data" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"document_id" text NOT NULL,
	"signed_by_id" text NOT NULL,
	"signer_role" text,
	"signer_typed_name" text,
	"signature_image" text NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"document_type" text DEFAULT 'other' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"file_url" text,
	"file_name" text,
	"file_type" text,
	"file_size" integer,
	"file_data" text,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"expiration_date" date,
	"is_confidential" boolean DEFAULT false NOT NULL,
	"uploaded_by_id" text,
	"signed_at" timestamp,
	"signed_by_id" text,
	"signature_image" text,
	"signature_ip" text,
	"signature_user_agent" text,
	"signature_typed_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documents_entity_type_check" CHECK ("documents"."entity_type" IN ('client','caregiver','company'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edi_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"payer_id" text,
	"batch_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"claim_count" integer DEFAULT 0 NOT NULL,
	"total_billed" numeric(10, 2) DEFAULT '0' NOT NULL,
	"edi_content" text,
	"file_path" text,
	"submitted_at" timestamp,
	"response_code" text,
	"response_message" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "edi_batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evv_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"authorization_id" text,
	"service_code" text,
	"modifier" text,
	"service_date" date NOT NULL,
	"actual_start" timestamp NOT NULL,
	"actual_end" timestamp,
	"units_of_service" numeric(8, 2),
	"gps_in_lat" numeric(10, 7),
	"gps_in_lng" numeric(10, 7),
	"gps_out_lat" numeric(10, 7),
	"gps_out_lng" numeric(10, 7),
	"sandata_status" text DEFAULT 'pending' NOT NULL,
	"sandata_visit_id" text,
	"sandata_submitted_at" timestamp,
	"sandata_response" json,
	"sandata_exception_code" text,
	"sandata_exception_desc" text,
	"evv_method" text DEFAULT 'gps' NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verification_issues" json DEFAULT '[]'::json NOT NULL,
	"sandata_sequence" bigint DEFAULT 0,
	"sandata_uuid" text,
	"needs_resubmit" boolean DEFAULT false,
	"auto_submit_enabled" boolean DEFAULT true,
	"exception_ack" boolean DEFAULT false,
	"exception_ack_by_id" text,
	"exception_ack_at" timestamp,
	"exception_ack_reason" text,
	"exception_ack_memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evv_visits_time_entry_id_unique" UNIQUE("time_entry_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"category" text,
	"description" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"date" date NOT NULL,
	"receipt_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expo_push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"email" text,
	"phone" text,
	"password_hash" text,
	"portal_token" text,
	"portal_token_exp" timestamp,
	"last_login_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"can_view_schedule" boolean DEFAULT true NOT NULL,
	"can_view_care_plan" boolean DEFAULT true NOT NULL,
	"can_view_medications" boolean DEFAULT false NOT NULL,
	"can_message" boolean DEFAULT true NOT NULL,
	"is_primary_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"family_member_id" text NOT NULL,
	"client_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_name" text,
	"subject" text,
	"body" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"reply" text,
	"replied_at" timestamp,
	"replied_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_id" text,
	"template_name" text,
	"entity_type" text,
	"entity_id" text,
	"client_id" text,
	"submitted_by_id" text,
	"submitted_by_name" text,
	"data" json DEFAULT '{}'::json NOT NULL,
	"signature" text,
	"signed_at" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"fields" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"auto_attach_to" text,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"state" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geofence_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"radius_feet" integer DEFAULT 300 NOT NULL,
	"auto_clock_in" boolean DEFAULT true NOT NULL,
	"auto_clock_out" boolean DEFAULT true NOT NULL,
	"require_gps" boolean DEFAULT true NOT NULL,
	"notify_admin_on_override" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geofence_settings_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gps_tracking" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"time_entry_id" text,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"accuracy" integer,
	"speed" numeric(6, 2),
	"heading" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gusto_employee_map" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"gusto_employee_id" text,
	"gusto_uuid" text,
	"is_synced" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"synced_by_id" text,
	CONSTRAINT "gusto_employee_map_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gusto_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"sync_type" text NOT NULL,
	"status" text NOT NULL,
	"pay_period_start" date,
	"pay_period_end" date,
	"records_exported" integer DEFAULT 0 NOT NULL,
	"gusto_response" json,
	"error_message" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "help_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"is_faq" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"incident_id" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer,
	"file_data" text NOT NULL,
	"description" text,
	"uploaded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_investigation_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"incident_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"entry_type" text DEFAULT 'note' NOT NULL,
	"summary" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_number_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text,
	"caregiver_id" text,
	"incident_type" text NOT NULL,
	"severity" text DEFAULT 'moderate' NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"involved_parties" text,
	"action_taken" text,
	"witnesses" text,
	"injuries_or_damage" text,
	"follow_up_required" boolean DEFAULT false NOT NULL,
	"investigation_status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"reported_by_id" text,
	"incident_number" text,
	"incident_time" time,
	"follow_up_notes" text,
	"reported_by" text,
	"reported_date" date,
	"reporter_contact_name" text,
	"reporter_phone" text,
	"reporter_email" text,
	"response_due_date" date,
	"response_sent_date" date,
	"disposition" text,
	"findings" text,
	"mandatory_report_status" text,
	"mandatory_report_details" text,
	"payer_response_notes" text,
	"caregiver_removed_from" date,
	"caregiver_returned_on" date,
	"caregiver_removal" json,
	"training_ack_signed_at" timestamp,
	"training_ack_signer_name" text,
	"training_ack_signature" text,
	"training_ack_supervisor" text,
	"training_ack_method" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"adjustment_type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"time_entry_id" text,
	"caregiver_id" text NOT NULL,
	"description" text NOT NULL,
	"service_date" date,
	"hours" numeric(6, 2) NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"rate_type" text,
	"amount" numeric(12, 2) NOT NULL,
	"billed_basis" text,
	"scheduled_minutes" integer,
	"clocked_minutes" integer,
	"start_time" time,
	"end_time" time,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_method" text DEFAULT 'check' NOT NULL,
	"reference_number" text,
	"payment_date" date,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"client_id" text NOT NULL,
	"billing_period_start" date NOT NULL,
	"billing_period_end" date NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"payment_due_date" date,
	"payment_date" date,
	"payment_method" text,
	"stripe_payment_intent_id" text,
	"referral_source_id" text,
	"invoice_type" text,
	"paid_at" timestamp,
	"amount_paid" numeric(12, 2),
	"amount_adjusted" numeric(12, 2),
	"notes" text,
	"seq_number" integer,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"employment_type" text DEFAULT 'part_time' NOT NULL,
	"location" text,
	"pay_range_min" numeric(10, 2),
	"pay_range_max" numeric(10, 2),
	"pay_rate_unit" text DEFAULT 'hour' NOT NULL,
	"summary" text,
	"description" text NOT NULL,
	"responsibilities" text,
	"qualifications" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"closes_at" timestamp,
	"applications_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_postings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"success" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"fail_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medication_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"medication_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"administered_at" timestamp NOT NULL,
	"status" text DEFAULT 'given' NOT NULL,
	"notes" text,
	"time_entry_id" text,
	"scheduled_time" timestamp,
	"dosage_given" text,
	"witnessed_by" text,
	"effective_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "medications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"dosage" text,
	"frequency" text,
	"route" text,
	"indication" text,
	"prescribed_by" text,
	"pharmacy" text,
	"rx_number" text,
	"instructions" text,
	"side_effects" text,
	"is_prn" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_thread_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"subject" text NOT NULL,
	"created_by_id" text NOT NULL,
	"thread_type" text DEFAULT 'direct' NOT NULL,
	"is_broadcast" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mileage_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
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
CREATE TABLE IF NOT EXISTS "noshow_alert_config" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"grace_minutes" integer DEFAULT 15 NOT NULL,
	"notify_admin" boolean DEFAULT true NOT NULL,
	"notify_caregiver" boolean DEFAULT true NOT NULL,
	"notify_client_family" boolean DEFAULT false NOT NULL,
	"admin_phone" text,
	"admin_email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "noshow_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"schedule_id" text,
	"caregiver_id" text,
	"client_id" text,
	"shift_date" date NOT NULL,
	"expected_start" time NOT NULL,
	"alerted_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"resolution_note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"sms_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"schedule_alerts" boolean DEFAULT true NOT NULL,
	"absence_alerts" boolean DEFAULT true NOT NULL,
	"billing_alerts" boolean DEFAULT true NOT NULL,
	"rating_alerts" boolean DEFAULT true NOT NULL,
	"daily_digest" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"shift_reminder_alerts" boolean DEFAULT true NOT NULL,
	"payroll_alerts" boolean DEFAULT true NOT NULL,
	"payment_alerts" boolean DEFAULT true NOT NULL,
	"low_auth_alerts" boolean DEFAULT true NOT NULL,
	"expiring_cert_alerts" boolean DEFAULT true NOT NULL,
	"message_alerts" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"quiet_hours_skip_emergency" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text,
	"title" text NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"push_sent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"handled_at" timestamp,
	"handled_by_id" text,
	"recipient_type" text,
	"recipient_id" text,
	"notification_type" text,
	"subject" text,
	"sent_by" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_packet_events" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"packet_id" text NOT NULL,
	"event_type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_packets" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"application_id" text,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"preferred_name" text,
	"legal_first_name" text,
	"legal_middle_name" text,
	"legal_last_name" text,
	"pronouns" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"date_of_birth" date,
	"drivers_license_number" text,
	"drivers_license_state" text,
	"emergency_contact_name" text,
	"emergency_contact_relationship" text,
	"emergency_contact_phone" text,
	"emergency_contact_email" text,
	"bgc_consent_signed_at" timestamp,
	"bgc_consent_signature" text,
	"bgc_consent_ip" text,
	"bgc_consent_user_agent" text,
	"bgc_consent_version" text,
	"bgc_consent_disclosure_text" text,
	"ssn_transient_encrypted" text,
	"opened_at" timestamp,
	"submitted_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_packets_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shift_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shift_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"notified_at" timestamp DEFAULT now() NOT NULL,
	"notification_type" text DEFAULT 'push' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	"status" text DEFAULT 'open' NOT NULL,
	"notes" text,
	"source_absence_id" text,
	"notified_caregiver_count" integer DEFAULT 0 NOT NULL,
	"auto_created" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"schedule_id" text,
	"care_type_id" text,
	"hourly_rate" numeric(10, 2),
	"bonus_amount" numeric(10, 2) DEFAULT '0',
	"urgency" text DEFAULT 'normal',
	"claimed_by_id" text,
	"claimed_at" timestamp,
	"approved_by_id" text,
	"approved_at" timestamp,
	"claimed_by" text,
	"approved_by" text,
	"broadcast_sent" boolean DEFAULT false NOT NULL,
	"visible_to" text[],
	"auto_assign" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "optimizer_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input_params" json,
	"result_summary" json,
	"error_message" text,
	"duration_ms" integer,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "overtime_alert_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"threshold_min" integer NOT NULL,
	"sent" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_claim_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"matched_amount" numeric(12, 2) NOT NULL,
	"match_type" text DEFAULT 'auto',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"payer_id" text,
	"payer_name" text,
	"check_number" text,
	"check_date" date,
	"check_amount" numeric(12, 2) NOT NULL,
	"payment_date" date,
	"payment_method" text DEFAULT 'check',
	"scan_image_path" text,
	"ai_extracted_data" json,
	"reconciliation_status" text DEFAULT 'unreconciled',
	"reconciliation_notes" text,
	"total_matched" numeric(12, 2) DEFAULT '0',
	"underpayment_amount" numeric(12, 2) DEFAULT '0',
	"overpayment_amount" numeric(12, 2) DEFAULT '0',
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"payroll_record_id" text NOT NULL,
	"time_entry_id" text,
	"client_id" text,
	"date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"rate" numeric(8, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"pay_type" text DEFAULT 'regular' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_period_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"pay_period_start" date NOT NULL,
	"pay_period_end" date NOT NULL,
	"verified_at" timestamp,
	"disputed_at" timestamp,
	"dispute_reason" text,
	"reported_total_hours" numeric(10, 2),
	"reported_gross_pay" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_records" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"regular_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"holiday_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"regular_rate" numeric(8, 2),
	"overtime_rate" numeric(8, 2),
	"gross_pay" numeric(12, 2),
	"mileage_reimbursement" numeric(8, 2) DEFAULT '0',
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"approved_by_id" text,
	"processed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_shift_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"pay_period_start" date NOT NULL,
	"pay_period_end" date NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text,
	"schedule_id" text,
	"time_entry_id" text,
	"shift_date" date NOT NULL,
	"scheduled_start" time,
	"scheduled_end" time,
	"scheduled_minutes" integer,
	"actual_start" timestamp,
	"actual_end" timestamp,
	"actual_minutes" integer,
	"payable_minutes" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"flag_reason" text,
	"resolution_notes" text,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text NOT NULL,
	"rating_date" date DEFAULT now() NOT NULL,
	"satisfaction_score" integer,
	"punctuality_score" integer,
	"professionalism_score" integer,
	"care_quality_score" integer,
	"comments" text,
	"no_shows" integer DEFAULT 0 NOT NULL,
	"late_arrivals" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"client_last_read_at" timestamp,
	"staff_last_read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_name" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospect_appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"lead_id" text,
	"scheduled_date" date NOT NULL,
	"scheduled_time" time,
	"notes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"subscription" json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_source_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"referral_source_id" text NOT NULL,
	"care_type_id" text,
	"rate_amount" numeric(8, 2) NOT NULL,
	"rate_type" text DEFAULT 'hourly' NOT NULL,
	"effective_date" date,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referral_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"payer_type" text DEFAULT 'other',
	"payer_id_number" text,
	"npi" text,
	"expected_pay_days" integer DEFAULT 30,
	"is_active_payer" boolean DEFAULT false NOT NULL,
	"edi_payer_id" text,
	"submission_method" text DEFAULT 'manual',
	"fea_organization" text,
	"billing_address" text,
	"billing_contact" text,
	"billing_contact_name" text,
	"billing_contact_email" text,
	"billing_contact_phone" text,
	"sandata_payer_id" text,
	"sandata_payer_program" text,
	"sandata_evv_required" boolean DEFAULT false NOT NULL,
	"claim_portal" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remittance_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"payer_id" text,
	"payer_name" text NOT NULL,
	"payer_type" text DEFAULT 'other' NOT NULL,
	"check_number" text,
	"check_date" date,
	"payment_date" date,
	"total_amount" numeric(10, 2) NOT NULL,
	"raw_ocr_text" text,
	"status" text DEFAULT 'pending_match' NOT NULL,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remittance_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"client_id" text,
	"invoice_id" text,
	"claim_id" text,
	"claim_number" text,
	"service_date_from" date,
	"service_date_to" date,
	"billed_amount" numeric(10, 2),
	"allowed_amount" numeric(10, 2),
	"paid_amount" numeric(10, 2) NOT NULL,
	"adjustment_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"denial_code" text,
	"denial_reason" text,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"matched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_plan_stops" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"route_plan_id" text NOT NULL,
	"client_id" text,
	"stop_order" integer NOT NULL,
	"address" text,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"arrival_time" timestamp,
	"departure_time" timestamp,
	"distance_from_prev_miles" numeric(8, 2),
	"duration_from_prev_minutes" integer,
	"service_units" integer,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"actual_arrival" timestamp,
	"actual_departure" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"date" date NOT NULL,
	"total_distance_miles" numeric(8, 2),
	"total_duration_minutes" integer,
	"optimized_at" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_service_minutes" integer,
	"stop_count" integer,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sandata_submission_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"evv_visit_id" text NOT NULL,
	"submission_path" text DEFAULT 'api' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"retry_count" integer DEFAULT 0,
	"last_error" text,
	"next_retry_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"exception_date" date NOT NULL,
	"exception_type" text NOT NULL,
	"override_start_time" time,
	"override_end_time" time,
	"override_caregiver_id" text,
	"override_client_id" text,
	"override_notes" text,
	"created_by" text,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"visit_date" date NOT NULL,
	"scheduled_date" date,
	"start_time" time,
	"end_time" time,
	"status" text DEFAULT 'scheduled',
	"notes" text,
	"cancelled_reason" text,
	"cancelled_by" text,
	"cancelled_at" timestamp,
	"assignment_id" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"client_notes" text,
	"source_schedule_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text,
	"caregiver_id" text,
	"title" text,
	"start_time" timestamp,
	"end_time" timestamp,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"effective_date" date,
	"anchor_date" date,
	"schedule_type" text DEFAULT 'recurring' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"day_of_week" integer,
	"date" date,
	"status" text DEFAULT 'active',
	"notes" text,
	"care_type_id" text,
	"end_date" date,
	"is_split_shift" boolean DEFAULT false,
	"split_shift_group_id" text,
	"split_segment" integer,
	"is_training" boolean DEFAULT false NOT NULL,
	"suspended_from" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"code" text NOT NULL,
	"modifier1" text,
	"modifier2" text,
	"description" text NOT NULL,
	"service_category" text,
	"payer_type" text DEFAULT 'all' NOT NULL,
	"unit_type" text DEFAULT '15min' NOT NULL,
	"rate_per_unit" numeric(8, 4),
	"requires_evv" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_locations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"service_radius_miles" integer DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_pricing" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"service_type" text NOT NULL,
	"description" text,
	"client_hourly_rate" numeric(8, 2),
	"caregiver_hourly_rate" numeric(8, 2),
	"margin_percent" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_date" date,
	"end_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_reminder_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"shift_date" date NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
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
	"responded_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_task_completions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"task_template_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shift_task_completions_status_check" CHECK ("shift_task_completions"."status" IN ('pending','completed','skipped','refused'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"variables" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text NOT NULL,
	"assignment_id" text,
	"schedule_id" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration_minutes" integer,
	"allotted_minutes" integer,
	"billable_minutes" integer,
	"discrepancy_minutes" integer,
	"clock_in_location" json,
	"clock_out_location" json,
	"is_complete" boolean DEFAULT false NOT NULL,
	"notes" text,
	"origin_phone" text,
	"sandata_required" boolean,
	"needs_approval" boolean DEFAULT false NOT NULL,
	"approval_reason" text,
	"approved_by_id" text,
	"approved_at" timestamp,
	"approved_billable_minutes" integer,
	"approval_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "training_records" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"training_name" text NOT NULL,
	"provider" text,
	"completed_date" date,
	"expiry_date" date,
	"hours_completed" numeric(5, 1),
	"certificate_url" text,
	"certification_number" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "validation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"validation_type" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"details" json,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"request_type" text NOT NULL,
	"visit_id" text,
	"schedule_id" text,
	"visit_date" date NOT NULL,
	"original_start_time" time NOT NULL,
	"original_end_time" time NOT NULL,
	"cancel_reason" text,
	"proposed_date" date,
	"proposed_start_time" time,
	"proposed_end_time" time,
	"counter_date" date,
	"counter_start_time" time,
	"counter_end_time" time,
	"counter_message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text DEFAULT 'client' NOT NULL,
	"request_reason" text,
	"applied_schedule_id" text,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_documentation" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"visit_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"schedule_id" text,
	"tasks" json DEFAULT '[]'::json NOT NULL,
	"note" text,
	"entered_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"caregiver_id" text,
	"client_id" text,
	"caption" text,
	"category" text,
	"image_base64" text NOT NULL,
	"image_size" integer,
	"taken_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_time_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"changed_by_id" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"old_start" timestamp,
	"new_start" timestamp,
	"old_end" timestamp,
	"new_end" timestamp,
	"reason_code" text NOT NULL,
	"memo" text,
	"resolution_code" text DEFAULT '1',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "npi" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "medicaid_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sandata_username" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sandata_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sandata_account_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sandata_api_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sandata_agency_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "mileage_rate" numeric(6, 3) DEFAULT '0.67' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "latitude" numeric(10, 8);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "longitude" numeric(11, 8);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "certifications" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "certifications_expiry" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "default_pay_rate" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "hire_date" date;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_logout_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "reset_token_expires" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ivr_pin" text;--> statement-breakpoint
ALTER TABLE "call_log" ADD COLUMN "client_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "absences" ADD CONSTRAINT "absences_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "absences" ADD CONSTRAINT "absences_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "absences" ADD CONSTRAINT "absences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "absences" ADD CONSTRAINT "absences_reported_by_id_user_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "absences" ADD CONSTRAINT "absences_coverage_assigned_to_user_id_fk" FOREIGN KEY ("coverage_assigned_to") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adl_requirements" ADD CONSTRAINT "adl_requirements_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adl_requirements" ADD CONSTRAINT "adl_requirements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_user_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alerts" ADD CONSTRAINT "alerts_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_hired_user_id_user_id_fk" FOREIGN KEY ("hired_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_renewal_requested_by_user_id_fk" FOREIGN KEY ("renewal_requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_check_documents" ADD CONSTRAINT "background_check_documents_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_check_documents" ADD CONSTRAINT "background_check_documents_background_check_id_background_checks_id_fk" FOREIGN KEY ("background_check_id") REFERENCES "public"."background_checks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_check_documents" ADD CONSTRAINT "background_check_documents_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plan_revisions" ADD CONSTRAINT "care_plan_revisions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plan_revisions" ADD CONSTRAINT "care_plan_revisions_care_plan_id_care_plans_id_fk" FOREIGN KEY ("care_plan_id") REFERENCES "public"."care_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plan_templates" ADD CONSTRAINT "care_plan_templates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plan_templates" ADD CONSTRAINT "care_plan_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_types" ADD CONSTRAINT "care_types_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_capabilities" ADD CONSTRAINT "caregiver_capabilities_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_capabilities" ADD CONSTRAINT "caregiver_capabilities_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_capabilities" ADD CONSTRAINT "caregiver_capabilities_capability_id_service_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."service_capabilities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_care_type_rates" ADD CONSTRAINT "caregiver_care_type_rates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_care_type_rates" ADD CONSTRAINT "caregiver_care_type_rates_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_care_type_rates" ADD CONSTRAINT "caregiver_care_type_rates_care_type_id_care_types_id_fk" FOREIGN KEY ("care_type_id") REFERENCES "public"."care_types"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_disqualifiers" ADD CONSTRAINT "caregiver_disqualifiers_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_rates" ADD CONSTRAINT "caregiver_rates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_rates" ADD CONSTRAINT "caregiver_rates_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_rates" ADD CONSTRAINT "caregiver_rates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_schedules" ADD CONSTRAINT "caregiver_schedules_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_schedules" ADD CONSTRAINT "caregiver_schedules_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_alerts" ADD CONSTRAINT "certification_alerts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_alerts" ADD CONSTRAINT "certification_alerts_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_alerts" ADD CONSTRAINT "certification_alerts_certification_record_id_certification_records_id_fk" FOREIGN KEY ("certification_record_id") REFERENCES "public"."certification_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_alerts" ADD CONSTRAINT "certification_alerts_acknowledged_by_id_user_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_records" ADD CONSTRAINT "certification_records_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "certification_records" ADD CONSTRAINT "certification_records_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_edi_batch_id_edi_batches_id_fk" FOREIGN KEY ("edi_batch_id") REFERENCES "public"."edi_batches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_evv_visit_id_evv_visits_id_fk" FOREIGN KEY ("evv_visit_id") REFERENCES "public"."evv_visits"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claims" ADD CONSTRAINT "claims_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_caregiver_restrictions" ADD CONSTRAINT "client_caregiver_restrictions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_caregiver_restrictions" ADD CONSTRAINT "client_caregiver_restrictions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_caregiver_restrictions" ADD CONSTRAINT "client_caregiver_restrictions_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_caregiver_restrictions" ADD CONSTRAINT "client_caregiver_restrictions_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_document_templates" ADD CONSTRAINT "client_document_templates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_template_id_client_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."client_document_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_emergency_contacts" ADD CONSTRAINT "client_emergency_contacts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_emergency_contacts" ADD CONSTRAINT "client_emergency_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_notification_preferences" ADD CONSTRAINT "client_notification_preferences_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_notification_preferences" ADD CONSTRAINT "client_notification_preferences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_onboarding" ADD CONSTRAINT "client_onboarding_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_onboarding" ADD CONSTRAINT "client_onboarding_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_portal_accounts" ADD CONSTRAINT "client_portal_accounts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_portal_accounts" ADD CONSTRAINT "client_portal_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_services" ADD CONSTRAINT "client_services_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_services" ADD CONSTRAINT "client_services_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_task_templates" ADD CONSTRAINT "client_task_templates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_task_templates" ADD CONSTRAINT "client_task_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_task_templates" ADD CONSTRAINT "client_task_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_visit_notes" ADD CONSTRAINT "client_visit_notes_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_visit_notes" ADD CONSTRAINT "client_visit_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_visit_notes" ADD CONSTRAINT "client_visit_notes_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_referred_by_id_referral_sources_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_logged_by_id_user_id_fk" FOREIGN KEY ("logged_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_cache" ADD CONSTRAINT "dashboard_cache_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "denial_code_lookup" ADD CONSTRAINT "denial_code_lookup_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_document_id_compliance_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."compliance_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_acknowledgments" ADD CONSTRAINT "document_acknowledgments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_signed_by_id_user_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_signed_by_id_user_id_fk" FOREIGN KEY ("signed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "edi_batches" ADD CONSTRAINT "edi_batches_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "edi_batches" ADD CONSTRAINT "edi_batches_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "edi_batches" ADD CONSTRAINT "edi_batches_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_exception_ack_by_id_user_id_fk" FOREIGN KEY ("exception_ack_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expo_push_tokens" ADD CONSTRAINT "expo_push_tokens_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expo_push_tokens" ADD CONSTRAINT "expo_push_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_members" ADD CONSTRAINT "family_members_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_members" ADD CONSTRAINT "family_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_messages" ADD CONSTRAINT "family_messages_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_messages" ADD CONSTRAINT "family_messages_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_messages" ADD CONSTRAINT "family_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_messages" ADD CONSTRAINT "family_messages_replied_by_id_user_id_fk" FOREIGN KEY ("replied_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_id_user_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence_settings" ADD CONSTRAINT "geofence_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence_settings" ADD CONSTRAINT "geofence_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gps_tracking" ADD CONSTRAINT "gps_tracking_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gps_tracking" ADD CONSTRAINT "gps_tracking_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gps_tracking" ADD CONSTRAINT "gps_tracking_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gusto_employee_map" ADD CONSTRAINT "gusto_employee_map_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gusto_employee_map" ADD CONSTRAINT "gusto_employee_map_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gusto_employee_map" ADD CONSTRAINT "gusto_employee_map_synced_by_id_user_id_fk" FOREIGN KEY ("synced_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gusto_sync_log" ADD CONSTRAINT "gusto_sync_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gusto_sync_log" ADD CONSTRAINT "gusto_sync_log_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_investigation_notes" ADD CONSTRAINT "incident_investigation_notes_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_investigation_notes" ADD CONSTRAINT "incident_investigation_notes_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_investigation_notes" ADD CONSTRAINT "incident_investigation_notes_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_number_counters" ADD CONSTRAINT "incident_number_counters_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_id_user_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_referral_source_id_referral_sources_id_fk" FOREIGN KEY ("referral_source_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "login_activity" ADD CONSTRAINT "login_activity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "login_activity" ADD CONSTRAINT "login_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medications" ADD CONSTRAINT "medications_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "medications" ADD CONSTRAINT "medications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_thread_participants_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_thread_participants_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_thread_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "noshow_alert_config" ADD CONSTRAINT "noshow_alert_config_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_handled_by_id_user_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_packet_events" ADD CONSTRAINT "onboarding_packet_events_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_packet_events" ADD CONSTRAINT "onboarding_packet_events_packet_id_onboarding_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."onboarding_packets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_claims" ADD CONSTRAINT "open_shift_claims_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_claims" ADD CONSTRAINT "open_shift_claims_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_claims" ADD CONSTRAINT "open_shift_claims_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_notifications" ADD CONSTRAINT "open_shift_notifications_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shift_notifications" ADD CONSTRAINT "open_shift_notifications_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_claimed_by_id_user_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizer_runs" ADD CONSTRAINT "optimizer_runs_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "optimizer_runs" ADD CONSTRAINT "optimizer_runs_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "overtime_alert_log" ADD CONSTRAINT "overtime_alert_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claim_matches" ADD CONSTRAINT "payment_claim_matches_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claim_matches" ADD CONSTRAINT "payment_claim_matches_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_claim_matches" ADD CONSTRAINT "payment_claim_matches_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_payroll_record_id_payroll_records_id_fk" FOREIGN KEY ("payroll_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_line_items" ADD CONSTRAINT "payroll_line_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_verifications" ADD CONSTRAINT "payroll_period_verifications_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_period_verifications" ADD CONSTRAINT "payroll_period_verifications_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_shift_reviews" ADD CONSTRAINT "payroll_shift_reviews_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_shift_reviews" ADD CONSTRAINT "payroll_shift_reviews_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_shift_reviews" ADD CONSTRAINT "payroll_shift_reviews_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_shift_reviews" ADD CONSTRAINT "payroll_shift_reviews_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_shift_reviews" ADD CONSTRAINT "payroll_shift_reviews_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_shift_reviews" ADD CONSTRAINT "payroll_shift_reviews_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performance_ratings" ADD CONSTRAINT "performance_ratings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performance_ratings" ADD CONSTRAINT "performance_ratings_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performance_ratings" ADD CONSTRAINT "performance_ratings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_message_threads" ADD CONSTRAINT "portal_message_threads_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_message_threads" ADD CONSTRAINT "portal_message_threads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_thread_id_portal_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."portal_message_threads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_appointments" ADD CONSTRAINT "prospect_appointments_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_appointments" ADD CONSTRAINT "prospect_appointments_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prospect_appointments" ADD CONSTRAINT "prospect_appointments_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_source_rates" ADD CONSTRAINT "referral_source_rates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_source_rates" ADD CONSTRAINT "referral_source_rates_referral_source_id_referral_sources_id_fk" FOREIGN KEY ("referral_source_id") REFERENCES "public"."referral_sources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_source_rates" ADD CONSTRAINT "referral_source_rates_care_type_id_care_types_id_fk" FOREIGN KEY ("care_type_id") REFERENCES "public"."care_types"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "referral_sources" ADD CONSTRAINT "referral_sources_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_batches" ADD CONSTRAINT "remittance_batches_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_batches" ADD CONSTRAINT "remittance_batches_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_batches" ADD CONSTRAINT "remittance_batches_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_batch_id_remittance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."remittance_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_plan_stops" ADD CONSTRAINT "route_plan_stops_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_plan_stops" ADD CONSTRAINT "route_plan_stops_route_plan_id_route_plans_id_fk" FOREIGN KEY ("route_plan_id") REFERENCES "public"."route_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_plan_stops" ADD CONSTRAINT "route_plan_stops_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_plans" ADD CONSTRAINT "route_plans_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sandata_submission_queue" ADD CONSTRAINT "sandata_submission_queue_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sandata_submission_queue" ADD CONSTRAINT "sandata_submission_queue_evv_visit_id_evv_visits_id_fk" FOREIGN KEY ("evv_visit_id") REFERENCES "public"."evv_visits"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_override_caregiver_id_user_id_fk" FOREIGN KEY ("override_caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_override_client_id_clients_id_fk" FOREIGN KEY ("override_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_visits" ADD CONSTRAINT "scheduled_visits_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_visits" ADD CONSTRAINT "scheduled_visits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_visits" ADD CONSTRAINT "scheduled_visits_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_visits" ADD CONSTRAINT "scheduled_visits_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_visits" ADD CONSTRAINT "scheduled_visits_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_visits" ADD CONSTRAINT "scheduled_visits_source_schedule_id_schedules_id_fk" FOREIGN KEY ("source_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedules" ADD CONSTRAINT "schedules_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_capabilities" ADD CONSTRAINT "service_capabilities_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_codes" ADD CONSTRAINT "service_codes_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_locations" ADD CONSTRAINT "service_locations_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_pricing" ADD CONSTRAINT "service_pricing_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_reminder_log" ADD CONSTRAINT "shift_reminder_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_swaps" ADD CONSTRAINT "shift_swaps_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_task_completions" ADD CONSTRAINT "shift_task_completions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_task_completions" ADD CONSTRAINT "shift_task_completions_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_task_completions" ADD CONSTRAINT "shift_task_completions_task_template_id_client_task_templates_id_fk" FOREIGN KEY ("task_template_id") REFERENCES "public"."client_task_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validation_log" ADD CONSTRAINT "validation_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "validation_log" ADD CONSTRAINT "validation_log_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_change_requests" ADD CONSTRAINT "visit_change_requests_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_change_requests" ADD CONSTRAINT "visit_change_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_change_requests" ADD CONSTRAINT "visit_change_requests_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_change_requests" ADD CONSTRAINT "visit_change_requests_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_change_requests" ADD CONSTRAINT "visit_change_requests_applied_schedule_id_schedules_id_fk" FOREIGN KEY ("applied_schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_change_requests" ADD CONSTRAINT "visit_change_requests_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_documentation" ADD CONSTRAINT "visit_documentation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_documentation" ADD CONSTRAINT "visit_documentation_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_documentation" ADD CONSTRAINT "visit_documentation_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_documentation" ADD CONSTRAINT "visit_documentation_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_documentation" ADD CONSTRAINT "visit_documentation_entered_by_id_user_id_fk" FOREIGN KEY ("entered_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_photos" ADD CONSTRAINT "visit_photos_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_time_changes" ADD CONSTRAINT "visit_time_changes_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_time_changes" ADD CONSTRAINT "visit_time_changes_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_time_changes" ADD CONSTRAINT "visit_time_changes_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absences_company_id_idx" ON "absences" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absences_caregiver_id_idx" ON "absences" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "absences_date_idx" ON "absences" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_logs_company_id_idx" ON "adl_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_logs_client_id_idx" ON "adl_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_logs_performed_at_idx" ON "adl_logs" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_logs_time_entry_idx" ON "adl_logs" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_requirements_company_id_idx" ON "adl_requirements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_requirements_client_id_idx" ON "adl_requirements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_company_id_idx" ON "alerts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_alert_type_idx" ON "alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_priority_idx" ON "alerts" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_status_history_company_id_idx" ON "application_status_history" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_status_history_application_id_idx" ON "application_status_history" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_company_id_idx" ON "applications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_created_at_idx" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_email_idx" ON "applications" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_posting_id_idx" ON "applications" USING btree ("posting_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_company_id_idx" ON "audit_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_table_name_idx" ON "audit_logs" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorizations_company_id_idx" ON "authorizations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorizations_client_id_idx" ON "authorizations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorizations_dates_idx" ON "authorizations" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authorizations_status_idx" ON "authorizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_check_documents_company_id_idx" ON "background_check_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_check_documents_check_idx" ON "background_check_documents" USING btree ("background_check_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_checks_company_id_idx" ON "background_checks" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_checks_caregiver_id_idx" ON "background_checks" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_checks_expiration_date_idx" ON "background_checks" USING btree ("expiration_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_revisions_company_id_idx" ON "care_plan_revisions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "care_plan_revisions_plan_rev_idx" ON "care_plan_revisions" USING btree ("care_plan_id","revision_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_templates_company_id_idx" ON "care_plan_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_templates_active_idx" ON "care_plan_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_templates_category_idx" ON "care_plan_templates" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plans_company_id_idx" ON "care_plans" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plans_client_id_idx" ON "care_plans" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_types_company_id_idx" ON "care_types" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_availability_company_id_idx" ON "caregiver_availability" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_capabilities_company_id_idx" ON "caregiver_capabilities" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_capabilities_caregiver_capability_idx" ON "caregiver_capabilities" USING btree ("caregiver_id","capability_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_capabilities_caregiver_id_idx" ON "caregiver_capabilities" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_care_type_rates_company_id_idx" ON "caregiver_care_type_rates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_care_type_rates_caregiver_idx" ON "caregiver_care_type_rates" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_disqualifiers_company_id_idx" ON "caregiver_disqualifiers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_disqualifiers_active_idx" ON "caregiver_disqualifiers" USING btree ("is_active","severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_disqualifiers_state_idx" ON "caregiver_disqualifiers" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_profiles_company_id_idx" ON "caregiver_profiles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_rates_company_id_idx" ON "caregiver_rates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_rates_caregiver_idx" ON "caregiver_rates" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_rates_effective_date_idx" ON "caregiver_rates" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_schedules_company_id_idx" ON "caregiver_schedules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_schedules_caregiver_id_idx" ON "caregiver_schedules" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_schedules_date_idx" ON "caregiver_schedules" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_time_off_company_id_idx" ON "caregiver_time_off" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_time_off_caregiver_id_idx" ON "caregiver_time_off" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_time_off_dates_idx" ON "caregiver_time_off" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_alerts_company_id_idx" ON "certification_alerts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_alerts_caregiver_idx" ON "certification_alerts" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_alerts_status_idx" ON "certification_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_records_company_id_idx" ON "certification_records" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "certification_records_caregiver_idx" ON "certification_records" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_status_history_company_id_idx" ON "claim_status_history" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_status_history_claim_id_idx" ON "claim_status_history" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_company_id_idx" ON "claims" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_invoice_id_idx" ON "claims" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_edi_batch_id_idx" ON "claims" USING btree ("edi_batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_evv_visit_id_idx" ON "claims" USING btree ("evv_visit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_payer_status" ON "claims" USING btree ("payer_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_caregiver" ON "claims" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_service_date" ON "claims" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_denial" ON "claims" USING btree ("status","denial_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_assignments_company_id_idx" ON "client_assignments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_assignments_client_id_idx" ON "client_assignments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_assignments_caregiver_id_idx" ON "client_assignments" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_assignments_status_idx" ON "client_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_caregiver_restrictions_company_id_idx" ON "client_caregiver_restrictions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_caregiver_restrictions_pair_idx" ON "client_caregiver_restrictions" USING btree ("client_id","caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_caregiver_restrictions_client_id_idx" ON "client_caregiver_restrictions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_caregiver_restrictions_caregiver_id_idx" ON "client_caregiver_restrictions" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_document_templates_company_id_idx" ON "client_document_templates" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_document_templates_key_idx" ON "client_document_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_documents_company_id_idx" ON "client_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_documents_client_id_idx" ON "client_documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_documents_status_idx" ON "client_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_emergency_contacts_company_id_idx" ON "client_emergency_contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_emergency_contacts_client_id_idx" ON "client_emergency_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_notification_preferences_company_id_idx" ON "client_notification_preferences" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_notifications_company_id_idx" ON "client_notifications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_notifications_client_id_idx" ON "client_notifications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_notifications_is_read_idx" ON "client_notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_onboarding_company_id_idx" ON "client_onboarding" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_portal_accounts_company_id_idx" ON "client_portal_accounts" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_portal_accounts_email_idx" ON "client_portal_accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_portal_accounts_client_id_idx" ON "client_portal_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_portal_accounts_invite_token_idx" ON "client_portal_accounts" USING btree ("invite_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_services_company_id_idx" ON "client_services" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_client_services_client" ON "client_services" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_task_templates_company_id_idx" ON "client_task_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_task_templates_client_active_idx" ON "client_task_templates" USING btree ("client_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_visit_notes_company_id_idx" ON "client_visit_notes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_visit_notes_client" ON "client_visit_notes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_company_id_idx" ON "client_vitals" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_client_idx" ON "client_vitals" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_recorded_idx" ON "client_vitals" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_caregiver_idx" ON "client_vitals" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_company_id_idx" ON "clients" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_is_active_idx" ON "clients" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_referred_by_id_idx" ON "clients" USING btree ("referred_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_active_service_idx" ON "clients" USING btree ("is_active","service_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "communication_log_company_id_idx" ON "communication_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "communication_log_entity_idx" ON "communication_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "communication_log_created_at_idx" ON "communication_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_documents_company_id_idx" ON "compliance_documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_documents_category_idx" ON "compliance_documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_cache_company_id_idx" ON "dashboard_cache" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "denial_code_lookup_company_id_idx" ON "denial_code_lookup" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_acknowledgments_company_id_idx" ON "document_acknowledgments" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_acknowledgments_doc_user_idx" ON "document_acknowledgments" USING btree ("document_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_acknowledgments_document_id_idx" ON "document_acknowledgments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_signatures_company_id_idx" ON "document_signatures" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_signatures_document_idx" ON "document_signatures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_signatures_signer_idx" ON "document_signatures" USING btree ("signed_by_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_company_id_idx" ON "documents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_entity_idx" ON "documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_expiration_idx" ON "documents" USING btree ("expiration_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edi_batches_company_id_idx" ON "edi_batches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edi_batches_status_idx" ON "edi_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evv_visits_company_id_idx" ON "evv_visits" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evv_visits_client_date_idx" ON "evv_visits" USING btree ("client_id","service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evv_visits_caregiver_id_idx" ON "evv_visits" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evv_visits_sandata_status_idx" ON "evv_visits" USING btree ("sandata_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_company_id_idx" ON "expenses" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_user_id_idx" ON "expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expo_push_tokens_company_id_idx" ON "expo_push_tokens" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expo_push_tokens_token_idx" ON "expo_push_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expo_push_tokens_user_id_idx" ON "expo_push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_members_company_id_idx" ON "family_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_members_client_id_idx" ON "family_members" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_members_email_idx" ON "family_members" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_messages_company_id_idx" ON "family_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_messages_family_member_id_idx" ON "family_messages" USING btree ("family_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_messages_client_id_idx" ON "family_messages" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_company_id_idx" ON "form_submissions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_entity_idx" ON "form_submissions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submissions_template_id_idx" ON "form_submissions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_templates_company_id_idx" ON "form_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_templates_category_active_idx" ON "form_templates" USING btree ("category","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geofence_settings_company_id_idx" ON "geofence_settings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gps_tracking_company_id_idx" ON "gps_tracking" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gps_tracking_caregiver_id_idx" ON "gps_tracking" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gps_tracking_time_entry_id_idx" ON "gps_tracking" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gps_tracking_timestamp_idx" ON "gps_tracking" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gps_tracking_entry_timestamp_idx" ON "gps_tracking" USING btree ("time_entry_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gusto_employee_map_company_id_idx" ON "gusto_employee_map" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gusto_sync_log_company_id_idx" ON "gusto_sync_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "help_articles_company_id_idx" ON "help_articles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "help_articles_category_idx" ON "help_articles" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_attachments_company_id_idx" ON "incident_attachments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_attachments_incident_idx" ON "incident_attachments" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_investigation_notes_company_id_idx" ON "incident_investigation_notes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_investigation_notes_incident_idx" ON "incident_investigation_notes" USING btree ("incident_id","entry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_number_counters_company_id_idx" ON "incident_number_counters" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incident_number_counters_company_year_key" ON "incident_number_counters" USING btree ("company_id","year");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_company_id_idx" ON "incidents" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_status_idx" ON "incidents" USING btree ("investigation_status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_incident_number_idx" ON "incidents" USING btree ("incident_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_response_due_idx" ON "incidents" USING btree ("response_due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_adjustments_company_id_idx" ON "invoice_adjustments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_adjustments_invoice_id_idx" ON "invoice_adjustments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_company_id_idx" ON "invoice_line_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_invoice_id_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_company_id_idx" ON "invoice_payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_invoice_id_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_payments_payment_date_idx" ON "invoice_payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_company_id_idx" ON "invoices" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_seq_number_unique" ON "invoices" USING btree ("seq_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_payment_status_idx" ON "invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_period_status_idx" ON "invoices" USING btree ("billing_period_start","billing_period_end","payment_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_postings_company_id_idx" ON "job_postings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_postings_published_idx" ON "job_postings" USING btree ("is_published","closes_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_activity_company_id_idx" ON "login_activity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_activity_email_idx" ON "login_activity" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_activity_user_id_idx" ON "login_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_activity_created_at_idx" ON "login_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_logs_company_id_idx" ON "medication_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_logs_time_entry_idx" ON "medication_logs" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medications_company_id_idx" ON "medications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medications_client_idx" ON "medications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_thread_participants_company_id_idx" ON "message_thread_participants" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_thread_participants_thread_user_idx" ON "message_thread_participants" USING btree ("thread_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_thread_participants_user_id_idx" ON "message_thread_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_thread_participants_thread_id_idx" ON "message_thread_participants" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_threads_company_id_idx" ON "message_threads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_threads_updated_at_idx" ON "message_threads" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_company_id_idx" ON "messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mileage_entries_company_id_idx" ON "mileage_entries" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mileage_entries_caregiver_idx" ON "mileage_entries" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "noshow_alert_config_company_id_idx" ON "noshow_alert_config" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "noshow_alerts_company_id_idx" ON "noshow_alerts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "noshow_alerts_status_date_idx" ON "noshow_alerts" USING btree ("status","shift_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "noshow_alerts_caregiver_id_idx" ON "noshow_alerts" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_preferences_company_id_idx" ON "notification_preferences" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_company_id_idx" ON "notifications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_is_read_idx" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_status_idx" ON "notifications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packet_events_company_id_idx" ON "onboarding_packet_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packet_events_packet_idx" ON "onboarding_packet_events" USING btree ("packet_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_company_id_idx" ON "onboarding_packets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_caregiver_idx" ON "onboarding_packets" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_status_idx" ON "onboarding_packets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_expires_idx" ON "onboarding_packets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_claims_company_id_idx" ON "open_shift_claims" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_claims_open_shift_id_idx" ON "open_shift_claims" USING btree ("open_shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_notifications_company_id_idx" ON "open_shift_notifications" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_shift_notifications_shift_caregiver_idx" ON "open_shift_notifications" USING btree ("open_shift_id","caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_notifications_open_shift_id_idx" ON "open_shift_notifications" USING btree ("open_shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_company_id_idx" ON "open_shifts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_date_idx" ON "open_shifts" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_status_idx" ON "open_shifts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_schedule_id_idx" ON "open_shifts" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "optimizer_runs_company_id_idx" ON "optimizer_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "overtime_alert_log_company_id_idx" ON "overtime_alert_log" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "overtime_alert_log_key" ON "overtime_alert_log" USING btree ("time_entry_id","threshold_min");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_claim_matches_company_id_idx" ON "payment_claim_matches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcm_payment_idx" ON "payment_claim_matches" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcm_claim_idx" ON "payment_claim_matches" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_company_id_idx" ON "payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_payer_idx" ON "payments" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("reconciliation_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_date_idx" ON "payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_line_items_company_id_idx" ON "payroll_line_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_line_items_payroll_record_id_idx" ON "payroll_line_items" USING btree ("payroll_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_period_verifications_company_id_idx" ON "payroll_period_verifications" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_period_verifications_caregiver_period_idx" ON "payroll_period_verifications" USING btree ("caregiver_id","pay_period_start","pay_period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_records_company_id_idx" ON "payroll_records" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_records_caregiver_id_idx" ON "payroll_records" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_records_period_idx" ON "payroll_records" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_records_caregiver_period_idx" ON "payroll_records" USING btree ("caregiver_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_company_id_idx" ON "payroll_shift_reviews" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_period_idx" ON "payroll_shift_reviews" USING btree ("pay_period_start","pay_period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_caregiver_idx" ON "payroll_shift_reviews" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_shift_reviews_status_idx" ON "payroll_shift_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_ratings_company_id_idx" ON "performance_ratings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_ratings_caregiver_id_idx" ON "performance_ratings" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_ratings_client_id_idx" ON "performance_ratings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_message_threads_company_id_idx" ON "portal_message_threads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_message_threads_client_id_idx" ON "portal_message_threads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_message_threads_last_message_idx" ON "portal_message_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_messages_company_id_idx" ON "portal_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_messages_thread_created_idx" ON "portal_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_appointments_company_id_idx" ON "prospect_appointments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_company_id_idx" ON "push_subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_is_active_idx" ON "push_subscriptions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_source_rates_company_id_idx" ON "referral_source_rates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_source_rates_referral_source_id_idx" ON "referral_source_rates" USING btree ("referral_source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_source_rates_care_type_id_idx" ON "referral_source_rates" USING btree ("care_type_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_sources_company_id_idx" ON "referral_sources" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_sources_type_idx" ON "referral_sources" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_sources_is_active_idx" ON "referral_sources" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_sources_active_type_idx" ON "referral_sources" USING btree ("is_active","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remittance_batches_company_id_idx" ON "remittance_batches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remittance_batches_payer_id_idx" ON "remittance_batches" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remittance_line_items_company_id_idx" ON "remittance_line_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remittance_line_items_batch_id_idx" ON "remittance_line_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_plan_stops_company_id_idx" ON "route_plan_stops" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_plan_stops_route_plan_id_idx" ON "route_plan_stops" USING btree ("route_plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_plans_company_id_idx" ON "route_plans" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_plans_caregiver_date_idx" ON "route_plans" USING btree ("caregiver_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandata_submission_queue_company_id_idx" ON "sandata_submission_queue" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandata_queue_status_idx" ON "sandata_submission_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sandata_queue_evv_idx" ON "sandata_submission_queue" USING btree ("evv_visit_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_exceptions_company_id_idx" ON "schedule_exceptions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schedule_exceptions_schedule_date_idx" ON "schedule_exceptions" USING btree ("schedule_id","exception_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_exceptions_schedule_id_idx" ON "schedule_exceptions" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_exceptions_date_idx" ON "schedule_exceptions" USING btree ("exception_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_visits_company_id_idx" ON "scheduled_visits" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_scheduled_visits_client" ON "scheduled_visits" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_company_id_idx" ON "schedules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_client_id_idx" ON "schedules" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_caregiver_id_idx" ON "schedules" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_split_group_idx" ON "schedules" USING btree ("split_shift_group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_capabilities_company_id_idx" ON "service_capabilities" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_codes_company_id_idx" ON "service_codes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_codes_code_idx" ON "service_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_codes_is_active_idx" ON "service_codes" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_locations_company_id_idx" ON "service_locations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_pricing_company_id_idx" ON "service_pricing" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_pricing_service_type_idx" ON "service_pricing" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_pricing_is_active_idx" ON "service_pricing" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_reminder_log_company_id_idx" ON "shift_reminder_log" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_reminder_log_key" ON "shift_reminder_log" USING btree ("schedule_id","shift_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_swaps_company_id_idx" ON "shift_swaps" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_swaps_status_idx" ON "shift_swaps" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_task_completions_company_id_idx" ON "shift_task_completions" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_task_completions_entry_task_idx" ON "shift_task_completions" USING btree ("time_entry_id","task_template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_task_completions_time_entry_idx" ON "shift_task_completions" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_templates_company_id_idx" ON "sms_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_company_id_idx" ON "time_entries" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_caregiver_id_idx" ON "time_entries" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_client_id_idx" ON "time_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_start_time_idx" ON "time_entries" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_schedule_id_idx" ON "time_entries" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_caregiver_complete_idx" ON "time_entries" USING btree ("caregiver_id","is_complete");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_period_idx" ON "time_entries" USING btree ("start_time","end_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_client_start_idx" ON "time_entries" USING btree ("client_id","start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_company_id_idx" ON "training_records" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_caregiver_idx" ON "training_records" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_expiry_idx" ON "training_records" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_log_company_id_idx" ON "validation_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_log_entity_idx" ON "validation_log" USING btree ("entity_id","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_company_id_idx" ON "visit_change_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_client_id_idx" ON "visit_change_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_caregiver_id_idx" ON "visit_change_requests" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_status_created_idx" ON "visit_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_visit_date_idx" ON "visit_change_requests" USING btree ("visit_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_documentation_company_id_idx" ON "visit_documentation" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_documentation_visit_idx" ON "visit_documentation" USING btree ("client_id","visit_date","start_time","caregiver_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_documentation_client_date_idx" ON "visit_documentation" USING btree ("client_id","visit_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_company_id_idx" ON "visit_photos" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_time_entry_id_idx" ON "visit_photos" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_client_id_idx" ON "visit_photos" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_taken_at_idx" ON "visit_photos" USING btree ("taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_time_changes_company_id_idx" ON "visit_time_changes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_time_changes_entry_idx" ON "visit_time_changes" USING btree ("time_entry_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_ivr_pin_unique" UNIQUE("ivr_pin");