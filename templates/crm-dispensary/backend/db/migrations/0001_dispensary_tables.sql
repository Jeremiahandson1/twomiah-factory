-- Product categories
CREATE TABLE IF NOT EXISTS "product_categories" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "description" TEXT,
  "image_url" TEXT,
  "display_order" INTEGER DEFAULT 0,
  "visible" BOOLEAN DEFAULT true
);

-- Products
CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "category" TEXT NOT NULL,
  "subcategory" TEXT,
  "brand" TEXT,
  "strain_name" TEXT,
  "strain_type" TEXT,
  "thc_percent" TEXT,
  "cbd_percent" TEXT,
  "weight_grams" TEXT,
  "unit_type" TEXT,
  "price" TEXT NOT NULL,
  "compare_at_price" TEXT,
  "cost" TEXT,
  "sku" TEXT,
  "barcode" TEXT,
  "stock_quantity" INTEGER DEFAULT 0,
  "low_stock_threshold" INTEGER DEFAULT 5,
  "track_inventory" BOOLEAN DEFAULT true,
  "image_url" TEXT,
  "description" TEXT,
  "effects" JSONB DEFAULT '[]',
  "flavors" JSONB DEFAULT '[]',
  "is_merch" BOOLEAN DEFAULT false,
  "requires_age_verify" BOOLEAN DEFAULT true,
  "visible" BOOLEAN DEFAULT true,
  "featured" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "product_company_id_idx" ON "products" ("company_id");
CREATE INDEX IF NOT EXISTS "product_category_idx" ON "products" ("category");
CREATE INDEX IF NOT EXISTS "product_sku_idx" ON "products" ("sku");

-- Orders
CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "contact_id" TEXT REFERENCES "contact"("id") ON DELETE SET NULL,
  "order_number" INTEGER,
  "type" TEXT DEFAULT 'walk_in',
  "status" TEXT DEFAULT 'pending',
  "subtotal" TEXT DEFAULT '0',
  "tax_amount" TEXT DEFAULT '0',
  "discount_amount" TEXT DEFAULT '0',
  "loyalty_discount" TEXT DEFAULT '0',
  "total" TEXT DEFAULT '0',
  "total_cannabis_weight_oz" TEXT DEFAULT '0',
  "payment_method" TEXT,
  "payment_status" TEXT DEFAULT 'pending',
  "notes" TEXT,
  "pickup_time" TIMESTAMP,
  "delivery_address" TEXT,
  "delivery_notes" TEXT,
  "delivery_zone_id" TEXT,
  "budtender_id" TEXT REFERENCES "user"("id"),
  "driver_id" TEXT REFERENCES "user"("id"),
  "id_verified" BOOLEAN DEFAULT false,
  "id_verified_by" TEXT,
  "loyalty_points_earned" INTEGER DEFAULT 0,
  "loyalty_points_redeemed" INTEGER DEFAULT 0,
  "loyalty_reward_id" TEXT,
  "refund_reason" TEXT,
  "refunded_by" TEXT,
  "refunded_at" TIMESTAMP,
  "completed_at" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "order_company_id_idx" ON "orders" ("company_id");
CREATE INDEX IF NOT EXISTS "order_contact_id_idx" ON "orders" ("contact_id");
CREATE INDEX IF NOT EXISTS "order_status_idx" ON "orders" ("status");
CREATE INDEX IF NOT EXISTS "order_created_at_idx" ON "orders" ("created_at");

-- Order items
CREATE TABLE IF NOT EXISTS "order_items" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "product_id" TEXT REFERENCES "products"("id") ON DELETE SET NULL,
  "product_name" TEXT,
  "product_category" TEXT,
  "quantity" INTEGER DEFAULT 1,
  "unit_price" TEXT,
  "total_price" TEXT,
  "weight_grams" TEXT,
  "notes" TEXT
);

-- Loyalty members
CREATE TABLE IF NOT EXISTS "loyalty_members" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "contact_id" TEXT NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
  "points_balance" INTEGER DEFAULT 0,
  "lifetime_points" INTEGER DEFAULT 0,
  "tier" TEXT DEFAULT 'bronze',
  "referral_code" TEXT,
  "referred_by" TEXT,
  "opted_in_sms" BOOLEAN DEFAULT false,
  "opted_in_email" BOOLEAN DEFAULT false,
  "joined_at" TIMESTAMP DEFAULT NOW(),
  "last_activity_at" TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "loyalty_member_company_id_idx" ON "loyalty_members" ("company_id");
