// A stored name matched the way a person reads it (RULEBOOK §2: raw SQL lives in server/data/). Used by the CSV
// import's duplicate check (crm/office/importService.ts), where ilike would treat a % or _ in a name as a wildcard.
import { sql } from 'drizzle-orm'

/** The same text, ignoring case and outside spaces. */
export const sameText = (column: any, value: string) => sql`lower(trim(${column})) = lower(trim(${value}))`
