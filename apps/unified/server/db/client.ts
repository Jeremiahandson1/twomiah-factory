// The tenant's database: its own Postgres database, usually on a shared (pooled) instance (SPEC §0, decision 2).
// Pool settings from the CRM templates' db/index.ts: Render drops idle connections, and the node-postgres defaults
// hand out a dead client that hangs a query for ever, health checks included.
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.ts'

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const pool = new Pool({
    connectionString,
    // A pooled instance serves many tenants, so each tenant keeps its share of connections small.
    max: Number(process.env.DB_POOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    // Every session on UTC, so the database's own now() lands in a zone-less timestamp as UTC (RULEBOOK §2), whatever
    // the instance's default zone.
    options: '-c TimeZone=UTC',
  })
  // Without this an idle client's error crashes the process.
  pool.on('error', (err) => console.error('[db] idle pool client error:', err?.message || err))
  return { db: drizzle(pool, { schema }), pool }
}
