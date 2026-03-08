-- Twomiah Drive — Automotive Dealership Schema

CREATE TABLE IF NOT EXISTS "company" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
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
  "stripe_customer_id" text UNIQUE,
  "subscription_tier" text,
  "license_type" text,
  "lifetime_access" boolean DEFAULT false NOT NULL,
  "twilio_phone_number" text,
  "twilio_account_sid" text,
  "twilio_auth_token" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "phone" text,
  "avatar" text,
  "role" text DEFAULT 'user' NOT NULL,
  "hourly_rate" decimal(10,2),
  "is_active" boolean DEFAULT true NOT NULL,
  "last_login" timestamp,
  "refresh_token" text,
  "reset_token" text,
  "reset_token_exp" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_company_id_key" ON "user" ("email", "company_id");
CREATE INDEX IF NOT EXISTS "user_company_id_idx" ON "user" ("company_id");

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
  "source" text,
  "notes" text,
  "tags" json DEFAULT '[]'::json,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "contact_company_id_idx" ON "contact" ("company_id");
CREATE INDEX IF NOT EXISTS "contact_type_idx" ON "contact" ("type");

-- ==================== AUTOMOTIVE ====================

CREATE TABLE IF NOT EXISTS "vehicle" (
  "id" text PRIMARY KEY NOT NULL,
  "vin" text,
  "stock_number" text,
  "year" integer,
  "make" text,
  "model" text,
  "trim" text,
  "body_type" text,
  "exterior_color" text,
  "interior_color" text,
  "mileage" integer,
  "status" text DEFAULT 'available' NOT NULL,
  "listed_price" decimal(10,2),
  "internet_price" decimal(10,2),
  "cost" decimal(10,2),
  "photos" json DEFAULT '[]'::json NOT NULL,
  "description" text,
  "features" json DEFAULT '[]'::json NOT NULL,
  "condition" text,
  "fuel_type" text,
  "transmission" text,
  "drivetrain" text,
  "engine" text,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_vin_company_id_key" ON "vehicle" ("vin", "company_id");
CREATE INDEX IF NOT EXISTS "vehicle_company_id_idx" ON "vehicle" ("company_id");
CREATE INDEX IF NOT EXISTS "vehicle_status_idx" ON "vehicle" ("status");
CREATE INDEX IF NOT EXISTS "vehicle_make_idx" ON "vehicle" ("make");

CREATE TABLE IF NOT EXISTS "sales_lead" (
  "id" text PRIMARY KEY NOT NULL,
  "contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
  "vehicle_id" text REFERENCES "vehicle"("id") ON DELETE SET NULL,
  "source" text DEFAULT 'web' NOT NULL,
  "stage" text DEFAULT 'new' NOT NULL,
  "assigned_to" text REFERENCES "user"("id") ON DELETE SET NULL,
  "notes" text,
  "trade_in_info" json,
  "follow_up_date" timestamp,
  "closed_at" timestamp,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sales_lead_company_id_idx" ON "sales_lead" ("company_id");
CREATE INDEX IF NOT EXISTS "sales_lead_stage_idx" ON "sales_lead" ("stage");
CREATE INDEX IF NOT EXISTS "sales_lead_assigned_to_idx" ON "sales_lead" ("assigned_to");
CREATE INDEX IF NOT EXISTS "sales_lead_contact_id_idx" ON "sales_lead" ("contact_id");

CREATE TABLE IF NOT EXISTS "repair_order" (
  "id" text PRIMARY KEY NOT NULL,
  "ro_number" text NOT NULL,
  "customer_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
  "vehicle_id" text REFERENCES "vehicle"("id") ON DELETE SET NULL,
  "customer_vehicle_info" json,
  "write_up_date" timestamp DEFAULT now() NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "services" json DEFAULT '[]'::json NOT NULL,
  "advisor_name" text,
  "technician_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "estimated_total" decimal(10,2),
  "actual_total" decimal(10,2),
  "notes" text,
  "completed_at" timestamp,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "repair_order_ro_company_key" ON "repair_order" ("ro_number", "company_id");
CREATE INDEX IF NOT EXISTS "repair_order_company_id_idx" ON "repair_order" ("company_id");
CREATE INDEX IF NOT EXISTS "repair_order_status_idx" ON "repair_order" ("status");
CREATE INDEX IF NOT EXISTS "repair_order_customer_id_idx" ON "repair_order" ("customer_id");

CREATE TABLE IF NOT EXISTS "service_sales_alert" (
  "id" text PRIMARY KEY NOT NULL,
  "repair_order_id" text NOT NULL REFERENCES "repair_order"("id") ON DELETE CASCADE,
  "sales_lead_id" text REFERENCES "sales_lead"("id") ON DELETE SET NULL,
  "salesperson_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "customer_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
  "alert_message" text NOT NULL,
  "alerted_at" timestamp DEFAULT now() NOT NULL,
  "dismissed_at" timestamp,
  "converted_to_lead" boolean DEFAULT false NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "service_sales_alert_company_id_idx" ON "service_sales_alert" ("company_id");
CREATE INDEX IF NOT EXISTS "service_sales_alert_salesperson_idx" ON "service_sales_alert" ("salesperson_id");
CREATE INDEX IF NOT EXISTS "service_sales_alert_dismissed_idx" ON "service_sales_alert" ("dismissed_at");

-- ==================== SUPPORT ====================

CREATE TABLE IF NOT EXISTS "support_ticket" (
  "id" text PRIMARY KEY NOT NULL,
  "subject" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'open' NOT NULL,
  "priority" text DEFAULT 'medium' NOT NULL,
  "category" text,
  "assigned_to" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "support_ticket_message" (
  "id" text PRIMARY KEY NOT NULL,
  "ticket_id" text NOT NULL REFERENCES "support_ticket"("id") ON DELETE CASCADE,
  "sender_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "message" text NOT NULL,
  "is_internal" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "support_knowledge_base" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "category" text,
  "tags" json DEFAULT '[]'::json,
  "is_faq" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "support_sla_policy" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "first_response_minutes" integer,
  "resolution_minutes" integer,
  "escalate_after_minutes" integer,
  "active" boolean DEFAULT true NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "push_subscription" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- ==================== AUDIT ====================

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text,
  "user_email" text,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "action" text NOT NULL,
  "changes" json,
  "ip_address" text,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_log_company_id_idx" ON "audit_log" ("company_id");

-- ==================== LEAD INBOX ====================

CREATE TABLE IF NOT EXISTS "lead_source" (
  "id" text PRIMARY KEY NOT NULL,
  "platform" text NOT NULL,
  "label" text NOT NULL,
  "inbound_email" text,
  "webhook_url" text,
  "webhook_secret" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "config" json DEFAULT '{}'::json NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "lead" (
  "id" text PRIMARY KEY NOT NULL,
  "source_platform" text NOT NULL,
  "source_id" text REFERENCES "lead_source"("id") ON DELETE SET NULL,
  "homeowner_name" text NOT NULL,
  "email" text,
  "phone" text,
  "job_type" text,
  "location" text,
  "budget" text,
  "description" text,
  "status" text DEFAULT 'new' NOT NULL,
  "raw_payload" json,
  "converted_contact_id" text REFERENCES "contact"("id") ON DELETE SET NULL,
  "contacted_at" timestamp,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "lead_company_id_idx" ON "lead" ("company_id");
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" ("status");