CREATE INDEX IF NOT EXISTS "loyalty_member_contact_id_idx" ON "loyalty_members" ("contact_id");

-- Loyalty transactions
CREATE TABLE IF NOT EXISTS "loyalty_transactions" (
  "id" TEXT PRIMARY KEY,
  "member_id" TEXT NOT NULL REFERENCES "loyalty_members"("id") ON DELETE CASCADE,
  "order_id" TEXT,
  "type" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "balance_after" INTEGER,
  "description" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "loyalty_tx_member_id_idx" ON "loyalty_transactions" ("member_id");

-- Loyalty rewards
CREATE TABLE IF NOT EXISTS "loyalty_rewards" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "points_cost" INTEGER NOT NULL,
  "discount_type" TEXT,
  "discount_value" TEXT,
  "applicable_categories" JSONB DEFAULT '[]',
  "product_id" TEXT,
  "min_tier" TEXT,
  "max_redemptions_per_day" INTEGER,
  "usage_count" INTEGER DEFAULT 0,
  "active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Delivery zones
CREATE TABLE IF NOT EXISTS "delivery_zones" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "zip_codes" JSONB DEFAULT '[]',
  "delivery_fee" TEXT DEFAULT '0',
  "min_order" TEXT DEFAULT '0',
  "max_order" TEXT,
  "estimated_minutes" INTEGER,
  "active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP DEFAULT NOW()
);

-- Inventory adjustments
CREATE TABLE IF NOT EXISTS "inventory_adjustments" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "product_id" TEXT NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "user_id" TEXT REFERENCES "user"("id"),
  "adjustment_type" TEXT NOT NULL,
  "quantity_change" INTEGER NOT NULL,
  "quantity_before" INTEGER,
  "quantity_after" INTEGER,
  "reason" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "inv_adj_company_id_idx" ON "inventory_adjustments" ("company_id");
CREATE INDEX IF NOT EXISTS "inv_adj_product_id_idx" ON "inventory_adjustments" ("product_id");

-- Cash sessions
CREATE TABLE IF NOT EXISTS "cash_sessions" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "user"("id"),
  "opened_at" TIMESTAMP DEFAULT NOW(),
  "closed_at" TIMESTAMP,
  "opening_balance" TEXT DEFAULT '0',
  "expected_balance" TEXT DEFAULT '0',
  "actual_count" TEXT,
  "variance" TEXT,
  "notes" TEXT,
  "status" TEXT DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS "cash_session_company_id_idx" ON "cash_sessions" ("company_id");
CREATE INDEX IF NOT EXISTS "cash_session_user_id_idx" ON "cash_sessions" ("user_id");

-- Audit log
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "details" JSONB,
  "ip_address" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "audit_log_company_id_idx" ON "audit_log" ("company_id");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" ("action");
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" ("created_at");

-- Daily sales summary
CREATE TABLE IF NOT EXISTS "daily_sales_summary" (
  "id" TEXT PRIMARY KEY,
  "company_id" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "date" TEXT NOT NULL,
  "total_orders" INTEGER DEFAULT 0,
  "total_revenue" TEXT DEFAULT '0',
  "cash_total" TEXT DEFAULT '0',
  "debit_total" TEXT DEFAULT '0',
  "cannabis_revenue" TEXT DEFAULT '0',
  "merch_revenue" TEXT DEFAULT '0',
  "tax_collected" TEXT DEFAULT '0',
  "total_cannabis_weight_oz" TEXT DEFAULT '0',
  "unique_customers" INTEGER DEFAULT 0,
  "top_product_id" TEXT,
  "avg_order_value" TEXT DEFAULT '0',
  "loyalty_points_issued" INTEGER DEFAULT 0,
  "loyalty_points_redeemed" INTEGER DEFAULT 0,
  "delivery_orders" INTEGER DEFAULT 0,
  "pickup_orders" INTEGER DEFAULT 0,
  "walk_in_orders" INTEGER DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "daily_sales_company_id_idx" ON "daily_sales_summary" ("company_id");
CREATE INDEX IF NOT EXISTS "daily_sales_date_idx" ON "daily_sales_summary" ("date");
