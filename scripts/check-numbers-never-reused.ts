/**
 * CI guard: a document number is never handed out twice, even after the row holding it is deleted.
 *
 *   owner: "field-service deleted invoice numbers are reused."
 *
 * `nextNumber` issued "highest existing + 1", which is a function of the rows that still EXIST —
 * so deleting the newest invoice handed its number to the next one. INV-00042 may already be in a
 * customer's inbox and in their accounts; a second, different INV-00042 makes the two impossible to
 * tell apart. The same helper numbers quotes, jobs, agreements and repair orders.
 *
 * This runs the REAL statement against a real Postgres (PGlite), because the fix is a single
 * `jsonb_set` + `GREATEST` over `company.settings.docSeq` and the only honest way to know that
 * statement is right is to execute it. The `settings` column is `json`, not `jsonb`, in every CRM
 * template — the casts here are the ones the helper actually uses.
 *
 * THE PROPERTY THAT MAKES THE FIX SAFE and is asserted below: where nothing has been deleted, the
 * mark equals the max, so the number issued is identical to the one the old code issued. Behaviour
 * changes only after a delete.
 *
 *   bun scripts/check-numbers-never-reused.ts
 */
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const pg = new PGlite()
await pg.exec(`
  CREATE TABLE company (id text PRIMARY KEY, settings json DEFAULT '{}' NOT NULL);
  CREATE TABLE invoice (id text PRIMARY KEY, company_id text, number text);
  INSERT INTO company (id) VALUES ('c1');
`)

/** The helper's own statement, with the same casts and the same GREATEST. */
const advance = async (companyId: string, prefix: string, maxPlusOne: number): Promise<number> => {
  const res = await pg.query<{ seq: string }>(
    `UPDATE company SET settings = (
       COALESCE(settings::jsonb, '{}'::jsonb) || jsonb_build_object('docSeq',
         COALESCE(settings::jsonb -> 'docSeq', '{}'::jsonb) || jsonb_build_object($2, GREATEST(
           CASE WHEN (settings::jsonb -> 'docSeq' ->> $2) ~ '^[0-9]+$'
                THEN ((settings::jsonb -> 'docSeq' ->> $2)::bigint + 1)
                ELSE 0 END,
           $3::bigint
         ))
       )
     )::json
     WHERE id = $1::text
     RETURNING (settings::jsonb -> 'docSeq' ->> $2::text) AS seq`,
    [companyId, prefix, maxPlusOne],
  )
  return Number(res.rows[0]?.seq)
}

/**
 * What the whole helper does: look at the rows, then advance the mark.
 *
 * The row id comes from a counter, NOT from the number — an id derived from the number would make a
 * reused number a duplicate-key CRASH instead of a readable assertion, which is how this guard
 * reported its first real finding (jsonb_set never created the missing `docSeq` parent, so every
 * number came back 0 and the second insert collided on id 'i0').
 */
let rowSeq = 0
const issue = async (prefix: string, pad = 5): Promise<string> => {
  const rows = await pg.query<{ number: string }>(`SELECT number FROM invoice WHERE company_id = 'c1'`)
  const re = new RegExp(`^${prefix}-(\\d+)$`)
  let max = 0
  for (const r of rows.rows) { const m = String(r.number || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) }
  const n = await advance('c1', prefix, max + 1)
  const number = `${prefix}-${pad > 0 ? String(n).padStart(pad, '0') : n}`
  await pg.query(`INSERT INTO invoice (id, company_id, number) VALUES ($1, 'c1', $2)`, [`row${++rowSeq}`, number])
  return number
}

// ── it numbers from one, exactly as before ────────────────────────────────────────────────────────
const first = [await issue('INV'), await issue('INV'), await issue('INV')]
if (first.join(' ') !== 'INV-00001 INV-00002 INV-00003') {
  fail(`a fresh company must number from one: got ${first.join(' ')}`)
}

// ── THE BUG: delete the newest and the next number must NOT be reused ────────────────────────────
await pg.query(`DELETE FROM invoice WHERE number = 'INV-00003'`)
const afterDelete = await issue('INV')
if (afterDelete === 'INV-00003') fail('a deleted invoice number was REUSED — this is the reported bug')
if (afterDelete !== 'INV-00004') fail(`after deleting INV-00003 the next number must be INV-00004, got ${afterDelete}`)

