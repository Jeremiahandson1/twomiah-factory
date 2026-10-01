// Merging two contacts means moving every record that points at the duplicate onto the one being
// kept, and then deleting the duplicate. The hard part is "every": in the base CRM alone, 33 columns
// across 33 tables reference contact.id, under four different names (contact_id, vendor_id,
// subcontractor_id, converted_contact_id), and each of the eight CRMs that share this module has a
// different set of them.
//
// SO THE LIST COMES FROM THE DATABASE, NOT FROM A LITERAL IN THIS FILE.
//
// A hand-maintained list would have to be written eight times and would go stale the first time
// anyone adds a table — and the failure mode of a missed column is the worst kind: the merge
// succeeds, the duplicate is deleted, and whatever pointed at it is silently blanked (most of these
// FKs are ON DELETE SET NULL) or destroyed (six are ON DELETE CASCADE). An invoice quietly losing
// its customer is not a bug anyone reports until they are chasing the money. pg_constraint always
// knows the real answer, so that is what we ask.
//
// Why no company scoping on the repoint: the caller has already proved both contacts belong to the
// caller's company. Every row that references the duplicate's id therefore belongs to that company
// by definition — an id is not guessable and not shared — so `WHERE <fk> = <duplicate>` is already
// exactly the right set. Adding a company_id clause per table would also be impossible generically:
// not every referencing table has that column.
import { sql, getTableName } from 'drizzle-orm'

/** What happened to one referencing column. */
export interface MergeMove {
  /** table name as Postgres reports it */
  table: string
  /** the FK column that pointed at the duplicate */
  column: string
  /** rows repointed onto the surviving contact */
  moved: number
  /** rows dropped because the survivor already had the same row (a unique key would have collided) */
  discarded: number
}

export interface RepointResult {
  moves: MergeMove[]
  moved: number
  discarded: number
  /** every referencing column we looked at, including the ones with nothing to move */
  columnsChecked: number
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows || []))
const one = async (tx: any, q: any): Promise<any> => rowsOf(await tx.execute(q))[0]

/**
 * Move every reference to `loseId` onto `keepId`, inside the caller's transaction.
 *
 * Does NOT touch either contact row and does NOT delete anything but colliding duplicates — the
 * caller owns the patch-and-delete, so that the whole merge is one transaction and a failure
 * anywhere leaves both contacts exactly as they were.
 */
