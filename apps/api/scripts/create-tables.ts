// Creates platform tables via direct pg connection
// Usage: DATABASE_URL=... bun scripts/create-tables.ts

import pg from 'pg'

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('DATABASE_URL is required'); process.exit(1) }

console.log('Connecting to database...')

const url = new URL(DB_URL)
const client = new pg.Client({
  host: url.hostname,
  port: parseInt(url.port) || 5432,
  database: url.pathname.slice(1),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false }
})

const queries: [string, string][] = [
  ['factory_users table', `CREATE TABLE IF NOT EXISTS factory_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id uuid UNIQUE,
    email text NOT NULL,
    name text,
    role text NOT NULL DEFAULT 'viewer',
    created_at timestamptz NOT NULL DEFAULT now()
  )`],
  ['factory_users indexes', `CREATE INDEX IF NOT EXISTS idx_factory_users_auth_id ON factory_users(auth_id);
   CREATE INDEX IF NOT EXISTS idx_factory_users_email ON factory_users(email)`],
  ['factory_users RLS', `ALTER TABLE factory_users ENABLE ROW LEVEL SECURITY`],
  ['factory_users policy', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='factory_users' AND policyname='factory_users_all') THEN
      CREATE POLICY "factory_users_all" ON factory_users FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`],

  ['support_tickets table', `CREATE TABLE IF NOT EXISTS support_tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number text UNIQUE NOT NULL,
    subject text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'open',
    priority text NOT NULL DEFAULT 'normal',
    category text,
    source text DEFAULT 'portal',
    tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
    submitter_email text,
    submitter_name text,
    assigned_to text,
    ai_category text,
    ai_priority_score integer DEFAULT 0,
    sla_response_due timestamptz,
    sla_resolve_due timestamptz,
    first_response_at timestamptz,
    resolved_at timestamptz,
    rating integer,
    rating_comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`],
  ['support_tickets indexes', `CREATE INDEX IF NOT EXISTS idx_st_tenant ON support_tickets(tenant_id);
   CREATE INDEX IF NOT EXISTS idx_st_status ON support_tickets(status);
   CREATE INDEX IF NOT EXISTS idx_st_created ON support_tickets(created_at DESC)`],
  ['support_tickets RLS', `ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY`],
  ['support_tickets policy', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_tickets' AND policyname='st_all') THEN
      CREATE POLICY "st_all" ON support_tickets FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`],

  ['support_ticket_messages table', `CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    body text NOT NULL,
    is_internal boolean NOT NULL DEFAULT false,
    sender_type text NOT NULL DEFAULT 'agent',
    sender_email text,
    sender_name text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`],
  ['support_ticket_messages index', `CREATE INDEX IF NOT EXISTS idx_stm_ticket ON support_ticket_messages(ticket_id)`],
  ['support_ticket_messages RLS', `ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY`],
  ['support_ticket_messages policy', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_ticket_messages' AND policyname='stm_all') THEN
      CREATE POLICY "stm_all" ON support_ticket_messages FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`],

  ['support_knowledge_base table', `CREATE TABLE IF NOT EXISTS support_knowledge_base (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    content text NOT NULL,
    category text,
    tags text[] DEFAULT '{}',
    published boolean NOT NULL DEFAULT true,
    view_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`],
  ['support_knowledge_base RLS', `ALTER TABLE support_knowledge_base ENABLE ROW LEVEL SECURITY`],
  ['support_knowledge_base policy', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_knowledge_base' AND policyname='skb_all') THEN
      CREATE POLICY "skb_all" ON support_knowledge_base FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`],

  ['product_feedback table', `CREATE TABLE IF NOT EXISTS product_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    category text,
    status text NOT NULL DEFAULT 'new',
    votes integer NOT NULL DEFAULT 0,
    source_ticket_id uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
    tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`],
  ['product_feedback RLS', `ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY`],
  ['product_feedback policy', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_feedback' AND policyname='pf_all') THEN
      CREATE POLICY "pf_all" ON product_feedback FOR ALL USING (true) WITH CHECK (true);
    END IF;
  END $$`],
]

async function run() {
  await client.connect()
  console.log('Connected!\n')

  let ok = 0, fail = 0
  for (const [label, sql] of queries) {
    process.stdout.write(`  ${label}...`)
    try {
      await client.query(sql)
      console.log(' ✓')
      ok++
    } catch (e: any) {
      console.log(` ✗ ${e.message}`)
      fail++
    }
  }

  console.log(`\nDone: ${ok} succeeded, ${fail} failed`)
  await client.end()
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
