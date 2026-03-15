-- New tables: team_members, documents, leads, lead_sources, support_tickets, support_ticket_messages, support_sla_policies
-- New columns on existing tables: products, orders, order_items, loyalty_members, loyalty_transactions, loyalty_rewards, delivery_zones, cash_sessions

-- ==================== NEW TABLES ====================

CREATE TABLE IF NOT EXISTS "team_members" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT REFERENCES "company"("id"),
  "user_id" TEXT REFERENCES "user"("id"),
  "role" TEXT DEFAULT 'budtender',
  "status" TEXT DEFAULT 'active',
  "permissions" JSONB DEFAULT '[]',
  "invited_at" TIMESTAMP,
  "joined_at" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "documents" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT REFERENCES "company"("id"),
  "name" TEXT NOT NULL,
  "type" TEXT,
  "url" TEXT,
  "size" INTEGER,
  "uploaded_by" TEXT REFERENCES "user"("id"),
  "contact_id" TEXT,
  "order_id" TEXT,
  "tags" JSONB DEFAULT '[]',
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "leads" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT REFERENCES "company"("id"),
  "name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "source" TEXT,
  "status" TEXT DEFAULT 'new',
  "message" TEXT,
  "service" TEXT,
  "address" TEXT,
  "assigned_to" TEXT,
  "notes" TEXT,
  "converted_contact_id" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "lead_sources" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT REFERENCES "company"("id"),
  "name" TEXT NOT NULL,
  "type" TEXT,
  "active" BOOLEAN DEFAULT true,
  "lead_count" INTEGER DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT REFERENCES "company"("id"),
  "contact_id" TEXT,
  "subject" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT DEFAULT 'open',
  "priority" TEXT DEFAULT 'medium',
  "assigned_to" TEXT,
  "category" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW(),
  "closed_at" TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
  "id" TEXT PRIMARY KEY,
  "ticket_id" TEXT REFERENCES "support_tickets"("id"),
  "user_id" TEXT,
  "contact_id" TEXT,
  "message" TEXT NOT NULL,
  "is_internal" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "support_sla_policies" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT REFERENCES "company"("id"),
  "name" TEXT NOT NULL,
  "response_time_minutes" INTEGER,
  "resolution_time_minutes" INTEGER,
  "priority" TEXT,
  "active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP DEFAULT NOW()
);

-- ==================== NEW COLUMNS ON EXISTING TABLES ====================

-- Products: new columns
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "active" BOOLEAN DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "menu_order" INTEGER DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "images" JSONB DEFAULT '[]';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tags" JSONB DEFAULT '[]';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lab_results" JSONB;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "metrc_tag" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_category" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "requires_id_check" BOOLEAN DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "requires_weighing" BOOLEAN DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cost_price" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "weight_unit" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "strain" TEXT;

-- Orders: new columns
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "number" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_name" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_id" TEXT REFERENCES "contact"("id");
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_dob" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "is_medical" BOOLEAN DEFAULT false;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "medical_card_number" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "excise_tax" TEXT DEFAULT '0';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sales_tax" TEXT DEFAULT '0';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "total_tax" TEXT DEFAULT '0';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "discount_reason" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "total_weight_grams" TEXT DEFAULT '0';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cash_tendered" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "change_due" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_status" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_lat" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivery_lng" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP;

-- Order items: new columns
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "line_total" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "weight" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "weight_unit" TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tax_category" TEXT;

-- Loyalty members: new columns
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "total_points_earned" INTEGER DEFAULT 0;
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "total_visits" INTEGER DEFAULT 0;
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "total_spent" TEXT DEFAULT '0';
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "loyalty_members" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();

-- Loyalty transactions: new column
ALTER TABLE "loyalty_transactions" ADD COLUMN IF NOT EXISTS "company_id" TEXT;

-- Loyalty rewards: new column
ALTER TABLE "loyalty_rewards" ADD COLUMN IF NOT EXISTS "points_required" INTEGER;

-- Delivery zones: new columns
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "radius_miles" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "center_lat" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "center_lng" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "minimum_order" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "hours_start" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "hours_end" TEXT;
ALTER TABLE "delivery_zones" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP DEFAULT NOW();

-- Cash sessions: new columns
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "opened_by_id" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "closed_by_id" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "register" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "opening_amount" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "closing_amount" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "expected_amount" TEXT;
ALTER TABLE "cash_sessions" ADD COLUMN IF NOT EXISTS "denominations" JSONB;