export async function repointContactReferences(
  tx: any,
  opts: { contactTable: any; keepId: string; loseId: string },
): Promise<RepointResult> {
  const contactName = getTableName(opts.contactTable)
  const { keepId, loseId } = opts

  // Every single-column foreign key pointing at this table's id. `regclass::text` quotes reserved
  // names for us (a table called "user" comes back as "user"), and quote_ident does the same for the
  // column, so the identifiers we splice in below are already safe — they come from the catalogue,
  // not from a request.
  const fks = rowsOf(await tx.execute(sql`
    SELECT c.conrelid::regclass::text AS tbl,
           a.attname                  AS col,
           quote_ident(a.attname)     AS colq,
           array_length(c.conkey, 1)  AS width
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = quote_ident(${contactName})::regclass
       AND NOT a.attisdropped
     ORDER BY 1, 2
  `))

  // A composite foreign key into contact would need its other columns repointed in step with this
  // one, and we would be guessing at which. None of the eight schemas has one; if one ever appears
  // we stop rather than half-merge, because the next statement in the caller deletes the duplicate.
  const composite = fks.filter((f: any) => Number(f.width) !== 1)
  if (composite.length) {
    throw new Error(`Cannot merge: ${composite.map((f: any) => `${f.tbl}.${f.col}`).join(', ')} is part of a multi-column reference to ${contactName}.`)
  }

  const moves: MergeMove[] = []

  for (const fk of fks) {
    const tbl = sql.raw(fk.tbl)
    const col = sql.raw(fk.colq)

    // A contact table that references itself (no shipped schema does, but a vertical could add
    // "referred by") must not end up with the survivor pointing at the survivor.
    const notSelf = fk.tbl.replace(/"/g, '') === contactName ? sql` AND id <> ${keepId}` : sql``

    const { n } = await one(tx, sql`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} = ${loseId}${notSelf}`)
    if (!Number(n)) continue

    let discarded = 0

    // Repointing can collide: document_share is unique on (document_id, contact_id), so if both
    // contacts were given the same document, moving the duplicate's row onto the survivor violates
    // that index and the whole merge fails. The survivor already has what that row said, so the
    // duplicate's copy is dropped. Only real unique indexes over plain columns count — a partial or
    // expression index is skipped, since we cannot reproduce its predicate here, and a collision
    // against one would surface as an error rather than silent data loss.
    const idx = rowsOf(await tx.execute(sql`
      SELECT array_agg(quote_ident(a.attname) ORDER BY k.ord) AS cols
        FROM pg_index i
        JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE i.indrelid = ${fk.tbl}::regclass
         AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
       GROUP BY i.indexrelid
    `))

    for (const row of idx) {
      const cols: string[] = row.cols || []
      if (!cols.includes(fk.colq)) continue
      const others = cols.filter((x) => x !== fk.colq)
      if (!others.length) continue // the FK column alone is unique: at most one row, nothing to collide with

      // Plain `=`, not `IS NOT DISTINCT FROM`: a unique index treats nulls as distinct, so two rows
      // that are both null in a key column do not collide and must both be kept.
      const match = sql.join(others.map((o) => sql`k.${sql.raw(o)} = d.${sql.raw(o)}`), sql` AND `)
      const dupes = sql`
        SELECT 1 FROM ${tbl} k
         WHERE k.${col} = ${keepId} AND ${match}
      `
      const { n: collides } = await one(tx, sql`SELECT count(*)::int AS n FROM ${tbl} d WHERE d.${col} = ${loseId} AND EXISTS (${dupes})`)
      if (!Number(collides)) continue
      await tx.execute(sql`DELETE FROM ${tbl} d WHERE d.${col} = ${loseId} AND EXISTS (${dupes})`)
      discarded += Number(collides)
    }

    const { n: moved } = await one(tx, sql`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} = ${loseId}${notSelf}`)
    if (Number(moved)) await tx.execute(sql`UPDATE ${tbl} SET ${col} = ${keepId} WHERE ${col} = ${loseId}${notSelf}`)

    moves.push({ table: fk.tbl.replace(/"/g, ''), column: fk.col, moved: Number(moved), discarded })
  }

  return {
    moves,
    moved: moves.reduce((s, m) => s + m.moved, 0),
    discarded: moves.reduce((s, m) => s + m.discarded, 0),
    columnsChecked: fks.length,
  }
}

/** Fields we never take from the duplicate. */
const KEEP_OWN = new Set(['id', 'companyId', 'createdAt', 'updatedAt', 'portalToken', 'portalTokenExp', 'type', 'name', 'tags', 'notes'])

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/**
 * A flag that records somebody REFUSING contact — email opt-out, SMS opt-out, unsubscribed,
 * do-not-call, suppressed.
 *
 * These cannot be merged by "fill the survivor's blanks", because the columns are NOT NULL with a
 * default of false: a blank never occurs, so the survivor's `false` would always win and a merge
 * would quietly re-subscribe somebody who had asked to be left alone. Whoever that person is, they
 * told the business to stop, and which of two duplicate rows they were looking at when they said it
 * is not their problem. So a refusal on EITHER record is a refusal on the result.
 *
 * Matched by name shape rather than a fixed list, because the verticals do not agree on the set
 * (`optedOutSms` exists in three of the eight) and the next one added must be covered on the day it
 * is added, not the day someone remembers this file. Opt-IN names deliberately do not match — ORing
 * a consent would manufacture permission that was never given.
 */
const REFUSAL_NAME = /(opt_?out|opted_?out|unsub|do_?not|suppress)/i
const isRefusalFlag = (key: string, a: unknown, b: unknown) =>
  REFUSAL_NAME.test(key) && (typeof a === 'boolean' || typeof b === 'boolean')

/**
 * What the survivor should look like after absorbing the duplicate.
 *
 * Additive only — a value on the survivor is never replaced, because the survivor is the record the
 * user chose to keep. The duplicate contributes what the survivor is missing: the mobile number
 * somebody put on one record and the email on the other end up on the same contact, which is the
 * whole reason to merge rather than delete.
 */
export function mergePatch(keeper: any, loser: any, when = new Date()): Record<string, any> {
  const patch: Record<string, any> = {}

  for (const key of Object.keys(loser)) {
    if (KEEP_OWN.has(key)) continue
    if (isRefusalFlag(key, keeper[key], loser[key])) {
      if (loser[key] === true && keeper[key] !== true) patch[key] = true
      continue
    }
    if (blank(keeper[key]) && !blank(loser[key])) patch[key] = loser[key]
  }

  // Tags are a set, so they union rather than fill-if-blank: a merge that dropped the duplicate's
  // tags would lose the segmentation somebody did the work of applying.
  if (Array.isArray(keeper.tags) || Array.isArray(loser.tags)) {
    const union = Array.from(new Set([...(keeper.tags || []), ...(loser.tags || [])]))
    if (union.length !== (keeper.tags || []).length) patch.tags = union
  }

  // The record says it was merged, on the record itself. The audit log holds the same fact, but the
  // person asking "why does this contact have two phone numbers and a 2019 note" is looking at the
  // contact, not the log.
  const stamp = when.toISOString().slice(0, 10)
  const detail = [loser.email, loser.phone || loser.mobile].filter(Boolean).join(' / ')
  const line = `Merged duplicate contact "${loser.name}"${detail ? ` (${detail})` : ''} on ${stamp}.`
  const carried = blank(loser.notes) ? '' : `\n${String(loser.notes).trim()}`
  patch.notes = blank(keeper.notes) ? line + carried : `${String(keeper.notes).trim()}\n\n${line}${carried}`

  return patch
}