// ── delete several, including the top, and it still only goes forwards ───────────────────────────
await pg.query(`DELETE FROM invoice WHERE number IN ('INV-00004', 'INV-00002')`)
const next = await issue('INV')
if (next !== 'INV-00005') fail(`numbering must only go forwards: expected INV-00005, got ${next}`)

// ── delete EVERY row: an empty table must not restart at one ─────────────────────────────────────
await pg.query(`DELETE FROM invoice`)
const afterPurge = await issue('INV')
if (afterPurge === 'INV-00001') fail('emptying the table restarted numbering at INV-00001 — every number would be reissued')
if (afterPurge !== 'INV-00006') fail(`expected INV-00006 after a purge, got ${afterPurge}`)

// ── each prefix keeps its own mark ───────────────────────────────────────────────────────────────
const q1 = await issue('QTE')
if (q1 !== 'QTE-00001') fail(`QTE must have its own sequence, got ${q1}`)
const i7 = await issue('INV')
if (i7 !== 'INV-00007') fail(`the INV mark must be untouched by QTE, got ${i7}`)

// ── a corrupt mark is read as 0, not cast — it must not throw, and must not go backwards ─────────
await pg.query(`UPDATE company SET settings = jsonb_set(settings::jsonb, ARRAY['docSeq','INV'], '"banana"'::jsonb)::json WHERE id = 'c1'`)
try {
  const healed = await issue('INV')
  // The rows still hold INV-00007, so max+1 = 8 wins over the unreadable mark.
  if (healed !== 'INV-00008') fail(`a non-numeric mark must fall back to the rows: expected INV-00008, got ${healed}`)
} catch (e: any) {
  fail(`a non-numeric mark THREW, which would poison the transaction and fail the create: ${e?.message}`)
}

// ── RV's unpadded, seeded shape still works ──────────────────────────────────────────────────────
await pg.query(`INSERT INTO company (id) VALUES ('c2')`)
const ro = await (async () => {
  const n = await advance('c2', 'RO', 1001)
  return `RO-${n}`
})()
if (ro !== 'RO-1001') fail(`an unpadded seeded sequence must start at its seed, got ${ro}`)

// ── and the helper really does contain this, rather than the old max+1 ───────────────────────────
const money = readFileSync(`${ROOT}packages/tenant-backend/src/invoicing/money.ts`, 'utf8')
if (!/docSeq/.test(money)) fail('nextNumber no longer advances a high-water mark — deleted numbers would be reused again')
if (!/to_regclass\('company'\)/.test(money)) {
  fail("nextNumber must prove the company table exists with to_regclass before touching it — a failed statement poisons the create's transaction")
}
if (!/GREATEST\(/.test(money)) fail('nextNumber must take GREATEST(mark + 1, max + 1), or a restored backup could go backwards')
/**
 * THE CASTS ARE LOAD-BEARING, and this guard did not catch their absence the first time.
 *
 * `jsonb_build_object` is variadic "any" and `->>` is overloaded (jsonb->>text and jsonb->>int), so a
 * bare placeholder in either position gives Postgres nothing to infer from: the statement fails with
 * "could not determine data type of parameter $1" and, because it runs inside the create, 500s every
 * invoice. The behaviour suites caught that; this guard did not, because the query here happened to
 * use the prefix first inside ARRAY['docSeq', $2], where the element type is inferable from its
 * neighbour. The query above now mirrors the real one, and the shape is asserted too — a guard that
 * is easier to satisfy than production is not a guard.
 */
if (/jsonb_build_object\(\$\{prefix\}(?!::text)/.test(money)) {
  fail('the prefix passed to jsonb_build_object must be cast ::text — it is a variadic "any" position and Postgres cannot infer it, which 500s every create')
}
for (const m of money.match(/->> \$\{prefix\}(::text)?/g) || []) {
  if (!m.includes('::text')) fail("every `->> ${prefix}` must be cast ::text — the operator is overloaded, so an uncast parameter is ambiguous")
}

await pg.close()
if (failed) { console.error(`\nnumbers never reused: ${failed} check(s) FAILED`); process.exit(1) }
console.log('numbers never reused: a deleted invoice number is never handed out again, each prefix keeps its own mark, and a fresh company still numbers from one')
