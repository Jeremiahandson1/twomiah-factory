// Brings the site's database up to the schema: applies db/migrations (generated from db/schema.ts with
// `bunx drizzle-kit generate` — commit the new migration with every schema change). Safe to run on
// every boot; each migration is applied once.
import path from 'node:path'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from './index'

export function migrateDb(): void {
  migrate(db, { migrationsFolder: path.join(import.meta.dir, 'migrations') })
}

if (import.meta.main) {
  migrateDb()
  console.log('[migrate] database is up to date')
}
