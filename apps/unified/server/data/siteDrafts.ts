// Publishing a website draft (site/drafts.ts): the SQL that copies a record's `draft` over its live columns.
import { sql } from 'drizzle-orm'
import type { DraftFields } from '../site/drafts.ts'

/**
 * The SET for Publish: each live column takes the draft's value, in the one UPDATE that empties the draft — so a save
 * landing between reading the row and publishing it is published or kept, never lost. A row with no draft keeps its
 * columns; a NOT NULL column never takes a null. `json`: the columns that are json (read with ->, not ->>).
 */
export function publishSet(table: any, fields: DraftFields, json: Set<string>, notNull: Set<string>): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  for (const f of fields) {
    const col = table[f]
    // The keys are this app's own field names (drafts.ts), never input.
    const key = sql.raw(`'${f.replace(/'/g, "''")}'`)
    const value = json.has(f) ? sql`${table.draft}->${key}` : sql`${table.draft}->>${key}`
    set[f] = notNull.has(f)
      ? sql`CASE WHEN ${table.draft} IS NULL THEN ${col} ELSE COALESCE(${value}, ${col}) END`
      : sql`CASE WHEN ${table.draft} IS NULL OR (${table.draft}->${key}) IS NULL THEN ${col} ELSE ${value} END`
  }
  set.draft = null
  return set
}
