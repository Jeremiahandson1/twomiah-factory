// Reading raw-SQL rows, in one place.
//
// Postgres answers in snake_case. Every other endpoint in these products answers in camelCase,
// because that is what the screens read. So a module that reaches for `db.execute(sql\`…\`)` instead
// of Drizzle's query builder quietly changes the shape of its own API, and the screen shows blanks
// over arithmetic that is perfectly correct underneath: `due_date` arrives, `dueDate` is read,
// nothing renders, and the module looks broken.
//
// That has now been found three times — tasks (a blank due date), takeoffs (T32 B5: a blank material
// name, NaN quantities, $NaN costs) and selections (T32 L7: no due date, no chosen option, no price
// difference) — and been fixed three times with three separate copies of the same four lines. This
// file is the fourth and last copy.
//
// WHY NESTING IS OPT-IN, which is the only subtle thing here:
//
//   SELECT ps.*, row_to_json(so.*) AS selected_option FROM project_selection ps …
//
// `selected_option` is a TABLE ROW, so its keys are column names and camelising them is right.
// But `available_options` on the same row is a `json` COLUMN holding whatever the user put there,
// and a blanket recursion would rename the keys of their data. There is no way to tell those two
// apart by looking at the value, so the caller — which wrote the row_to_json and knows — names the
// keys that are rows. Anything not named is passed through untouched.

/** node-postgres hands back `{ rows }`; the PGlite driver hands back the array. Both, then. */
export const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : (result?.rows || []))

const toCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase())

/**
 * A `timestamp` column as the driver hands it over: "2026-10-15 00:00:00", with no zone. (T32 L7)
 *
 * The other half of the same report. Drizzle's query builder parses these columns into a JS Date,
 * which `JSON.stringify` renders as "2026-10-15T00:00:00.000Z" — an unambiguous instant. A raw
 * `db.execute` returns the driver's string instead, so the SAME column answered two different ways
 * depending on which API read it, and a browser parsing the naive form reads it in the VIEWER's
 * zone: a selection due on the 15th shows as the 14th for everyone west of the server.
 *
 * These columns hold UTC throughout this product, so the instant is recoverable — appending `Z` is
 * the whole conversion. Matched on the value's shape rather than the column's name, because a
 * generic reader cannot know the naming convention of every table, and the names are not consistent
 * anyway (`expected_delivery` is a timestamp; `bill_date` is too).
 *
 * Requires a TIME part, deliberately: a `date` column ("2026-10-15") names a calendar day and has
 * no instant, so turning it into one would move it across the date line for half the world — the
 * exact bug this is fixing, in reverse.
 */
const PG_TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)$/
const asInstant = (v: string) => {
  const m = PG_TIMESTAMP.exec(v)
  if (!m) return v
  const d = new Date(`${m[1]}T${m[2]}Z`)
  return Number.isNaN(d.getTime()) ? v : d
}

/** Camelise one row's own keys. Values are untouched unless `nested` names them. */
export function camelRow(row: any, nested: readonly string[] = []): any {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const deep = new Set(nested.flatMap((k) => [k, toCamel(k)]))
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(row)) {
    out[toCamel(k)] = deep.has(k)
      ? (Array.isArray(v) ? v.map((x) => camelRow(x, nested)) : camelRow(v, nested))
      : typeof v === 'string' ? asInstant(v) : v
  }
  return out
}

/**
 * Every row of a raw-SQL result, camelised.
 *
 *   camelRows(await db.execute(sql`SELECT ps.*, row_to_json(so.*) AS selected_option …`),
 *             ['category', 'selected_option'])
 */
export const camelRows = (result: any, nested: readonly string[] = []): any[] =>
  rowsOf(result).map((r) => camelRow(r, nested))

/** The first row, camelised — for the `RETURNING *` and `WHERE id = …` reads. */
export const camelFirst = (result: any, nested: readonly string[] = []): any =>
  camelRow(rowsOf(result)[0], nested)
