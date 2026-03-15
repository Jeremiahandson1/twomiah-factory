-- Base tables (company, users, contacts + dispensary fields)
CREATE TABLE IF NOT EXISTS "company" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT UNIQUE,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,
  "website" TEXT,
  "logo" TEXT,
  "primary_color" TEXT DEFAULT '#16a34a',
  "secondary_color" TEXT DEFAULT '#14532d',
  "license_number" TEXT,
  "enabled_features" JSONB DEFAULT '[]',
  "settings" JSONB DEFAULT '{}',
  "integrations" JSONB DEFAULT '{}',
  "store_hours" JSONB DEFAULT '{}',
  "tax_rate" TEXT DEFAULT '10',
  "loyalty_points_per_dollar" INTEGER DEFAULT 1,
  "loyalty_enabled" BOOLEAN DEFAULT true,
  "delivery_enabled" BOOLEAN DEFAULT false,
  "merch_enabled" BOOLEAN DEFAULT false,
  "purchase_limit_oz" TEXT DEFAULT '2.5',
  "stripe_customer_id" TEXT UNIQUE,
  "subscription_tier" TEXT,
  "license_type" TEXT,
  "lifetime_access" BOOLEAN DEFAULT false NOT NULL,
  "twilio_phone_number" TEXT,
  "twilio_account_sid" TEXT,
  "twilio_auth_token" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "phone" TEXT,
  "avatar" TEXT,
  "role" TEXT DEFAULT 'owner' NOT NULL,
  "hourly_rate" NUMERIC(10, 2),
  "is_active" BOOLEAN DEFAULT true NOT NULL,
  "last_login" TIMESTAMP,
  "refresh_token" TEXT,
  "reset_token" TEXT,
  "reset_token_exp" TIMESTAMP,
  "pin_hash" TEXT,
  "pin_attempts" INTEGER DEFAULT 0,
  "pin_locked_until" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_company_id_key" ON "user" ("email", "company_id");
CREATE INDEX IF NOT EXISTS "user_company_id_idx" ON "user" ("company_id");

CREATE TABLE IF NOT EXISTS "contact" (
  "id" TEXT PRIMARY KEY,
  "type" TEXT DEFAULT 'lead' NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "mobile" TEXT,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,
  "lat" REAL,
  "lng" REAL,
  "notes" TEXT,
  "source" TEXT,
  "tags" JSONB DEFAULT '[]' NOT NULL,
  "custom_fields" JSONB DEFAULT '{}' NOT NULL,
  "portal_enabled" BOOLEAN DEFAULT false NOT NULL,
  "portal_token" TEXT,
  "portal_token_exp" TIMESTAMP,
  "last_portal_visit" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "contact_company_id_idx" ON "contact" ("company_id");
CREATE INDEX IF NOT EXISTS "contact_type_idx" ON "contact" ("type");

-- Support knowledge base (help articles)
CREATE TABLE IF NOT EXISTS "support_knowledge_base" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT,
  "tags" JSONB DEFAULT '[]' NOT NULL,
  "is_faq" BOOLEAN DEFAULT false NOT NULL,
  "published" BOOLEAN DEFAULT true NOT NULL,
  "sort_order" INTEGER DEFAULT 0 NOT NULL,
  "view_count" INTEGER DEFAULT 0 NOT NULL,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "created_by_id" TEXT REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP DEFAULT NOW() NOT NULL,
  "updated_at" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS "support_kb_company_id_idx" ON "support_knowledge_base" ("company_id");
CREATE INDEX IF NOT EXISTS "support_kb_category_idx" ON "support_knowledge_base" ("category");
