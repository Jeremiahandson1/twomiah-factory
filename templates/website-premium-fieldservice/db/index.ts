// The site's data: one SQLite file on the service's persistent disk. Deploy mounts the same 1 GB
// disk standard sites keep their files on (website/persistent), so a premium site needs no database
// server of its own — it was a separate Render Postgres (~$7/mo) per site.
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import fs from 'node:fs'
import path from 'node:path'

export const dbFile = process.env.SITE_DB_PATH || path.join(import.meta.dir, '..', 'persistent', 'site.db')
fs.mkdirSync(path.dirname(dbFile), { recursive: true })

const sqlite = new Database(dbFile, { create: true })
// WAL: readers don't wait on the writer. busy_timeout: a write that meets another waits instead of
// failing. foreign_keys: SQLite leaves them off unless asked.
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;')

export const db = drizzle(sqlite)
export { sqlite }
