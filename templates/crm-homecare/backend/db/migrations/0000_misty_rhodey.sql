CREATE TABLE "absences" (
	"id" text PRIMARY KEY NOT NULL,
	"caregiver_id" text NOT NULL,
	"client_id" text,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"reported_by_id" text,
	"coverage_needed" boolean DEFAULT true NOT NULL,
	"coverage_assigned_to" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"slug" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"primary_color" text DEFAULT '{{PRIMARY_COLOR}}' NOT NULL,
	"secondary_color" text,
	"logo" text,
	"website" text,
	"license_number" text,
	"npi" text,
	"medicaid_id" text,
	"settings" json DEFAULT '{}'::json NOT NULL,
	"stripe_customer_id" text,
	"subscription_tier" text,
	"twilio_phone_number" text,
	"twilio_account_sid" text,
	"twilio_auth_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agencies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agencies_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"table_name" text,
	"record_id" text,
	"old_data" json,
	"new_data" json,
	"ip_address" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorizations" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_checks" (
	"id" text PRIMARY KEY NOT NULL,
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
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregiver_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"caregiver_id" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"max_hours_per_week" integer DEFAULT 40 NOT NULL,
	"weekly_availability" json,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_availability_caregiver_id_unique" UNIQUE("caregiver_id")
);
--> statement-breakpoint
CREATE TABLE "caregiver_profiles" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "caregiver_profiles_caregiver_id_unique" UNIQUE("caregiver_id")
);
--> statement-breakpoint
CREATE TABLE "caregiver_schedules" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "caregiver_time_off" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"caregiver_id" text,
	"edi_batch_id" text,
	"evv_visit_id" text,
	"authorization_id" text,
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
	"paid_date" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_assignments" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "client_emergency_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_onboarding" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_log" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "dashboard_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"data" json,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "edi_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"payer_id" text,
	"batch_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"claim_count" integer DEFAULT 0 NOT NULL,
	"total_billed" numeric(10, 2) DEFAULT '0' NOT NULL,
	"edi_content" text,
	"submitted_at" timestamp,
	"response_code" text,
	"response_message" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "edi_batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE "evv_visits" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evv_visits_time_entry_id_unique" UNIQUE("time_entry_id")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "form_submissions" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "form_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"fields" json DEFAULT '[]'::json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"auto_attach_to" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geofence_settings" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "gps_tracking" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "gusto_employee_map" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"gusto_employee_id" text,
	"gusto_uuid" text,
	"is_synced" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	CONSTRAINT "gusto_employee_map_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "gusto_sync_log" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"time_entry_id" text,
	"caregiver_id" text NOT NULL,
	"description" text NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
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
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "login_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"success" boolean DEFAULT false NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"fail_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_thread_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"created_by_id" text NOT NULL,
	"thread_type" text DEFAULT 'direct' NOT NULL,
	"is_broadcast" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "noshow_alert_config" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "noshow_alerts" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"schedule_alerts" boolean DEFAULT true NOT NULL,
	"absence_alerts" boolean DEFAULT true NOT NULL,
	"billing_alerts" boolean DEFAULT true NOT NULL,
	"rating_alerts" boolean DEFAULT true NOT NULL,
	"daily_digest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text,
	"title" text NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"email_sent" boolean DEFAULT false NOT NULL,
	"push_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_shift_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"open_shift_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"notified_at" timestamp DEFAULT now() NOT NULL,
	"notification_type" text DEFAULT 'push' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "open_shifts" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "performance_ratings" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subscription" json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_sources" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remittance_batches" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "remittance_line_items" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
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
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_codes" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "service_locations" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'caregiver' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"latitude" numeric(10, 8),
	"longitude" numeric(11, 8),
	"certifications" json DEFAULT '[]'::json NOT NULL,
	"certifications_expiry" json DEFAULT '[]'::json NOT NULL,
	"default_pay_rate" numeric(8, 2),
	"hire_date" date,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"last_login" timestamp,
	"refresh_token" text,
	"reset_token" text,
	"reset_token_exp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "validation_log" (
	"id" text PRIMARY KEY NOT NULL,
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
ALTER TABLE "absences" ADD CONSTRAINT "absences_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absences" ADD CONSTRAINT "absences_coverage_assigned_to_users_id_fk" FOREIGN KEY ("coverage_assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorizations" ADD CONSTRAINT "authorizations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_availability" ADD CONSTRAINT "caregiver_availability_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD CONSTRAINT "caregiver_profiles_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_schedules" ADD CONSTRAINT "caregiver_schedules_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver_time_off" ADD CONSTRAINT "caregiver_time_off_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_edi_batch_id_edi_batches_id_fk" FOREIGN KEY ("edi_batch_id") REFERENCES "public"."edi_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_evv_visit_id_evv_visits_id_fk" FOREIGN KEY ("evv_visit_id") REFERENCES "public"."evv_visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_emergency_contacts" ADD CONSTRAINT "client_emergency_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_onboarding" ADD CONSTRAINT "client_onboarding_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_referred_by_id_referral_sources_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_logged_by_id_users_id_fk" FOREIGN KEY ("logged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_log" ADD CONSTRAINT "communication_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_batches" ADD CONSTRAINT "edi_batches_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edi_batches" ADD CONSTRAINT "edi_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evv_visits" ADD CONSTRAINT "evv_visits_authorization_id_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."authorizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_settings" ADD CONSTRAINT "geofence_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_tracking" ADD CONSTRAINT "gps_tracking_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_tracking" ADD CONSTRAINT "gps_tracking_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_employee_map" ADD CONSTRAINT "gusto_employee_map_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gusto_sync_log" ADD CONSTRAINT "gusto_sync_log_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_activity" ADD CONSTRAINT "login_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_thread_participants_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_thread_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noshow_alerts" ADD CONSTRAINT "noshow_alerts_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_shift_notifications" ADD CONSTRAINT "open_shift_notifications_open_shift_id_open_shifts_id_fk" FOREIGN KEY ("open_shift_id") REFERENCES "public"."open_shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_shifts" ADD CONSTRAINT "open_shifts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_ratings" ADD CONSTRAINT "performance_ratings_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_ratings" ADD CONSTRAINT "performance_ratings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_batches" ADD CONSTRAINT "remittance_batches_payer_id_referral_sources_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."referral_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_batches" ADD CONSTRAINT "remittance_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_batch_id_remittance_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."remittance_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_line_items" ADD CONSTRAINT "remittance_line_items_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_log" ADD CONSTRAINT "validation_log_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absences_caregiver_id_idx" ON "absences" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "absences_date_idx" ON "absences" USING btree ("date");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_table_name_idx" ON "audit_logs" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "authorizations_client_id_idx" ON "authorizations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "authorizations_dates_idx" ON "authorizations" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "authorizations_status_idx" ON "authorizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "background_checks_caregiver_id_idx" ON "background_checks" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "caregiver_schedules_caregiver_id_idx" ON "caregiver_schedules" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "caregiver_schedules_date_idx" ON "caregiver_schedules" USING btree ("date");--> statement-breakpoint
CREATE INDEX "caregiver_time_off_caregiver_id_idx" ON "caregiver_time_off" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "caregiver_time_off_dates_idx" ON "caregiver_time_off" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "claims_edi_batch_id_idx" ON "claims" USING btree ("edi_batch_id");--> statement-breakpoint
CREATE INDEX "claims_evv_visit_id_idx" ON "claims" USING btree ("evv_visit_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_assignments_client_id_idx" ON "client_assignments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_assignments_caregiver_id_idx" ON "client_assignments" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "client_assignments_status_idx" ON "client_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "client_emergency_contacts_client_id_idx" ON "client_emergency_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_is_active_idx" ON "clients" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "clients_referred_by_id_idx" ON "clients" USING btree ("referred_by_id");--> statement-breakpoint
CREATE INDEX "communication_log_entity_idx" ON "communication_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "communication_log_created_at_idx" ON "communication_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "edi_batches_status_idx" ON "edi_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "evv_visits_client_date_idx" ON "evv_visits" USING btree ("client_id","service_date");--> statement-breakpoint
CREATE INDEX "evv_visits_caregiver_id_idx" ON "evv_visits" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "evv_visits_sandata_status_idx" ON "evv_visits" USING btree ("sandata_status");--> statement-breakpoint
CREATE INDEX "expenses_user_id_idx" ON "expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "form_submissions_entity_idx" ON "form_submissions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "form_submissions_template_id_idx" ON "form_submissions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "form_templates_category_active_idx" ON "form_templates" USING btree ("category","is_active");--> statement-breakpoint
CREATE INDEX "gps_tracking_caregiver_id_idx" ON "gps_tracking" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "gps_tracking_time_entry_id_idx" ON "gps_tracking" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX "gps_tracking_timestamp_idx" ON "gps_tracking" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_id_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_payment_status_idx" ON "invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "login_activity_email_idx" ON "login_activity" USING btree ("email");--> statement-breakpoint
CREATE INDEX "login_activity_user_id_idx" ON "login_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_activity_created_at_idx" ON "login_activity" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_thread_participants_thread_user_idx" ON "message_thread_participants" USING btree ("thread_id","user_id");--> statement-breakpoint
CREATE INDEX "message_thread_participants_user_id_idx" ON "message_thread_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_thread_participants_thread_id_idx" ON "message_thread_participants" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "message_threads_updated_at_idx" ON "message_threads" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "noshow_alerts_status_date_idx" ON "noshow_alerts" USING btree ("status","shift_date");--> statement-breakpoint
CREATE INDEX "noshow_alerts_caregiver_id_idx" ON "noshow_alerts" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_is_read_idx" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE UNIQUE INDEX "open_shift_notifications_shift_caregiver_idx" ON "open_shift_notifications" USING btree ("open_shift_id","caregiver_id");--> statement-breakpoint
CREATE INDEX "open_shift_notifications_open_shift_id_idx" ON "open_shift_notifications" USING btree ("open_shift_id");--> statement-breakpoint
CREATE INDEX "open_shifts_date_idx" ON "open_shifts" USING btree ("date");--> statement-breakpoint
CREATE INDEX "open_shifts_status_idx" ON "open_shifts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "performance_ratings_caregiver_id_idx" ON "performance_ratings" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "performance_ratings_client_id_idx" ON "performance_ratings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_is_active_idx" ON "push_subscriptions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "referral_sources_type_idx" ON "referral_sources" USING btree ("type");--> statement-breakpoint
CREATE INDEX "referral_sources_is_active_idx" ON "referral_sources" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "remittance_batches_payer_id_idx" ON "remittance_batches" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "remittance_line_items_batch_id_idx" ON "remittance_line_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "schedules_client_id_idx" ON "schedules" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "schedules_caregiver_id_idx" ON "schedules" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "service_codes_code_idx" ON "service_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "service_codes_is_active_idx" ON "service_codes" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "time_entries_caregiver_id_idx" ON "time_entries" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "time_entries_client_id_idx" ON "time_entries" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "time_entries_start_time_idx" ON "time_entries" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "time_entries_schedule_id_idx" ON "time_entries" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "validation_log_entity_idx" ON "validation_log" USING btree ("entity_id","entity_type");