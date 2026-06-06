import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is not set — cannot connect to Postgres')
}

const pool = new pg.Pool({ connectionString: url, max: 5 })

export const db = drizzle(pool)
export { pool }
