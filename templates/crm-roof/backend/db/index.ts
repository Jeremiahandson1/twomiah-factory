import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Render's free Postgres drops idle TCP connections after a while. With the
// node-postgres defaults (no keepAlive, connectionTimeoutMillis: 0, no
// statement_timeout) the pool hands out a dead client and the query hangs
// FOREVER — health checks included — until the whole service is wedged. These
// settings make a stuck request fail fast and let the pool self-heal instead.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 10,
  idleTimeoutMillis: 30_000, // close idle clients before the network kills them
  connectionTimeoutMillis: 15_000, // fail acquisition instead of queueing forever
  keepAlive: true, // detect dead sockets so stale clients get discarded
  statement_timeout: 30_000, // abort a runaway query server-side (releases the client)
  query_timeout: 30_000, // abort a hung query client-side
})

// Without this handler an idle-client error crashes the whole process.
pool.on('error', (err) => {
  console.error('[db] idle pool client error:', err?.message || err)
})

export const db = drizzle(pool, { schema })
export type DB = typeof db
export { schema }
