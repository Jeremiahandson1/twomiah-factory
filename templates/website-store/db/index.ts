import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.ts'

// Render's free Postgres drops idle TCP connections after a while. With the
// node-postgres defaults (no keepAlive, connectionTimeoutMillis: 0, no
// statement_timeout) the pool hands out a dead client and the query hangs
// FOREVER — this is what made storefront checkout (POST /api/checkout) hang.
// A configured pool fails a stuck request fast and self-heals instead.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
  statement_timeout: 30_000,
  query_timeout: 30_000,
})

pool.on('error', (err) => {
  console.error('[db] idle pool client error:', err?.message || err)
})

export const db = drizzle(pool, { schema })
export type DB = typeof db
export { schema }
