CREATE TABLE IF NOT EXISTS pricebook_category (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  company_id text NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  parent_id text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS pricebook_category_company_id_idx ON pricebook_category(company_id);

CREATE TABLE IF NOT EXISTS pricebook_item (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'service',
  code text,
  price decimal(12, 2) NOT NULL,
  cost decimal(12, 2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'each',
  taxable boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  company_id text NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  category_id text REFERENCES pricebook_category(id),
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS pricebook_item_company_id_idx ON pricebook_item(company_id);
CREATE INDEX IF NOT EXISTS pricebook_item_category_id_idx ON pricebook_item(category_id);

CREATE TABLE IF NOT EXISTS pricebook_good_better_best (
  id text PRIMARY KEY,
  pricebook_item_id text NOT NULL REFERENCES pricebook_item(id) ON DELETE CASCADE,
  tier text NOT NULL,
  name text,
  description text,
  price decimal(12, 2) NOT NULL,
  features json
);
CREATE INDEX IF NOT EXISTS pricebook_good_better_best_pricebook_item_id_idx ON pricebook_good_better_best(pricebook_item_id);

CREATE TABLE IF NOT EXISTS pricebook_material (
  id text PRIMARY KEY,
  pricebook_item_id text NOT NULL REFERENCES pricebook_item(id) ON DELETE CASCADE,
  quantity decimal(10, 4) NOT NULL DEFAULT 1,
  price_override decimal(12, 2)
);
CREATE INDEX IF NOT EXISTS pricebook_material_pricebook_item_id_idx ON pricebook_material(pricebook_item_id);
