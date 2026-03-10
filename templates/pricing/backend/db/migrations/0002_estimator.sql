-- Estimator Mode tables for Twomiah Price Phase 2

-- ─── Estimator Product ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimator_product (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES product_category(id),
  name TEXT NOT NULL,
  description TEXT,
  measurement_unit TEXT NOT NULL,
  pitch_adjustable BOOLEAN DEFAULT FALSE,
  default_waste_factor DECIMAL(5,2) DEFAULT 1.10,
  labor_rate DECIMAL(10,2) NOT NULL,
  labor_unit TEXT NOT NULL,
  setup_fee DECIMAL(10,2) DEFAULT 0,
  minimum_charge DECIMAL(10,2) DEFAULT 0,
  retail_markup_pct DECIMAL(5,2) DEFAULT 100,
  yr1_markup_pct DECIMAL(5,2) DEFAULT 20,
  day30_markup_pct DECIMAL(5,2) DEFAULT 10,
  today_discount_pct DECIMAL(5,2) DEFAULT 10,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimator_product_tenant_idx ON estimator_product(tenant_id);

-- ─── Estimator Material Tier ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimator_material_tier (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES estimator_product(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  material_name TEXT NOT NULL,
  material_cost_per_unit DECIMAL(10,2) NOT NULL,
  manufacturer TEXT,
  product_line TEXT,
  warranty_years INTEGER,
  features JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimator_material_tier_product_idx ON estimator_material_tier(product_id);

-- ─── Pitch Multiplier ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pitch_multiplier (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  pitch TEXT NOT NULL,
  multiplier DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pitch_multiplier_tenant_idx ON pitch_multiplier(tenant_id);

-- ─── Estimator Addon ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimator_addon (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES estimator_product(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  pricing_type TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  unit TEXT,
  default_selected BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS estimator_addon_product_idx ON estimator_addon(product_id);

-- ─── Estimate ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimate (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  rep_id TEXT REFERENCES rep_profile(id),
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  customer_state TEXT,
  referral_source TEXT,
  referral_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  line_items JSONB DEFAULT '[]',
  subtotal DECIMAL(10,2),
  total_materials DECIMAL(10,2),
  total_labor DECIMAL(10,2),
  total_addons DECIMAL(10,2),
  selected_tier TEXT,
  notes TEXT,
  customer_token TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  presented_at TIMESTAMP,
  signed_at TIMESTAMP,
  completed_at TIMESTAMP,
  offline_created BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS estimate_tenant_idx ON estimate(tenant_id);
CREATE INDEX IF NOT EXISTS estimate_rep_idx ON estimate(rep_id);
CREATE INDEX IF NOT EXISTS estimate_status_idx ON estimate(status);

-- ─── Estimate Contract ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimate_contract (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimate(id) ON DELETE CASCADE,
  contract_template_id TEXT REFERENCES contract_template(id),
  populated_html TEXT NOT NULL,
  document_hash TEXT,
  customer_signature_svg TEXT,
  customer_signed_at TIMESTAMP,
  customer_ip TEXT,
  customer_device_fingerprint TEXT,
  rep_signature_svg TEXT,
  rep_signed_at TIMESTAMP,
  rep_ip TEXT,
  rescission_expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS estimate_contract_estimate_idx ON estimate_contract(estimate_id);
