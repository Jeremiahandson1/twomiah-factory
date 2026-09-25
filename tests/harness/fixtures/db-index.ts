// TEST COPY ONLY — the tenant's real db/index.ts (node-postgres Pool) swapped for an in-process PGlite
// Postgres so the real routes + shared code run against a real SQL engine.
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './schema'

export const pglite = new PGlite()
export const db = drizzle(pglite, { schema })
export type DB = typeof db
export { schema }
