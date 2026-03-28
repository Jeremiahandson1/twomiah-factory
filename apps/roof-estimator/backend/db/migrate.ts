import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

async function runMigrations() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool)
  console.log('[migrate] Running migrations...')
  await migrate(db, { migrationsFolder: './db/migrations' })
  console.log('[migrate] Migrations complete')
  await pool.end()
}

runMigrations().catch((err) => {
  console.error('[migrate] Migration failed:', err)
  process.exit(1)
})
