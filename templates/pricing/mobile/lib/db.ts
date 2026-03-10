import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('twomiah-price.db');

export function initDatabase(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      store_name TEXT PRIMARY KEY,
      last_synced_at TEXT,
      version TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT,
      sort_order INTEGER,
      mode TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      mode TEXT NOT NULL,
      measurement_type TEXT,
      measurement_unit TEXT,
      default_waste_factor REAL,
      labor_rate REAL,
      labor_unit TEXT,
      setup_fee REAL,
      minimum_charge REAL,
      pitch_adjustable INTEGER DEFAULT 0,
      image_url TEXT,
      sort_order INTEGER,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tiers (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      base_price REAL,
      material_name TEXT,
      material_cost_per_unit REAL,
      warranty_years INTEGER,
      features TEXT
    );

    CREATE TABLE IF NOT EXISTS price_ranges (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      min_value REAL,
      max_value REAL,
      par_price REAL,
      retail_price REAL,
      yr1_markup_pct REAL,
      day30_markup_pct REAL,
      today_discount_pct REAL
    );

    CREATE TABLE IF NOT EXISTS addons (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      group_name TEXT,
      name TEXT NOT NULL,
      description TEXT,
      pricing_type TEXT NOT NULL,
      price REAL NOT NULL,
      unit TEXT,
      required INTEGER DEFAULT 0,
      default_selected INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      image_url TEXT,
      depends_on_addon_id TEXT
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      local_id TEXT UNIQUE,
      server_synced INTEGER DEFAULT 0,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      address TEXT,
      customer_state TEXT,
      referral_source TEXT,
      referral_name TEXT,
      status TEXT DEFAULT 'draft',
      mode TEXT NOT NULL,
      line_items TEXT,
      selected_tier TEXT,
      subtotal REAL,
      discount_amount REAL DEFAULT 0,
      total_price REAL,
      signature_data TEXT,
      rep_signature_data TEXT,
      contract_hash TEXT,
      notes TEXT,
      created_at TEXT,
      updated_at TEXT,
      synced_at TEXT,
      presented_at TEXT,
      signed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      body TEXT,
      created_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS pitch_multipliers (
      id TEXT PRIMARY KEY,
      pitch TEXT NOT NULL,
      multiplier REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

export function getAll(table: string): any[] {
  return db.getAllSync(`SELECT * FROM ${table}`);
}

export function getById(table: string, id: string): any | null {
  const results = db.getAllSync(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return results.length > 0 ? results[0] : null;
}

export function insert(table: string, data: Record<string, any>): void {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  db.runSync(sql, values);
}

export function update(table: string, id: string, data: Record<string, any>): void {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const setClause = keys.map((key) => `${key} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
  db.runSync(sql, [...values, id]);
}

export function remove(table: string, id: string): void {
  db.runSync(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

export function query(sql: string, params?: any[]): any[] {
  return db.getAllSync(sql, params || []);
}

export function runSql(sql: string, params?: any[]): void {
  db.runSync(sql, params || []);
}

export { db };
