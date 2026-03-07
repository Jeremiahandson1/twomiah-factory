CREATE TABLE IF NOT EXISTS "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "addon_purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"addon_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"stripe_payment_id" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agreement_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"billing_frequency" text DEFAULT 'annual' NOT NULL,
	"visits_included" integer DEFAULT 0 NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"priority_service" boolean DEFAULT false NOT NULL,
	"duration_months" integer DEFAULT 12 NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"included_services" json,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agreement_visit" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"agreement_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assembly_material" (
	"id" text PRIMARY KEY NOT NULL,
	"assembly_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"quantity_per" numeric(10, 4) DEFAULT '1' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"changes" json,
	"metadata" json,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text,
	"user_name" text,
	"user_email" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"conditions" json,
	"actions" json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bid" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"project_name" text NOT NULL,
	"client" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"bid_type" text DEFAULT 'lump_sum' NOT NULL,
	"due_date" timestamp,
	"due_time" text,
	"estimated_value" numeric(12, 2),
	"bid_amount" numeric(12, 2),
	"bond_required" boolean DEFAULT false NOT NULL,
	"prebid_date" timestamp,
	"prebid_location" text,
	"scope" text,
	"notes" text,
	"submitted_at" timestamp,
	"result_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"number" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"line_items" json NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	"stripe_invoice_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoice_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookable_service" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"deposit_required" boolean DEFAULT false NOT NULL,
	"deposit_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lead_time_days" integer DEFAULT 1 NOT NULL,
	"max_days_out" integer DEFAULT 30 NOT NULL,
	"slot_duration_minutes" integer DEFAULT 60 NOT NULL,
	"working_hours" json NOT NULL,
	"primary_color" text,
	"logo" text,
	"welcome_message" text,
	"confirmation_message" text,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_sms" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "booking_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tracking_number_id" text,
	"contact_id" text,
	"caller_number" text,
	"caller_name" text,
	"caller_city" text,
	"caller_state" text,
	"duration" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"recording_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"content" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_date" timestamp,
	"sent_at" timestamp,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_order" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"days_added" integer DEFAULT 0 NOT NULL,
	"submitted_date" timestamp,
	"approved_date" timestamp,
	"approved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_order_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"change_order_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"content" text NOT NULL,
	"mentions" json,
	"attachments" json,
	"parent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"comment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reaction" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"logo" text,
	"primary_color" text DEFAULT '{{PRIMARY_COLOR}}' NOT NULL,
	"secondary_color" text,
	"website" text,
	"license_number" text,
	"enabled_features" json DEFAULT '[]'::json NOT NULL,
	"settings" json DEFAULT '{}'::json NOT NULL,
	"integrations" json DEFAULT '{}'::json NOT NULL,
	"stripe_customer_id" text,
	"subscription_tier" text,
	"license_type" text,
	"lifetime_access" boolean DEFAULT false NOT NULL,
	"twilio_phone_number" text,
	"twilio_account_sid" text,
	"twilio_auth_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_slug_unique" UNIQUE("slug"),
	CONSTRAINT "company_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'lead' NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" real,
	"lng" real,
	"notes" text,
	"source" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"custom_fields" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_log" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"weather" text,
	"conditions" text,
	"crew_size" integer,
	"hours_worked" numeric(10, 2),
	"work_performed" text,
	"materials" text,
	"equipment" text,
	"delays" text,
	"safety_notes" text,
	"temperature" integer,
	"work_completed" text,
	"visitors" text,
	"photos" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'general' NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"path" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"contact_id" text,
	"job_id" text,
	"invoice_id" text,
	"uploaded_by_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "draw_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"draw_request_id" text NOT NULL,
	"sov_line_item_id" text NOT NULL,
	"completed_this_period" numeric(12, 2) DEFAULT '0' NOT NULL,
	"materials_stored" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "draw_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"schedule_of_values_id" text NOT NULL,
	"project_id" text NOT NULL,
	"draw_number" integer NOT NULL,
	"period_from" timestamp,
	"period_to" timestamp,
	"gross_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"retainage_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"approved_by_id" text,
	"approval_notes" text,
	"rejected_at" timestamp,
	"rejected_by_id" text,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drip_sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"steps" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recipient_filter" json,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"stats" json,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_click" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"url" text NOT NULL,
	"clicked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"sendgrid_id" text,
	"error_message" text,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"company_id" text NOT NULL,
	"contact_id" text,
	"sent_by_id" text,
	"invoice_id" text,
	"quote_id" text,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"type" text,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"serial_number" text,
	"model" text,
	"manufacturer" text,
	"status" text DEFAULT 'active' NOT NULL,
	"location" text,
	"purchase_date" timestamp,
	"warranty_expiry" timestamp,
	"notes" text,
	"company_id" text NOT NULL,
	"category_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_maintenance" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"cost" numeric(10, 2),
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"next_due_date" timestamp,
	"equipment_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_service_record" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_id" text NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text,
	"technician_id" text,
	"service_date" timestamp DEFAULT now() NOT NULL,
	"service_type" text NOT NULL,
	"description" text,
	"parts_used" json,
	"labor_hours" numeric(8, 2),
	"cost" numeric(12, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment_type" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"brand" text,
	"default_warranty_months" integer DEFAULT 12 NOT NULL,
	"default_lifespan_years" integer DEFAULT 15 NOT NULL,
	"maintenance_interval_months" integer DEFAULT 12 NOT NULL,
	"fields" json,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"vendor" text,
	"description" text,
	"amount" numeric(12, 2) NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"receipt_url" text,
	"billable" boolean DEFAULT true NOT NULL,
	"reimbursable" boolean DEFAULT false NOT NULL,
	"reimbursed" boolean DEFAULT false NOT NULL,
	"reimbursed_at" timestamp,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financing_application" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"term" integer,
	"external_id" text,
	"application_url" text,
	"approved_amount" numeric(12, 2),
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"template_id" text NOT NULL,
	"job_id" text,
	"project_id" text,
	"contact_id" text,
	"values" json NOT NULL,
	"signature" text,
	"signed_at" timestamp,
	"signed_by" text,
	"submitted_by_id" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"fields" json NOT NULL,
	"require_signature" boolean DEFAULT false NOT NULL,
	"require_photo" boolean DEFAULT false NOT NULL,
	"auto_attach_to" json,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_log" (
	"id" text PRIMARY KEY NOT NULL,
	"gallons" numeric(8, 3) NOT NULL,
	"price_per_gallon" numeric(6, 3) NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"mileage" integer,
	"station" text,
	"vehicle_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geofence" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"radius" integer DEFAULT 100 NOT NULL,
	"address" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text,
	"project_id" text,
	CONSTRAINT "geofence_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "geofence_event" (
	"id" text PRIMARY KEY NOT NULL,
	"inside" boolean NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"accuracy" real,
	"distance" real,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"geofence_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_date" timestamp,
	"inspector" text,
	"result" text,
	"notes" text,
	"deficiencies" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"unit_cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"unit_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"min_stock_level" integer DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"reorder_quantity" integer DEFAULT 0 NOT NULL,
	"vendor" text,
	"vendor_part_number" text,
	"barcode" text,
	"image_url" text,
	"taxable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_location" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'warehouse' NOT NULL,
	"address" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"assigned_user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL,
	"previous_quantity" integer NOT NULL,
	"new_quantity" integer NOT NULL,
	"reason" text,
	"cost" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"item_id" text NOT NULL,
	"location_id" text NOT NULL,
	"user_id" text,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_transfer" (
	"id" text PRIMARY KEY NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"item_id" text NOT NULL,
	"from_location_id" text NOT NULL,
	"to_location_id" text NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"quantity" integer NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" numeric(10, 2) NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"item_id" text NOT NULL,
	"location_id" text NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"terms" text,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"project_id" text,
	"quote_id" text,
	CONSTRAINT "invoice_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"type" text,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"invoice_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"type" text,
	"source" text,
	"scheduled_date" timestamp,
	"scheduled_end_date" timestamp,
	"scheduled_time" text,
	"estimated_hours" numeric(5, 2),
	"estimated_value" numeric(12, 2),
	"actual_hours" numeric(5, 2),
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" real,
	"lng" real,
	"geofence_radius" integer DEFAULT 100,
	"notes" text,
	"internal_notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"contact_id" text,
	"assigned_to_id" text,
	"created_by_id" text,
	"quote_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "license" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"package_id" text,
	"features" json NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"stripe_payment_id" text,
	"purchased_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lien_waiver" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"vendor_id" text,
	"vendor_name" text NOT NULL,
	"vendor_type" text,
	"waiver_type" text NOT NULL,
	"through_date" timestamp,
	"amount_previous" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_current" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_at" timestamp,
	"due_date" timestamp,
	"received_at" timestamp,
	"document_url" text,
	"signed_date" timestamp,
	"notarized" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp,
	"approved_by_id" text,
	"approval_notes" text,
	"rejected_at" timestamp,
	"rejected_by_id" text,
	"rejection_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "location_log" (
	"id" text PRIMARY KEY NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"accuracy" real,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"action" text,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'email' NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_state" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"provider" text NOT NULL,
	"company_id" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_state_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "online_booking" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text,
	"contact_id" text,
	"service_id" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"scheduled_date" timestamp NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment" (
	"id" text PRIMARY KEY NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text DEFAULT 'other' NOT NULL,
	"reference" text,
	"notes" text,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"invoice_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_call" (
	"id" text PRIMARY KEY NOT NULL,
	"caller_number" text NOT NULL,
	"status" text NOT NULL,
	"duration" integer,
	"recording_url" text,
	"transcription" text,
	"tracking_number_id" text NOT NULL,
	"company_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"entity_type" text,
	"entity_id" text,
	"filename" text NOT NULL,
	"original_name" text,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"size" integer,
	"width" integer,
	"height" integer,
	"thumbnail_path" text,
	"caption" text,
	"tags" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_good_better_best" (
	"id" text PRIMARY KEY NOT NULL,
	"pricebook_item_id" text NOT NULL,
	"tier" text NOT NULL,
	"name" text,
	"description" text,
	"price" numeric(12, 2) NOT NULL,
	"features" json
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'service' NOT NULL,
	"code" text,
	"price" numeric(12, 2) NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"category_id" text,
	"inventory_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_material" (
	"id" text PRIMARY KEY NOT NULL,
	"pricebook_item_id" text NOT NULL,
	"inventory_item_id" text,
	"quantity" numeric(10, 4) DEFAULT '1' NOT NULL,
	"price_override" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"type" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" real,
	"lng" real,
	"start_date" timestamp,
	"end_date" timestamp,
	"estimated_value" numeric(12, 2),
	"actual_value" numeric(12, 2),
	"budget" numeric(12, 2),
	"progress" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_baseline" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"task_snapshots" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_selection" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"category_id" text,
	"name" text NOT NULL,
	"description" text,
	"location" text,
	"allowance" numeric(12, 2),
	"status" text DEFAULT 'pending' NOT NULL,
	"selected_option_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_task" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"description" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"duration" integer,
	"progress" integer DEFAULT 0 NOT NULL,
	"assigned_to_id" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_warranty" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"contact_id" text,
	"template_id" text,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"coverage_details" text,
	"exclusions" text,
	"start_date" timestamp,
	"duration_months" integer DEFAULT 12 NOT NULL,
	"expires_at" timestamp,
	"document_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "punch_list_item" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" text,
	"due_date" timestamp,
	"completed_at" timestamp,
	"verified_at" timestamp,
	"verified_by" text,
	"photos" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"vendor" text NOT NULL,
	"vendor_email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"expected_date" timestamp,
	"received_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"location_id" text NOT NULL,
	"created_by_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" numeric(10, 2) NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"purchase_order_id" text NOT NULL,
	"item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"expiry_date" timestamp,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"terms" text,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"approved_at" timestamp,
	"signature" text,
	"signed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"type" text,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"quote_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"project_id" text,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"next_run_date" timestamp NOT NULL,
	"terms" text DEFAULT '30' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"auto_send" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"recurring_invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recurring_schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pattern" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"days_of_week" json DEFAULT '[]'::json NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review" (
	"id" text PRIMARY KEY NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"platform" text DEFAULT 'google' NOT NULL,
	"external_id" text,
	"company_id" text NOT NULL,
	"contact_id" text,
	"request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "review_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_request" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"opened_at" timestamp,
	"submitted_at" timestamp,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rfi" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"subject" text NOT NULL,
	"question" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" text,
	"due_date" timestamp,
	"response" text,
	"responded_at" timestamp,
	"responded_by" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_event" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'appointment' NOT NULL,
	"start" timestamp NOT NULL,
	"end" timestamp NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"color" text,
	"company_id" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_of_values" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"contract_amount" numeric(12, 2) NOT NULL,
	"retainage_percent" numeric(5, 2) DEFAULT '10' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_of_values_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_sms" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"body" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"job_id" text,
	"created_by_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selection" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"approved_at" timestamp,
	"project_id" text NOT NULL,
	"contact_id" text,
	"item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selection_category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selection_item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"image_url" text,
	"allowance" numeric(12, 2),
	"active" boolean DEFAULT true NOT NULL,
	"category_id" text NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selection_option" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"category_id" text,
	"name" text NOT NULL,
	"description" text,
	"manufacturer" text,
	"model" text,
	"sku" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"image_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "self_hosted_license" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"company_name" text NOT NULL,
	"license_type" text NOT NULL,
	"license_key" text NOT NULL,
	"stripe_session_id" text,
	"stripe_customer_id" text,
	"purchased_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"last_download_at" timestamp,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "self_hosted_license_license_key_unique" UNIQUE("license_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_email_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_agreement" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"renewal_type" text DEFAULT 'auto' NOT NULL,
	"billing_frequency" text DEFAULT 'monthly' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"terms" text,
	"notes" text,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"plan_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_auto_responder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"keywords" json,
	"message" text NOT NULL,
	"after_hours_only" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_message" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"twilio_sid" text,
	"error_code" text,
	"error_message" text,
	"media_urls" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"conversation_id" text NOT NULL,
	"sent_by_id" text,
	CONSTRAINT "sms_message_twilio_sid_unique" UNIQUE("twilio_sid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sov_line_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"schedule_of_values_id" text NOT NULL,
	"item_number" text NOT NULL,
	"description" text NOT NULL,
	"scheduled_value" numeric(12, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_level" (
	"id" text PRIMARY KEY NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"item_id" text NOT NULL,
	"location_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submittal" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"spec_section" text,
	"due_date" timestamp,
	"submitted_date" timestamp,
	"approved_date" timestamp,
	"approved_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"package_id" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"user_count" integer DEFAULT 1 NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"features" json DEFAULT '[]'::json NOT NULL,
	"addons" json,
	"trial_ends_at" timestamp,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_company_id_unique" UNIQUE("company_id"),
	CONSTRAINT "subscription_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takeoff" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takeoff_assembly" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"measurement_type" text DEFAULT 'area' NOT NULL,
	"waste_factor" numeric(5, 2) DEFAULT '10' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takeoff_calculated_material" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"material_name" text NOT NULL,
	"unit" text NOT NULL,
	"base_quantity" numeric(12, 4) NOT NULL,
	"waste_quantity" numeric(12, 4) DEFAULT '0' NOT NULL,
	"total_quantity" numeric(12, 4) NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takeoff_item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"quantity" numeric(12, 4) NOT NULL,
	"unit" text NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"category" text,
	"takeoff_id" text NOT NULL,
	"sheet_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takeoff_sheet" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"description" text,
	"plan_reference" text,
	"plan_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"created_by_id" text,
	"assigned_to_id" text,
	"project_id" text,
	"job_id" text,
	"contact_id" text,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checklist" json,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_dependency" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"predecessor_id" text NOT NULL,
	"successor_id" text NOT NULL,
	"type" text DEFAULT 'finish_to_start' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"department" text,
	"hire_date" timestamp,
	"hourly_rate" numeric(10, 2),
	"active" boolean DEFAULT true NOT NULL,
	"skills" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"hourly_rate" numeric(10, 2),
	"description" text,
	"billable" boolean DEFAULT true NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp,
	"is_auto_clocked" boolean DEFAULT false NOT NULL,
	"clock_in" timestamp,
	"clock_out" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text,
	"project_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracking_number" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"forward_to" text NOT NULL,
	"name" text,
	"source" text,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_record" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"metadata" json,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"avatar" text,
	"role" text DEFAULT 'user' NOT NULL,
	"hourly_rate" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login" timestamp,
	"refresh_token" text,
	"reset_token" text,
	"reset_token_exp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"location_tracking_enabled" boolean DEFAULT false NOT NULL,
	"auto_clock_enabled" boolean DEFAULT false NOT NULL,
	"background_tracking_enabled" boolean DEFAULT false NOT NULL,
	"location_accuracy" text DEFAULT 'high' NOT NULL,
	"tracking_interval" integer DEFAULT 30 NOT NULL,
	"geofence_radius" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'truck' NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"vin" text,
	"license_plate" text,
	"status" text DEFAULT 'active' NOT NULL,
	"color" text,
	"notes" text,
	"assigned_user_id" text,
	"current_mileage" integer,
	"fuel_type" text,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_maintenance" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"cost" numeric(10, 2),
	"mileage" integer,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"next_due_date" timestamp,
	"next_due_mileage" integer,
	"vehicle_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"duration" integer,
	"duration_unit" text,
	"coverage" text,
	"notes" text,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"description" text NOT NULL,
	"resolution" text,
	"resolved_at" timestamp,
	"warranty_id" text NOT NULL,
	"project_warranty_id" text,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_template" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"duration_months" integer DEFAULT 12 NOT NULL,
	"coverage_details" text,
	"exclusions" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "addon_purchase" ADD CONSTRAINT "addon_purchase_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_plan" ADD CONSTRAINT "agreement_plan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_visit" ADD CONSTRAINT "agreement_visit_agreement_id_service_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."service_agreement"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assembly_material" ADD CONSTRAINT "assembly_material_assembly_id_takeoff_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."takeoff_assembly"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation" ADD CONSTRAINT "automation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bid" ADD CONSTRAINT "bid_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_invoice" ADD CONSTRAINT "billing_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookable_service" ADD CONSTRAINT "bookable_service_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_tracking_number_id_tracking_number_id_fk" FOREIGN KEY ("tracking_number_id") REFERENCES "public"."tracking_number"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign" ADD CONSTRAINT "campaign_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order" ADD CONSTRAINT "change_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order" ADD CONSTRAINT "change_order_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order_line_item" ADD CONSTRAINT "change_order_line_item_change_order_id_change_order_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment" ADD CONSTRAINT "comment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment" ADD CONSTRAINT "comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_reaction" ADD CONSTRAINT "comment_reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_log" ADD CONSTRAINT "daily_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_log" ADD CONSTRAINT "daily_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_log" ADD CONSTRAINT "daily_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_line_item" ADD CONSTRAINT "draw_line_item_draw_request_id_draw_request_id_fk" FOREIGN KEY ("draw_request_id") REFERENCES "public"."draw_request"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_line_item" ADD CONSTRAINT "draw_line_item_sov_line_item_id_sov_line_item_id_fk" FOREIGN KEY ("sov_line_item_id") REFERENCES "public"."sov_line_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_request" ADD CONSTRAINT "draw_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_request" ADD CONSTRAINT "draw_request_schedule_of_values_id_schedule_of_values_id_fk" FOREIGN KEY ("schedule_of_values_id") REFERENCES "public"."schedule_of_values"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_request" ADD CONSTRAINT "draw_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_request" ADD CONSTRAINT "draw_request_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "draw_request" ADD CONSTRAINT "draw_request_rejected_by_id_user_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drip_sequence" ADD CONSTRAINT "drip_sequence_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_campaign" ADD CONSTRAINT "email_campaign_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_click" ADD CONSTRAINT "email_click_recipient_id_email_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."email_recipient"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_log" ADD CONSTRAINT "email_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_log" ADD CONSTRAINT "email_log_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_log" ADD CONSTRAINT "email_log_sent_by_id_user_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_campaign_id_email_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaign"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_recipient" ADD CONSTRAINT "email_recipient_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_template" ADD CONSTRAINT "email_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment" ADD CONSTRAINT "equipment_category_id_equipment_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."equipment_category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_category" ADD CONSTRAINT "equipment_category_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_maintenance" ADD CONSTRAINT "equipment_maintenance_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_service_record" ADD CONSTRAINT "equipment_service_record_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_service_record" ADD CONSTRAINT "equipment_service_record_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_service_record" ADD CONSTRAINT "equipment_service_record_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_service_record" ADD CONSTRAINT "equipment_service_record_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment_type" ADD CONSTRAINT "equipment_type_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense" ADD CONSTRAINT "expense_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense" ADD CONSTRAINT "expense_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense" ADD CONSTRAINT "expense_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_application" ADD CONSTRAINT "financing_application_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financing_application" ADD CONSTRAINT "financing_application_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_template_id_form_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_submitted_by_id_user_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_template" ADD CONSTRAINT "form_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fuel_log" ADD CONSTRAINT "fuel_log_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence" ADD CONSTRAINT "geofence_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence" ADD CONSTRAINT "geofence_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence" ADD CONSTRAINT "geofence_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence_event" ADD CONSTRAINT "geofence_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "geofence_event" ADD CONSTRAINT "geofence_event_geofence_id_geofence_id_fk" FOREIGN KEY ("geofence_id") REFERENCES "public"."geofence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection" ADD CONSTRAINT "inspection_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inspection" ADD CONSTRAINT "inspection_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_location" ADD CONSTRAINT "inventory_location_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_location" ADD CONSTRAINT "inventory_location_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transaction" ADD CONSTRAINT "inventory_transaction_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_from_location_id_inventory_location_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_to_location_id_inventory_location_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_usage" ADD CONSTRAINT "inventory_usage_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_usage" ADD CONSTRAINT "inventory_usage_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_usage" ADD CONSTRAINT "inventory_usage_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_usage" ADD CONSTRAINT "inventory_usage_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inventory_usage" ADD CONSTRAINT "inventory_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_item" ADD CONSTRAINT "invoice_line_item_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_assignment" ADD CONSTRAINT "job_assignment_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_assignment" ADD CONSTRAINT "job_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "license" ADD CONSTRAINT "license_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lien_waiver" ADD CONSTRAINT "lien_waiver_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lien_waiver" ADD CONSTRAINT "lien_waiver_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lien_waiver" ADD CONSTRAINT "lien_waiver_vendor_id_contact_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lien_waiver" ADD CONSTRAINT "lien_waiver_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lien_waiver" ADD CONSTRAINT "lien_waiver_rejected_by_id_user_id_fk" FOREIGN KEY ("rejected_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_log" ADD CONSTRAINT "location_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_log" ADD CONSTRAINT "location_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "location_log" ADD CONSTRAINT "location_log_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "online_booking" ADD CONSTRAINT "online_booking_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "online_booking" ADD CONSTRAINT "online_booking_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "online_booking" ADD CONSTRAINT "online_booking_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "online_booking" ADD CONSTRAINT "online_booking_service_id_bookable_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."bookable_service"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_call" ADD CONSTRAINT "phone_call_tracking_number_id_tracking_number_id_fk" FOREIGN KEY ("tracking_number_id") REFERENCES "public"."tracking_number"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_call" ADD CONSTRAINT "phone_call_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photo" ADD CONSTRAINT "photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_category" ADD CONSTRAINT "pricebook_category_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_good_better_best" ADD CONSTRAINT "pricebook_good_better_best_pricebook_item_id_pricebook_item_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_item" ADD CONSTRAINT "pricebook_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_item" ADD CONSTRAINT "pricebook_item_category_id_pricebook_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."pricebook_category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_item" ADD CONSTRAINT "pricebook_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_material" ADD CONSTRAINT "pricebook_material_pricebook_item_id_pricebook_item_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_material" ADD CONSTRAINT "pricebook_material_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product" ADD CONSTRAINT "product_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project" ADD CONSTRAINT "project_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project" ADD CONSTRAINT "project_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_baseline" ADD CONSTRAINT "project_baseline_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_selection" ADD CONSTRAINT "project_selection_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_selection" ADD CONSTRAINT "project_selection_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_selection" ADD CONSTRAINT "project_selection_category_id_selection_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."selection_category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_task" ADD CONSTRAINT "project_task_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_warranty" ADD CONSTRAINT "project_warranty_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_warranty" ADD CONSTRAINT "project_warranty_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_warranty" ADD CONSTRAINT "project_warranty_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_warranty" ADD CONSTRAINT "project_warranty_template_id_warranty_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."warranty_template"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "punch_list_item" ADD CONSTRAINT "punch_list_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "punch_list_item" ADD CONSTRAINT "punch_list_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_order_id_purchase_order_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_order_item" ADD CONSTRAINT "purchase_order_item_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote_line_item" ADD CONSTRAINT "quote_line_item_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_invoice" ADD CONSTRAINT "recurring_invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_invoice" ADD CONSTRAINT "recurring_invoice_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_invoice" ADD CONSTRAINT "recurring_invoice_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_line_item" ADD CONSTRAINT "recurring_line_item_recurring_invoice_id_recurring_invoice_id_fk" FOREIGN KEY ("recurring_invoice_id") REFERENCES "public"."recurring_invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_schedule" ADD CONSTRAINT "recurring_schedule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review" ADD CONSTRAINT "review_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review" ADD CONSTRAINT "review_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review" ADD CONSTRAINT "review_request_id_review_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_request"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_request" ADD CONSTRAINT "review_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_request" ADD CONSTRAINT "review_request_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rfi" ADD CONSTRAINT "rfi_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rfi" ADD CONSTRAINT "rfi_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_event" ADD CONSTRAINT "schedule_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_event" ADD CONSTRAINT "schedule_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_of_values" ADD CONSTRAINT "schedule_of_values_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_of_values" ADD CONSTRAINT "schedule_of_values_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_sms" ADD CONSTRAINT "scheduled_sms_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection" ADD CONSTRAINT "selection_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection" ADD CONSTRAINT "selection_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection" ADD CONSTRAINT "selection_item_id_selection_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."selection_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection_category" ADD CONSTRAINT "selection_category_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection_item" ADD CONSTRAINT "selection_item_category_id_selection_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."selection_category"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection_item" ADD CONSTRAINT "selection_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection_option" ADD CONSTRAINT "selection_option_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "selection_option" ADD CONSTRAINT "selection_option_category_id_selection_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."selection_category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_sequence_id_drip_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."drip_sequence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_auto_responder" ADD CONSTRAINT "sms_auto_responder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_conversation" ADD CONSTRAINT "sms_conversation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_conversation" ADD CONSTRAINT "sms_conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_conversation_id_sms_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sms_conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_sent_by_id_user_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_template" ADD CONSTRAINT "sms_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sov_line_item" ADD CONSTRAINT "sov_line_item_schedule_of_values_id_schedule_of_values_id_fk" FOREIGN KEY ("schedule_of_values_id") REFERENCES "public"."schedule_of_values"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_location_id_inventory_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submittal" ADD CONSTRAINT "submittal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submittal" ADD CONSTRAINT "submittal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription" ADD CONSTRAINT "subscription_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff" ADD CONSTRAINT "takeoff_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff" ADD CONSTRAINT "takeoff_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff_assembly" ADD CONSTRAINT "takeoff_assembly_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff_calculated_material" ADD CONSTRAINT "takeoff_calculated_material_item_id_project_task_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."project_task"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff_item" ADD CONSTRAINT "takeoff_item_takeoff_id_takeoff_id_fk" FOREIGN KEY ("takeoff_id") REFERENCES "public"."takeoff"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff_sheet" ADD CONSTRAINT "takeoff_sheet_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "takeoff_sheet" ADD CONSTRAINT "takeoff_sheet_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_predecessor_id_project_task_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."project_task"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_successor_id_project_task_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."project_task"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_member" ADD CONSTRAINT "team_member_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracking_number" ADD CONSTRAINT "tracking_number_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user" ADD CONSTRAINT "user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_vehicle_id_vehicle_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty" ADD CONSTRAINT "warranty_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_warranty_id_warranty_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."warranty"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_claim" ADD CONSTRAINT "warranty_claim_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warranty_template" ADD CONSTRAINT "warranty_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_company_id_idx" ON "activity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_entity_type_entity_id_idx" ON "activity" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_company_id_idx" ON "activity_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_entity_type_entity_id_idx" ON "activity_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "addon_purchase_company_id_idx" ON "addon_purchase" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_plan_company_id_active_idx" ON "agreement_plan" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_visit_agreement_id_idx" ON "agreement_visit" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assembly_material_assembly_id_idx" ON "assembly_material" USING btree ("assembly_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_company_id_idx" ON "audit_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_entity_id_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_company_id_idx" ON "automation" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_company_id_idx" ON "bid" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bid_status_idx" ON "bid" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoice_company_id_idx" ON "billing_invoice" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookable_service_company_id_idx" ON "bookable_service" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_log_company_id_idx" ON "call_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_log_contact_id_idx" ON "call_log" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_company_id_idx" ON "campaign" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_order_company_id_idx" ON "change_order" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_order_project_id_idx" ON "change_order" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_order_line_item_change_order_id_idx" ON "change_order_line_item" USING btree ("change_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_company_id_idx" ON "comment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_entity_type_entity_id_idx" ON "comment" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_reaction_comment_id_user_id_reaction_idx" ON "comment_reaction" USING btree ("comment_id","user_id","reaction");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reaction_comment_id_idx" ON "comment_reaction" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_company_id_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_type_idx" ON "contact" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_log_company_id_idx" ON "daily_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_log_project_id_idx" ON "daily_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_log_date_idx" ON "daily_log" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_company_id_idx" ON "document" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_project_id_idx" ON "document" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_contact_id_idx" ON "document" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_type_idx" ON "document" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "draw_line_item_draw_request_id_idx" ON "draw_line_item" USING btree ("draw_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "draw_request_schedule_of_values_id_draw_number_idx" ON "draw_request" USING btree ("schedule_of_values_id","draw_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "draw_request_company_id_idx" ON "draw_request" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "draw_request_project_id_idx" ON "draw_request" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drip_sequence_company_id_idx" ON "drip_sequence" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_campaign_company_id_idx" ON "email_campaign" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_click_recipient_id_idx" ON "email_click" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_log_company_id_created_at_idx" ON "email_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_log_contact_id_idx" ON "email_log" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_recipient_campaign_id_status_idx" ON "email_recipient" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_template_company_id_idx" ON "email_template" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_company_id_idx" ON "equipment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_category_company_id_idx" ON "equipment_category" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_maintenance_equipment_id_idx" ON "equipment_maintenance" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_service_record_equipment_id_idx" ON "equipment_service_record" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_service_record_company_id_idx" ON "equipment_service_record" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_type_company_id_active_idx" ON "equipment_type" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_company_id_idx" ON "expense" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_project_id_idx" ON "expense" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_job_id_idx" ON "expense" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financing_application_company_id_idx" ON "financing_application" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submission_company_id_idx" ON "form_submission" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_submission_template_id_idx" ON "form_submission" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_template_company_id_idx" ON "form_template" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fuel_log_vehicle_id_idx" ON "fuel_log" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geofence_company_id_active_idx" ON "geofence" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "geofence_event_user_id_geofence_id_timestamp_idx" ON "geofence_event" USING btree ("user_id","geofence_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_company_id_idx" ON "inspection" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inspection_project_id_idx" ON "inspection" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_item_company_id_sku_key" ON "inventory_item" USING btree ("company_id","sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_item_company_id_category_idx" ON "inventory_item" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_location_company_id_type_idx" ON "inventory_location" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_transaction_company_id_created_at_idx" ON "inventory_transaction" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_transfer_company_id_status_idx" ON "inventory_transfer" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_usage_job_id_idx" ON "inventory_usage" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_company_id_idx" ON "invoice" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_item_invoice_id_idx" ON "invoice_line_item" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_company_id_idx" ON "job" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_status_idx" ON "job" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_scheduled_date_idx" ON "job" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_assigned_to_id_idx" ON "job" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_assignment_job_id_user_id_idx" ON "job_assignment" USING btree ("job_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_assignment_job_id_idx" ON "job_assignment" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_assignment_user_id_idx" ON "job_assignment" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "license_company_id_idx" ON "license" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lien_waiver_company_id_idx" ON "lien_waiver" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lien_waiver_project_id_idx" ON "lien_waiver" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_log_user_id_company_id_timestamp_idx" ON "location_log" USING btree ("user_id","company_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "location_log_job_id_idx" ON "location_log" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_company_id_idx" ON "message" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_contact_id_idx" ON "message" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_state_state_idx" ON "oauth_state" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "online_booking_company_id_idx" ON "online_booking" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_invoice_id_idx" ON "payment" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_call_tracking_number_id_idx" ON "phone_call" USING btree ("tracking_number_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_company_id_idx" ON "photo" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_entity_type_entity_id_idx" ON "photo" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_category_company_id_idx" ON "pricebook_category" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_good_better_best_pricebook_item_id_idx" ON "pricebook_good_better_best" USING btree ("pricebook_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_item_company_id_idx" ON "pricebook_item" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_item_category_id_idx" ON "pricebook_item" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_material_pricebook_item_id_idx" ON "pricebook_material" USING btree ("pricebook_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_company_id_idx" ON "product" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_company_id_idx" ON "project" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_status_idx" ON "project" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_baseline_project_id_idx" ON "project_baseline" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_selection_project_id_idx" ON "project_selection" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_project_id_idx" ON "project_task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_task_parent_id_idx" ON "project_task" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_warranty_company_id_idx" ON "project_warranty" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_warranty_project_id_idx" ON "project_warranty" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punch_list_item_company_id_idx" ON "punch_list_item" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punch_list_item_project_id_idx" ON "punch_list_item" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "punch_list_item_status_idx" ON "punch_list_item" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_company_id_number_key" ON "purchase_order" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_company_id_idx" ON "quote" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_status_idx" ON "quote" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_line_item_quote_id_idx" ON "quote_line_item" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_invoice_company_id_idx" ON "recurring_invoice" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_invoice_next_run_date_idx" ON "recurring_invoice" USING btree ("next_run_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_line_item_recurring_invoice_id_idx" ON "recurring_line_item" USING btree ("recurring_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_schedule_company_id_idx" ON "recurring_schedule" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_company_id_idx" ON "review" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_company_id_idx" ON "review_request" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rfi_company_id_idx" ON "rfi" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rfi_project_id_idx" ON "rfi" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_event_company_id_start_idx" ON "schedule_event" USING btree ("company_id","start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_of_values_company_id_idx" ON "schedule_of_values" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_sms_company_id_scheduled_for_status_idx" ON "scheduled_sms" USING btree ("company_id","scheduled_for","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_project_id_idx" ON "selection" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_category_company_id_idx" ON "selection_category" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_category_company_id_active_idx" ON "selection_category" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_item_category_id_idx" ON "selection_item" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_item_company_id_active_idx" ON "selection_item" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_option_company_id_idx" ON "selection_option" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "selection_option_category_id_idx" ON "selection_option" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_hosted_license_email_idx" ON "self_hosted_license" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "self_hosted_license_license_key_idx" ON "self_hosted_license" USING btree ("license_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollment_sequence_id_idx" ON "sequence_enrollment" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollment_contact_id_idx" ON "sequence_enrollment" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollment_next_email_at_idx" ON "sequence_enrollment" USING btree ("next_email_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_agreement_company_id_idx" ON "service_agreement" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_auto_responder_company_id_idx" ON "sms_auto_responder" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_conversation_company_id_phone_number_key" ON "sms_conversation" USING btree ("company_id","phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_conversation_company_id_status_idx" ON "sms_conversation" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_message_conversation_id_created_at_idx" ON "sms_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_template_company_id_category_idx" ON "sms_template" USING btree ("company_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sov_line_item_schedule_of_values_id_idx" ON "sov_line_item" USING btree ("schedule_of_values_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_level_item_id_location_id_key" ON "stock_level" USING btree ("item_id","location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submittal_company_id_idx" ON "submittal" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submittal_project_id_idx" ON "submittal" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeoff_company_id_idx" ON "takeoff" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeoff_assembly_company_id_active_idx" ON "takeoff_assembly" USING btree ("company_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeoff_calculated_material_item_id_idx" ON "takeoff_calculated_material" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeoff_item_takeoff_id_idx" ON "takeoff_item" USING btree ("takeoff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeoff_sheet_company_id_idx" ON "takeoff_sheet" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takeoff_sheet_project_id_idx" ON "takeoff_sheet" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_company_id_idx" ON "task" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_assigned_to_id_idx" ON "task" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_project_id_idx" ON "task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_due_date_idx" ON "task" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_dependency_project_id_idx" ON "task_dependency" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_member_company_id_idx" ON "team_member" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_company_id_idx" ON "time_entry" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_user_id_idx" ON "time_entry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_job_id_idx" ON "time_entry" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_date_idx" ON "time_entry" USING btree ("date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_number_company_id_idx" ON "tracking_number" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_record_company_id_type_recorded_at_idx" ON "usage_record" USING btree ("company_id","type","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_company_id_key" ON "user" USING btree ("email","company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_company_id_idx" ON "user" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_company_id_idx" ON "vehicle" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_assigned_user_id_idx" ON "vehicle" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_vehicle_id_idx" ON "vehicle_maintenance" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranty_company_id_idx" ON "warranty" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranty_claim_warranty_id_idx" ON "warranty_claim" USING btree ("warranty_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warranty_template_company_id_active_idx" ON "warranty_template" USING btree ("company_id","active");