// The database the bar's services are made with, typed by the app's schema, so every select reads back its columns'
// own types (the template's services were checked against its typed db the same way). CrmDeps carries it untyped.
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from '../../db/schema/index.ts'

export type BarDb = PgDatabase<PgQueryResultHKT, typeof schema>
