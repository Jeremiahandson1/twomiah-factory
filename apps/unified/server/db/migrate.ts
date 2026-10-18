// Brings the database up to the schema: applies db/migrations in order, each once (RULEBOOK §7). Run at boot,
// before the server starts; a failed migration stops the boot.
//
// Only an unreachable database is retried (Render can start the service before Postgres accepts connections). A
// broken migration fails the same way every time, so it stops at once and says so, rather than being retried and
// reported as a connection problem (the CRM templates' T58d lesson).
import path from 'node:path'
import { migrate as pgMigrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb } from './client.ts'

export const MIGRATIONS = path.join(import.meta.dir, 'migrations')

const CONNECTION = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|starting up|not yet accepting|terminating connection|Connection terminated|socket hang up/i

export async function runMigrations(opts: { retries?: number; delayMs?: number } = {}) {
  const retries = opts.retries ?? 20
  const delayMs = opts.delayMs ?? 10_000
  for (let attempt = 1; ; attempt++) {
    const { db, pool } = createDb()
    try {
      await pgMigrate(db, { migrationsFolder: MIGRATIONS })
      console.log('[migrate] database is up to date')
      return
    } catch (err: any) {
      const text = [err?.message, err?.cause?.message, String(err)].filter(Boolean).join(' | ')
      if (!CONNECTION.test(text)) {
        console.error('[migrate] A MIGRATION FAILED. This is not a connection problem and retrying will not fix it.')
        console.error('[migrate] ' + text.split('\n')[0])
        throw err
      }
      if (attempt >= retries) throw new Error(`Could not reach the database after ${retries} attempts: ${text.split('\n')[0]}`)
      console.log(`[migrate] Database not reachable yet (attempt ${attempt}/${retries}), retrying in ${delayMs / 1000}s`)
      await new Promise((r) => setTimeout(r, delayMs))
    } finally {
      await pool.end().catch(() => {})
    }
  }
}

if (import.meta.main) {
  runMigrations().then(() => process.exit(0), () => process.exit(1))
}
